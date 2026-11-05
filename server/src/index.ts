#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
    type AppliedNewScript,
    clearPreviousExport,
    collectEdits,
    markApplied,
    type TimelineFingerprint,
} from "./apply.js";
import { type ExportData, type ExportScene, safeName, writeExport } from "./export.js";
import { createRunner, type Launcher } from "./runner.js";

const IS_WINDOWS = process.platform === "win32";
/** Version from package.json (the same relative path from src/ and dist/) */
const PACKAGE_VERSION = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Usage guidance for MCP clients (operational notes that do not fit in tool descriptions) */
const INSTRUCTIONS = `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; the user saves it.
- To add a script to a frame with none, create <timeline dir>/as/<frame>.as (or .js for HTML Canvas), avoid tween spans, and run apply_scripts.
- Use edit_timeline for layer or frame structure changes. shiftLayerFrames moves one layer's content later without shifting other layers. Always run export_scripts again before editing or applying scripts; delete operations require confirm: true.
- If a frame changed in Animate before you applied, Export is refused and Apply skips that frame. Export again to pull in the change.

Notes:
- When several documents are open, document is required. get_document_info returns the name.
- AS3 and HTML5 Canvas have different APIs. Check the document type before trying things with run_jsfl.
- Runtime errors appear in Animate's Output panel. Run fl.outputPanel.save(FLfile.platformPathToURI("<native OS path>")) with run_jsfl and read the saved file (saving under ~/.animate-mcp/ is recommended; write the path in the usual form for the OS).
- When a script fails with a null error, first check the layer's frame length and instance names with run_jsfl.
- If you add debug traces, always remove them after checking and Apply again.
- run_jsfl runs arbitrary code. Ask the user before any operation that modifies the document.`;

/** Timelines handled per Run (to avoid timeouts) */
const TIMELINES_PER_RUN = 10;
/** Default timeout for one Run in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

const RUN_JSFL_INPUT = { code: z.string() };
const EXPORT_SCRIPTS_INPUT = {
    document: z.string().optional(),
    dir: z.string().optional(),
    force: z.boolean().optional(),
};
const APPLY_SCRIPTS_INPUT = { dir: z.string(), document: z.string().optional() };
const EDIT_TIMELINE_OP = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("addLayer"),
        name: z.string().min(1),
        type: z.enum(["normal", "mask", "masked", "guide", "folder"]).optional(),
        parent: z.string().optional(),
        above: z.string().optional(),
        below: z.string().optional(),
    }),
    z.object({
        op: z.literal("deleteLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        confirm: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("moveLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        above: z.string().optional(),
        below: z.string().optional(),
        parent: z.string().optional(),
    }),
    z.object({
        op: z.literal("renameLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        name: z.string().min(1),
    }),
    z.object({
        op: z.literal("setLayerType"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        type: z.enum(["normal", "mask", "masked", "guide", "folder"]),
        parent: z.string().optional(),
    }),
    z.object({
        op: z.literal("insertFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        count: z.number().int().positive(),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("removeFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        count: z.number().int().positive(),
        confirm: z.boolean().optional(),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("insertKeyframe"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
    }),
    z.object({
        op: z.literal("clearKeyframe"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
    }),
    z.object({
        op: z.literal("setLabel"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        label: z.string(),
    }),
    z.object({
        op: z.literal("setSpanLength"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        length: z.number().int().min(2),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("shiftLayerFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        offset: z.number().int().positive(),
    }),
]);
const EDIT_TIMELINE_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    ops: z.array(EDIT_TIMELINE_OP).min(1),
    document: z.string().optional(),
};

/**
 * Converts a tool exception into an MCP error result.
 * @param error The caught value
 * @returns A text result with isError set
 */
const failure = (error: unknown) => ({
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
});

/**
 * Returns the newest "Adobe Animate <year>" in /Applications (2024 if none is found).
 * @returns App name to pass to `open -a`
 */
const installedMacApp = () => {
    try {
        const apps = readdirSync("/Applications")
            .filter(
                /** Keeps application directory names for Adobe Animate releases.
                 * @param name Application directory entry
                 * @returns Whether the entry names an Adobe Animate release
                 */
                (name) => /^Adobe Animate \d{4}$/.test(name),
            )
            .sort();
        return apps.at(-1) ?? "Adobe Animate 2024";
    } catch {
        return "Adobe Animate 2024";
    }
};

