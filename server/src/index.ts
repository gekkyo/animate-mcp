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
        offset: z.number().int(),
    }),
]);
const EDIT_TIMELINE_INPUT = {
    timeline: z.union([z.number().int().nonnegative(), z.string().min(1)]),
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
            .filter((name) => /^Adobe Animate \d{4}$/.test(name))
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
    return (runFile) =>
        new Promise((resolve, reject) => {
            const child = spawn(command, [...args, runFile], { stdio: "ignore" });
            child.once("error", reject);
            child.once("exit", (code) =>
                code === 0 ? resolve() : reject(new Error(`Launcher exited with code ${code}`)),
            );
        });
}

/**
 * Tells whether Animate is running. pgrep -f matches the whole command line, and the pattern can be overridden for tests.
 * @returns Promise<boolean>, true when running (rejects when pgrep cannot be run)
 */
function isAnimateRunning(): Promise<boolean> {
    if (IS_WINDOWS) {
        // tasklist exits 0 even with no match, so check whether the output contains the process name (the image name can be overridden by an env var)
        const image = process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Animate.exe";
        return new Promise((resolve, reject) => {
            let output = "";
            const child = spawn("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
                stdio: ["ignore", "pipe", "ignore"],
            });
            child.stdout.on("data", (chunk) => {
                output += chunk;
            });
            child.once("error", reject);
            child.once("exit", () => resolve(output.toLowerCase().includes(image.toLowerCase())));
        });
    }
    const pattern =
        process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Adobe Animate [0-9]{4}\\.app/Contents/MacOS/Adobe Animate";
    return new Promise((resolve, reject) => {
        const child = spawn("pgrep", ["-f", pattern], { stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code === 0));
    });
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
    const server = new McpServer({ name: "animate-mcp", version: "0.1.1" }, { instructions: INSTRUCTIONS });

    /** Executes arbitrary JSFL and returns its result. */
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

    /** Returns information about the active Animate document. */
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

    /** Exports document timeline scripts and reports progress for library symbols. */
    const handleExportScripts: ToolCallback<typeof EXPORT_SCRIPTS_INPUT> = async ({ document, dir, force }, extra) => {
        try {
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
            const linkedBySymbolName = new Map(libraryList.symbols.map((symbol) => [symbol.name, symbol.linked]));
            exportData.symbols = [];
            const warnings: string[] = [];
            const progressToken = extra._meta?.progressToken;
            const total = libraryList.symbols.length;
            for (let fromIndex = 0; fromIndex < total; fromIndex += TIMELINES_PER_RUN) {
                const names = libraryList.symbols
                    .slice(fromIndex, fromIndex + TIMELINES_PER_RUN)
                    .map((symbol) => symbol.name);
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
                    exportData.symbols.push(...names.map((name) => ({ name, error: message })));
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

    /** Applies exported script edits to Animate and reports progress. */
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
                    edits: edits.filter((edit) => edit.item === undefined),
                    newScripts: newScripts.filter((script) => script.item === undefined),
                    fingerprints: fingerprints.filter((fingerprint) => fingerprint.item === undefined),
                },
            ];
            const itemNames = [...edits, ...newScripts]
                .map((edit) => edit.item)
                .filter((item): item is string => item !== undefined);
            const timelineItems = [...new Set(itemNames)];
            for (let startIndex = 0; startIndex < timelineItems.length; startIndex += TIMELINES_PER_RUN) {
                const selectedItems = new Set(timelineItems.slice(startIndex, startIndex + TIMELINES_PER_RUN));
                editChunks.push({
                    edits: edits.filter((edit) => edit.item !== undefined && selectedItems.has(edit.item)),
                    newScripts: newScripts.filter(
                        (script) => script.item !== undefined && selectedItems.has(script.item),
                    ),
                    fingerprints: fingerprints.filter(
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
                                ...[...chunkEdits, ...chunkNewScripts].map((edit) => ({
                                    file: edit.file,
                                    error: message,
                                })),
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
                edits.filter((edit) => applied.includes(edit.file)),
                newApplied,
                fingerprintUpdates,
            );
            const result = { applied, failed, unchanged, warnings };
            return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
            return failure(error);
        }
    };

    /** Edits one timeline's layer and frame structure, then requires a fresh Export. */
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
                "Edit layers (addLayer, deleteLayer, moveLayer, renameLayer, setLayerType) and frames (insertFrames, removeFrames, insertKeyframe, clearKeyframe, setLabel, setSpanLength, shiftLayerFrames) in order. Layer references use a name and optional zero-based index; frame numbers are 1-based. shiftLayerFrames moves one layer's full content later without shifting other layers. Stops at the first failed op. deleteLayer and removeFrames require confirm: true. Tween interiors reject frame insertion/removal/keyframe changes. Always run export_scripts again before editing or applying scripts.",
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

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
