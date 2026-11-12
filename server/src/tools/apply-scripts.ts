import { resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    type AppliedNewScript,
    type ApplyPayload,
    type ApplyResult,
    serializeApplyPayload,
    type TimelineFingerprint,
} from "../export-workspace/apply-contract.js";
import { collectChanges, recordApplied } from "../export-workspace/export-workspace.js";
import type { createRunner } from "../runner.js";
import { failure, TIMELINES_PER_RUN } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const APPLY_SCRIPTS_INPUT = { dir: z.string(), document: z.string().optional() };

/** Selects scene entries or entries belonging to a selected library-item batch.
 * @param entries Edits, new scripts, or fingerprints to select
 * @param selectedItems Selected library items, or undefined for scene entries
 * @returns Entries assigned to the scene or selected library items
 */
function selectChunkEntries<T extends { item?: string }>(entries: T[], selectedItems?: Set<string>): T[] {
    const selected: T[] = [];
    for (const entry of entries) {
        if (
            selectedItems === undefined
                ? entry.item === undefined
                : entry.item !== undefined && selectedItems.has(entry.item)
        ) {
            selected.push(entry);
        }
    }
    return selected;
}

/** Builds scene and bounded library-item batches for an Apply run.
 * @param edits Existing script edits to batch
 * @param newScripts New frame scripts to batch
 * @param fingerprints Timeline fingerprints to include with each batch
 * @returns Scene batch followed by library-item batches
 */
function buildEditChunks(
    edits: ApplyPayload["edits"],
    newScripts: ApplyPayload["newScripts"],
    fingerprints: ApplyPayload["fingerprints"],
): Pick<ApplyPayload, "edits" | "newScripts" | "fingerprints">[] {
    const chunks: Pick<ApplyPayload, "edits" | "newScripts" | "fingerprints">[] = [
        {
            edits: selectChunkEntries(edits),
            newScripts: selectChunkEntries(newScripts),
            fingerprints: selectChunkEntries(fingerprints),
        },
    ];
    const itemNames = [...edits, ...newScripts]
        .map(
            /** Gets the library item associated with an edit.
             * @param edit Script edit to inspect
             * @returns Its library item, if any
             */
            (edit) => edit.item,
        )
        .filter(
            /** Keeps only defined library item names.
             * @param item Optional library item name
             * @returns Whether the name is defined
             */
            (item): item is string => item !== undefined,
        );
    const timelineItems = [...new Set(itemNames)];
    for (let startIndex = 0; startIndex < timelineItems.length; startIndex += TIMELINES_PER_RUN) {
        const selectedItems = new Set(timelineItems.slice(startIndex, startIndex + TIMELINES_PER_RUN));
        chunks.push({
            edits: selectChunkEntries(edits, selectedItems),
            newScripts: selectChunkEntries(newScripts, selectedItems),
            fingerprints: selectChunkEntries(fingerprints, selectedItems),
        });
    }
    return chunks;
}

/**
 * Registers the apply_scripts tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerApplyScripts(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Applies exported script edits to Animate and reports progress.
     * @param dir Export directory containing the edited scripts
     * @param document Optional expected document name
     * @param extra MCP callback context for progress notifications
     * @returns Tool result containing applied, failed, unchanged, and warning details
     */
    const handleApplyScripts: ToolCallback<typeof APPLY_SCRIPTS_INPUT> = async ({ dir, document }, extra) => {
        try {
            const exportDirectory = resolve(dir);
            const {
                document: exportedDocument,
                libraryFingerprint: expectedLibraryFingerprint,
                edits,
                newScripts,
                fingerprints,
                unchanged,
                failed,
                warnings: collectWarnings,
            } = await collectChanges(exportDirectory);
            if (document && document !== exportedDocument) {
                throw new Error(`Export was made from ${exportedDocument}, not ${document}`);
            }
            /** Applies one batch of existing and new scripts to Animate.
             * @param chunk Existing script edits in this batch
             * @param newChunk New frame scripts in this batch
             * @param chunkFingerprints Timeline fingerprints used to detect stale exports
             * @param libraryFingerprint Expected library fingerprint, when recorded by Export
             * @returns Parsed Apply result from Animate
             */
            const applyChunk = async (
                chunk: typeof edits,
                newChunk: typeof newScripts,
                chunkFingerprints: typeof fingerprints,
                libraryFingerprint?: string,
            ) => {
                const payload: ApplyPayload = {
                    edits: chunk,
                    newScripts: newChunk,
                    fingerprints: chunkFingerprints,
                    ...(libraryFingerprint ? { libraryFingerprint } : {}),
                };
                const code = `var __docName = ${JSON.stringify(exportedDocument)};\n${serializeApplyPayload(payload)}\n${bundle("select-document", "edit-state", "export-common", "apply-scenes")}`;
                return JSON.parse(String(await runner.execute(code))) as ApplyResult;
            };
            const applied: string[] = [];
            const warnings: string[] = [...collectWarnings];
            const newApplied: AppliedNewScript[] = [];
            const fingerprintUpdates: TimelineFingerprint[] = [];
            // Scenes go in one Run; symbols go 10 timelines (items) per Run.
            const editChunks = buildEditChunks(edits, newScripts, fingerprints);
            const progressToken = extra._meta?.progressToken;
            for (let pass = 0; pass < 2; pass++) {
                for (const [chunkIndex, chunk] of editChunks.entries()) {
                    const chunkEdits = pass === 0 ? chunk.edits : [];
                    const chunkNewScripts = pass === 1 ? chunk.newScripts : [];
                    if (chunkEdits.length > 0 || chunkNewScripts.length > 0) {
                        try {
                            const applyResult = await applyChunk(
                                chunkEdits,
                                chunkNewScripts,
                                chunk.fingerprints,
                                expectedLibraryFingerprint,
                            );
                            applied.push(...applyResult.applied);
                            failed.push(...applyResult.failed);
                            newApplied.push(...applyResult.newApplied);
                            fingerprintUpdates.push(...applyResult.fingerprints);
                            if (applyResult.warning) {
                                warnings.push(applyResult.warning);
                            }
                            warnings.push(...applyResult.warnings);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            failed.push(
                                ...[...chunkEdits, ...chunkNewScripts].map(
                                    /** Records a failed file from the batch.
                                     * @param edit Script edit or new script that failed
                                     * @returns File and error details
                                     */
                                    (edit) => ({
                                        file: edit.file,
                                        error: message,
                                    }),
                                ),
                            );
                            warnings.push(`Edit state may not have been restored: ${message}`);
                        }
                    }
                    if (pass === 1 && progressToken !== undefined) {
                        await extra.sendNotification({
                            method: "notifications/progress",
                            params: { progressToken, progress: chunkIndex + 1, total: editChunks.length },
                        });
                    }
                }
            }
            await recordApplied(exportDirectory, {
                edits: edits.filter(
                    /** Selects edits successfully applied to Animate.
                     * @param edit Script edit to check
                     * @returns Whether its file appears in the applied results
                     */
                    (edit) => applied.includes(edit.file),
                ),
                newScripts: newApplied,
                fingerprints: fingerprintUpdates,
            });
            const result = { applied, failed, unchanged, warnings };
            return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "apply_scripts",
        {
            description:
                "Apply edited Timeline scripts from an export_scripts directory back to the Animate document (scenes and library symbols). Empty file deletes the frame script. Frames changed in Animate since Export are not overwritten. Does not save the .fla.",
            inputSchema: APPLY_SCRIPTS_INPUT,
        },
        handleApplyScripts,
    );
}