/**
 * Creates a Launcher that opens a Run file in Animate. Success means exit code 0.
 * @returns Launcher that opens runFile (absolute path of the Run file); the returned Promise<void> resolves when the launch command exits normally and rejects on failure or abnormal exit
 */
function launcher(): Launcher {
    // For tests: a fake Animate
    const custom = process.env.ANIMATE_MCP_LAUNCH_COMMAND;
    // Windows opens via the .jsfl association (Animate); macOS names the app explicitly
    let command: string;
    let args: string[];
    if (custom) {
        [command, args] = [custom, []];
    } else if (IS_WINDOWS) {
        [command, args] = ["cmd", ["/c", "start", ""]];
    } else {
        [command, args] = ["open", ["-a", installedMacApp()]];
    }
    return (
        /** Opens the Run file with the selected launch command.
         * @param runFile Absolute path of the Run file
         * @returns Resolves when the launch command exits normally; rejects on launch failure or abnormal exit
         */
        (runFile) =>
            new Promise(
                /** Settles according to the launch command's exit status.
                 * @param resolve Resolves after a successful launch
                 * @param reject Rejects when spawning fails or the command exits abnormally
                 */
                (resolve, reject) => {
                    const child = spawn(command, [...args, runFile], { stdio: "ignore" });
                    child.once("error", reject);
                    child.once(
                        "exit",
                        /** Resolves or rejects based on the child process exit code.
                         * @param code Child process exit code, or null when terminated by a signal
                         */
                        (code) => (code === 0 ? resolve() : reject(new Error(`Launcher exited with code ${code}`))),
                    );
                },
            )
    );
}

/**
 * Tells whether Animate is running. pgrep -f matches the whole command line, and the pattern can be overridden for tests.
 * @returns Promise<boolean>, true when running (rejects when pgrep cannot be run)
 */
function isAnimateRunning(): Promise<boolean> {
    if (IS_WINDOWS) {
        // tasklist exits 0 even with no match, so check whether the output contains the process name (the image name can be overridden by an env var)
        const image = process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Animate.exe";
        return new Promise(
            /** Resolves whether the matching process is listed.
             * @param resolve Resolves with the process-presence result
             * @param reject Rejects if tasklist cannot be started
             */
            (resolve, reject) => {
                let output = "";
                const child = spawn("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
                    stdio: ["ignore", "pipe", "ignore"],
                });
                child.stdout.on(
                    "data",
                    /** Appends a tasklist output chunk for the process check.
                     * @param chunk Output bytes to append
                     */
                    (chunk) => {
                        output += chunk;
                    },
                );
                child.once("error", reject);
                // "close" (not "exit") fires after stdout is fully read
                child.once(
                    "close",
                    /** Resolves whether tasklist output contains the process image. */
                    () => resolve(output.toLowerCase().includes(image.toLowerCase())),
                );
            },
        );
    }
    const pattern =
        process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Adobe Animate [0-9]{4}\\.app/Contents/MacOS/Adobe Animate";
    return new Promise(
        /** Resolves whether pgrep found a matching process.
         * @param resolve Resolves with the process-presence result
         * @param reject Rejects if pgrep cannot be started
         */
        (resolve, reject) => {
            const child = spawn("pgrep", ["-f", pattern], { stdio: "ignore" });
            child.once("error", reject);
            child.once(
                "exit",
                /** Resolves based on pgrep's exit status.
                 * @param code pgrep exit code
                 */
                (code) => resolve(code === 0),
            );
        },
    );
}

/**
 * Loads tool JSFL from server/jsfl/<name>.jsfl (the same place from src/ and dist/).
 * @param name File name without extension (e.g. "get-document-info")
 * @returns The JSFL source string
 */
const loadJsfl = (name: string) => readFileSync(new URL(`../jsfl/${name}.jsfl`, import.meta.url), "utf8");

/**
 * Concatenates shared parts and the main JSFL in order.
 * @param names File names without extension (shared parts first, the main script last)
 * @returns The concatenated JSFL source
 */
const bundle = (...names: string[]) => names.map(loadJsfl).join("\n");

