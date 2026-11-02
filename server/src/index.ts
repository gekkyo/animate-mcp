#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearPreviousExport, collectEdits, markApplied } from "./apply.js";
import { type ExportData, type ExportScene, safeName, writeExport } from "./export.js";
import { createRunner, type Launcher } from "./runner.js";

const IS_WINDOWS = process.platform === "win32";

/** Usage guidance for MCP clients (operational notes that do not fit in tool descriptions) */
const INSTRUCTIONS = `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; the user saves it.
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
    const [command, args] = custom
        ? [custom, []]
        : IS_WINDOWS
          ? ["cmd", ["/c", "start", ""]]
          : ["open", ["-a", installedMacApp()]];
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
            let out = "";
            const child = spawn("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
                stdio: ["ignore", "pipe", "ignore"],
            });
            child.stdout.on("data", (chunk) => {
                out += chunk;
            });
            child.once("error", reject);
            child.once("exit", () => resolve(out.toLowerCase().includes(image.toLowerCase())));
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
        timeoutMs: Number(process.env.ANIMATE_MCP_TIMEOUT_MS ?? 30_000),
    });
    const server = new McpServer({ name: "animate-mcp", version: "0.1.1" }, { instructions: INSTRUCTIONS });
    server.registerTool(
        "run_jsfl",
        {
            description:
                "Execute arbitrary JSFL code inside Adobe Animate. This runs arbitrary code and may modify documents or files.",
            inputSchema: { code: z.string() },
        },
        async ({ code }) => {
            try {
                const result = await runner.execute(code);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) ?? "null" }],
                    structuredContent: { result },
                };
            } catch (error) {
                return failure(error);
            }
        },
    );

    server.registerTool(
        "get_document_info",
        { description: "Get the active Animate document's name, size, frame rate and timeline names." },
        async () => {
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
        },
    );

    server.registerTool(
        "export_scripts",
        {
            description:
                "Export the active Animate document's scene and library-symbol Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/. Refuses to overwrite edits not yet applied unless force is true; files of the previous Export are replaced.",
            inputSchema: { document: z.string().optional(), dir: z.string().optional(), force: z.boolean().optional() },
        },
        async ({ document, dir, force }, extra) => {
            try {
                const run = async (jsfl: string, items?: string[] | null) => {
                    const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n${items === undefined ? "" : `var __items = ${JSON.stringify(items)};\n`}`;
                    const code = `${prelude}${bundle("select-document", "edit-state", "export-common", jsfl)}`;
                    return JSON.parse(String(await runner.execute(code)));
                };
                const data = (await run("export-scenes")) as ExportData;
                const list = (await run("export-library", null)) as {
                    symbols: { name: string; linked: string }[];
                };
                const linkedOf = new Map(list.symbols.map((symbol) => [symbol.name, symbol.linked]));
                data.symbols = [];
                const warnings: string[] = [];
                const progressToken = extra._meta?.progressToken;
                const total = list.symbols.length;
                for (let from = 0; from < total; from += TIMELINES_PER_RUN) {
                    const names = list.symbols.slice(from, from + TIMELINES_PER_RUN).map((symbol) => symbol.name);
                    try {
                        const chunk = (await run("export-library", names)) as {
                            symbols: ExportScene[];
                            warning: string;
                        };
                        data.symbols.push(...chunk.symbols);
                        if (chunk.warning) warnings.push(chunk.warning);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        data.symbols.push(...names.map((name) => ({ name, error: message })));
                        warnings.push(`Edit state may not have been restored: ${message}`);
                    }
                    if (progressToken !== undefined)
                        await extra.sendNotification({
                            method: "notifications/progress",
                            params: {
                                progressToken,
                                progress: Math.min(from + TIMELINES_PER_RUN, total),
                                total,
                                message: names.at(-1),
                            },
                        });
                }
                for (const symbol of data.symbols) (symbol as { linked?: string }).linked = linkedOf.get(symbol.name);
                const outDir = resolve(
                    dir ?? join(homedir(), ".animate-mcp", "exports", safeName(data.document.replace(/\.fla$/i, ""))),
                );
                await clearPreviousExport(outDir, force ?? false);
                const result = { ...(await writeExport(data, outDir)), warnings };
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: result,
                };
            } catch (error) {
                return failure(error);
            }
        },
    );

    server.registerTool(
        "apply_scripts",
        {
            description:
                "Apply edited Timeline scripts from an export_scripts directory back to the Animate document (scenes and library symbols). Empty file deletes the frame script. Frames changed in Animate since Export are not overwritten. Does not save the .fla.",
            inputSchema: { dir: z.string(), document: z.string().optional() },
        },
        async ({ dir, document }, extra) => {
            try {
                const root = resolve(dir);
                const { document: exported, edits, unchanged, failed } = await collectEdits(root);
                if (document && document !== exported)
                    throw new Error(`Export was made from ${exported}, not ${document}`);
                const run = async (chunk: typeof edits) => {
                    const code = `var __docName = ${JSON.stringify(exported)};\nvar __edits = ${JSON.stringify(chunk)};\n${bundle("select-document", "edit-state", "export-common", "apply-scenes")}`;
                    return JSON.parse(String(await runner.execute(code))) as {
                        applied: string[];
                        failed: { file: string; error: string }[];
                        warning: string;
                    };
                };
                const applied: string[] = [];
                const warnings: string[] = [];
                // Scenes go in one Run; symbols go 10 timelines (items) per Run
                const chunks: (typeof edits)[] = [edits.filter((edit) => edit.item === undefined)];
                const items = [...new Set(edits.flatMap((edit) => (edit.item === undefined ? [] : [edit.item])))];
                for (let from = 0; from < items.length; from += TIMELINES_PER_RUN) {
                    const group = new Set(items.slice(from, from + TIMELINES_PER_RUN));
                    chunks.push(edits.filter((edit) => edit.item !== undefined && group.has(edit.item)));
                }
                const progressToken = extra._meta?.progressToken;
                for (const [index, chunk] of chunks.entries()) {
                    if (chunk.length > 0) {
                        try {
                            const result = await run(chunk);
                            applied.push(...result.applied);
                            failed.push(...result.failed);
                            if (result.warning) warnings.push(result.warning);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            failed.push(...chunk.map((edit) => ({ file: edit.file, error: message })));
                            warnings.push(`Edit state may not have been restored: ${message}`);
                        }
                    }
                    if (progressToken !== undefined)
                        await extra.sendNotification({
                            method: "notifications/progress",
                            params: { progressToken, progress: index + 1, total: chunks.length },
                        });
                }
                await markApplied(
                    root,
                    edits.filter((edit) => applied.includes(edit.file)),
                );
                const result = { applied, failed, unchanged, warnings };
                return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
            } catch (error) {
                return failure(error);
            }
        },
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
