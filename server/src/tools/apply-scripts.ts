import { resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type AppliedNewScript, collectEdits, markApplied, type TimelineFingerprint } from "../apply.js";
import type { createRunner } from "../runner.js";
import { failure, TIMELINES_PER_RUN } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const APPLY_SCRIPTS_INPUT = { dir: z.string(), document: z.string().optional() };
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
                edits,
                newScripts,
                fingerprints,
                unchanged,
                failed,
                warnings: collectWarnings,
            } = await collectEdits(exportDirectory);
            if (document && document !== exportedDocument) {
                throw new Error(`Export was made from ${exportedDocument}, not ${document}`);
            }
            /** Applies one batch of existing and new scripts to Animate.
             * @param chunk Existing script edits in this batch
             * @param newChunk New frame scripts in this batch
             * @param chunkFingerprints Timeline fingerprints used to detect stale exports
             * @returns Parsed Apply result from Animate
             */
            const applyChunk = async (
                chunk: typeof edits,
                newChunk: typeof newScripts,
                chunkFingerprints: typeof fingerprints,
            ) => {
                const code = `var __docName = ${JSON.stringify(exportedDocument)};\nvar __edits = ${JSON.stringify(chunk)};\nvar __newScripts = ${JSON.stringify(newChunk)};\nvar __fingerprints = ${JSON.stringify(chunkFingerprints)};\n${bundle("select-document", "edit-state", "export-common", "apply-scenes")}`;
                return JSON.parse(String(await runner.execute(code))) as {
                    applied: string[];
                    failed: { file: string; error: string }[];
                    warning: string;
                    warnings: string[];
                    newApplied: AppliedNewScript[];
                    fingerprints: TimelineFingerprint[];
                };
            };
            const applied: string[] = [];
            const warnings: string[] = [...collectWarnings];
            const newApplied: AppliedNewScript[] = [];
            const fingerprintUpdates: TimelineFingerprint[] = [];
            // Scenes go in one Run; symbols go 10 timelines (items) per Run
            const editChunks: {
                edits: typeof edits;
                newScripts: typeof newScripts;
                fingerprints: typeof fingerprints;
            }[] = [
                {
                    edits: edits.filter(
                        /** Selects scene edits for the initial batch.
                         * @param edit Script edit to check
                         * @returns Whether the edit belongs to a scene
                         */
                        (edit) => edit.item === undefined,
                    ),
                    newScripts: newScripts.filter(
                        /** Selects new scene scripts for the initial batch.
                         * @param script New script to check
                         * @returns Whether the script belongs to a scene
                         */
                        (script) => script.item === undefined,
                    ),
                    fingerprints: fingerprints.filter(
                        /** Selects scene fingerprints for the initial batch.
                         * @param fingerprint Timeline fingerprint to check
                         * @returns Whether the fingerprint belongs to a scene
                         */
                        (fingerprint) => fingerprint.item === undefined,
                    ),
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
                editChunks.push({
                    edits: edits.filter(
                        /** Selects edits belonging to the current symbol batch.
                         * @param edit Script edit to check
                         * @returns Whether its library item is selected
                         */
                        (edit) => edit.item !== undefined && selectedItems.has(edit.item),
                    ),
                    newScripts: newScripts.filter(
                        /** Selects new scripts belonging to the current symbol batch.
                         * @param script New script to check
                         * @returns Whether its library item is selected
                         */
                        (script) => script.item !== undefined && selectedItems.has(script.item),
                    ),
                    fingerprints: fingerprints.filter(
                        /** Selects fingerprints belonging to the current symbol batch.
                         * @param fingerprint Timeline fingerprint to check
                         * @returns Whether its library item is selected
                         */
                        (fingerprint) => fingerprint.item !== undefined && selectedItems.has(fingerprint.item),
                    ),
                });
            }
            const progressToken = extra._meta?.progressToken;
            for (let pass = 0; pass < 2; pass++) {
                for (const [chunkIndex, chunk] of editChunks.entries()) {
                    const chunkEdits = pass === 0 ? chunk.edits : [];
                    const chunkNewScripts = pass === 1 ? chunk.newScripts : [];
                    if (chunkEdits.length > 0 || chunkNewScripts.length > 0) {
                        try {
                            const applyResult = await applyChunk(chunkEdits, chunkNewScripts, chunk.fingerprints);
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
            await markApplied(
                exportDirectory,
                edits.filter(
                    /** Selects edits successfully applied to Animate.
                     * @param edit Script edit to check
                     * @returns Whether its file appears in the applied results
                     */
                    (edit) => applied.includes(edit.file),
                ),
                newApplied,
                fingerprintUpdates,
            );
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