/**
 * Builds the Runner, registers the MCP tools (run_jsfl / get_document_info / export_scripts / apply_scripts) and listens on stdio.
 * @returns Promise<void> that resolves once connected (rejects on failure; the caller sets the exit code)
 */
async function main() {
    const runner = createRunner({
        dir: process.env.ANIMATE_MCP_RUNS_DIR ?? join(homedir(), ".animate-mcp", "runs"),
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: Number(process.env.ANIMATE_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    });
    const server = new McpServer({ name: "animate-mcp", version: PACKAGE_VERSION }, { instructions: INSTRUCTIONS });

    /** Executes arbitrary JSFL and returns its result.
     * @param code JSFL source to execute
     * @returns Tool result containing the JSFL value, or an MCP error result
     */
    const handleRunJsfl: ToolCallback<typeof RUN_JSFL_INPUT> = async ({ code }) => {
        try {
            const result = await runner.execute(code);
            return {
                content: [{ type: "text", text: JSON.stringify(result) ?? "null" }],
                structuredContent: { result },
            };
        } catch (error) {
            return failure(error);
        }
    };

    /** Returns information about the active Animate document.
     * @returns Tool result containing the parsed document information, or an MCP error result
     */
    const handleGetDocumentInfo: ToolCallback = async () => {
        try {
            const info = JSON.parse(
                String(await runner.execute(bundle("export-common", "get-document-info"))),
            ) as unknown;
            return {
                content: [{ type: "text", text: JSON.stringify(info) }],
                structuredContent: info as Record<string, unknown>,
            };
        } catch (error) {
            return failure(error);
        }
    };

    /** Exports document timeline scripts and reports progress for library symbols.
     * @param document Optional document name to select
     * @param dir Optional export output directory
     * @param force Whether to overwrite unapplied edits
     * @param extra MCP callback context for progress notifications
     * @returns Tool result containing export details, or an MCP error result
     */
    const handleExportScripts: ToolCallback<typeof EXPORT_SCRIPTS_INPUT> = async ({ document, dir, force }, extra) => {
        try {
            /** Runs one JSFL export operation for the selected document and optional library items.
             * @param jsfl Export JSFL script name
             * @param items Optional symbol names to export, or null to list symbols
             * @returns Parsed result returned by Animate
             */
            const runJsflOnce = async (jsfl: string, items?: string[] | null) => {
                let prelude = `var __docName = ${JSON.stringify(document ?? "")};\n`;
                if (items !== undefined) {
                    prelude += `var __items = ${JSON.stringify(items)};\n`;
                }
                const code = `${prelude}${bundle("select-document", "edit-state", "export-common", jsfl)}`;
                return JSON.parse(String(await runner.execute(code)));
            };
            const exportData = (await runJsflOnce("export-scenes")) as ExportData;
            const libraryList = (await runJsflOnce("export-library", null)) as {
                symbols: { name: string; linked: string }[];
            };
            const linkedBySymbolName = new Map(
                libraryList.symbols.map(
                    /** Extracts a symbol's name and linked class.
                     * @param symbol Library symbol entry
                     * @returns Symbol name and linked class pair
                     */
                    (symbol) => [symbol.name, symbol.linked],
                ),
            );
            exportData.symbols = [];
            const warnings: string[] = [];
            const progressToken = extra._meta?.progressToken;
            const total = libraryList.symbols.length;
            for (let fromIndex = 0; fromIndex < total; fromIndex += TIMELINES_PER_RUN) {
                const names = libraryList.symbols.slice(fromIndex, fromIndex + TIMELINES_PER_RUN).map(
                    /** Gets the name of each symbol in the current export batch.
                     * @param symbol Library symbol entry
                     * @returns Symbol name
                     */
                    (symbol) => symbol.name,
                );
                try {
                    const chunk = (await runJsflOnce("export-library", names)) as {
                        symbols: ExportScene[];
                        warning: string;
                    };
                    exportData.symbols.push(...chunk.symbols);
                    if (chunk.warning) {
                        warnings.push(chunk.warning);
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    exportData.symbols.push(
                        ...names.map(
                            /** Creates an error entry for a symbol whose export failed.
                             * @param name Symbol name
                             * @returns Failed symbol result
                             */
                            (name) => ({ name, error: message }),
                        ),
                    );
                    warnings.push(`Edit state may not have been restored: ${message}`);
                }
                if (progressToken !== undefined) {
                    await extra.sendNotification({
                        method: "notifications/progress",
                        params: {
                            progressToken,
                            progress: Math.min(fromIndex + TIMELINES_PER_RUN, total),
                            total,
                            message: names.at(-1),
                        },
                    });
                }
            }
            for (const symbol of exportData.symbols) {
                (symbol as { linked?: string }).linked = linkedBySymbolName.get(symbol.name);
            }
            const outputDirectory = resolve(
                dir ?? join(homedir(), ".animate-mcp", "exports", safeName(exportData.document.replace(/\.fla$/i, ""))),
            );
            await clearPreviousExport(outputDirectory, force ?? false);
            const exportResult = { ...(await writeExport(exportData, outputDirectory)), warnings };
            return {
                content: [{ type: "text", text: JSON.stringify(exportResult) }],
                structuredContent: exportResult,
            };
        } catch (error) {
            return failure(error);
        }
    };

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

    /** Edits one timeline's layer and frame structure, then requires a fresh Export.
     * @param timeline Scene index (zero-based number) or library item path (string)
     * @param ops Ordered layer and frame operations
     * @param document Optional document name to select
     * @returns Tool result containing applied, failed, skipped, warning, and layer details
     */
    const handleEditTimeline: ToolCallback<typeof EDIT_TIMELINE_INPUT> = async ({ timeline, ops, document }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __timelineRef = ${JSON.stringify(timeline)};\nvar __ops = ${JSON.stringify(ops)};\n${bundle("select-document", "edit-state", "export-common", "edit-timeline")}`;
            const result = JSON.parse(String(await runner.execute(code))) as {
                applied: typeof ops;
                failed: { op: (typeof ops)[number]; error: string } | null;
                skipped: typeof ops;
                warnings: string[];
                layers: { name: string; type: string; parent?: string; locked: boolean }[];
            };
            return {
                content: [{ type: "text", text: `Export again before apply_scripts.\n${JSON.stringify(result)}` }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "run_jsfl",
        {
            description:
                "Execute arbitrary JSFL code inside Adobe Animate. This runs arbitrary code and may modify documents or files.",
            inputSchema: RUN_JSFL_INPUT,
        },
        handleRunJsfl,
    );

    server.registerTool(
        "get_document_info",
        { description: "Get the active Animate document's name, size, frame rate and timeline names." },
        handleGetDocumentInfo,
    );

    server.registerTool(
        "export_scripts",
        {
            description:
                "Export the active Animate document's scene and library-symbol Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/. Refuses to overwrite edits not yet applied unless force is true; files of the previous Export are replaced.",
            inputSchema: EXPORT_SCRIPTS_INPUT,
        },
        handleExportScripts,
    );

    server.registerTool(
        "edit_timeline",
        {
            description:
                "Edit layers (addLayer, deleteLayer, moveLayer, renameLayer, setLayerType) and frames (insertFrames, removeFrames, insertKeyframe, clearKeyframe, setLabel, setSpanLength, shiftLayerFrames) in order. Layer references use a name and optional zero-based index; frame numbers are 1-based. shiftLayerFrames moves one layer's full content later without shifting other layers; it uses cut/paste (overwrites the clipboard, and if it fails midway the layer may be left changed: undo in Animate). Stops at the first failed op. deleteLayer and removeFrames require confirm: true. Tween interiors reject frame insertion/removal/keyframe changes. Always run export_scripts again before editing or applying scripts.",
            inputSchema: EDIT_TIMELINE_INPUT,
        },
        handleEditTimeline,
    );

    server.registerTool(
        "apply_scripts",
        {
            description:
                "Apply edited Timeline scripts from an export_scripts directory back to the Animate document (scenes and library symbols). Empty file deletes the frame script. Frames changed in Animate since Export are not overwritten. Does not save the .fla.",
            inputSchema: APPLY_SCRIPTS_INPUT,
        },
        handleApplyScripts,
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(
    /** Reports startup failures and sets a failing process exit code.
     * @param error Startup failure to report
     */
    (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    },
);
