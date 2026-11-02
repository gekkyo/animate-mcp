import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { collectEdits } from "./apply.js";
import { type ExportData, type ExportScene, safeName, writeExport } from "./export.js";
import { createRunner, type Launcher } from "./runner.js";

/** 1 回の Run で読むタイムライン数(タイムアウト対策) */
const TIMELINES_PER_RUN = 10;

/**
 * Run file を Animate で開く Launcher を作る。成功は終了コード 0 で判定する。
 * @returns Launcher。引数 runFile（Run file の絶対パス）を開き、起動コマンドが正常終了したら resolve、失敗・異常終了なら reject する Promise<void> を返す
 */
function launcher(): Launcher {
    // テスト用: 偽の Animate
    const custom = process.env.ANIMATE_MCP_LAUNCH_COMMAND;
    const [command, args] = custom ? [custom, []] : ["open", ["-a", "Adobe Animate 2024"]];
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
 * Animate が起動中か判定する。pgrep -f はコマンドライン全体に一致し、パターンはテストで差し替え可能。
 * @returns 起動中なら true の Promise<boolean>（pgrep を実行できない場合は reject）
 */
function isAnimateRunning(): Promise<boolean> {
    const pattern =
        process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Adobe Animate 2024.app/Contents/MacOS/Adobe Animate 2024";
    return new Promise((resolve, reject) => {
        const child = spawn("pgrep", ["-f", pattern], { stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code === 0));
    });
}

/**
 * ツール用 JSFL を server/jsfl/<name>.jsfl から読み込む（src/ でも dist/ でも同じ場所を指す）。
 * @param name 拡張子なしのファイル名（例: "get-document-info"）
 * @returns JSFL のソース文字列
 */
const loadJsfl = (name: string) => readFileSync(new URL(`../jsfl/${name}.jsfl`, import.meta.url), "utf8");

/**
 * Runner を組み立て、MCP ツール（run_jsfl / get_document_info）を登録して stdio で待ち受ける。
 * @returns 接続完了で resolve する Promise<void>（失敗時は reject し、呼び出し側が終了コードを設定する）
 */
async function main() {
    const runner = createRunner({
        dir: process.env.ANIMATE_MCP_RUNS_DIR ?? join(homedir(), ".animate-mcp", "runs"),
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: Number(process.env.ANIMATE_MCP_TIMEOUT_MS ?? 30_000),
    });
    const server = new McpServer({ name: "animate-mcp", version: "0.1.0" });
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
                return {
                    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                    isError: true,
                };
            }
        },
    );

    server.registerTool(
        "get_document_info",
        { description: "Get the active Animate document's name, size, frame rate and timeline names." },
        async () => {
            try {
                const info = JSON.parse(String(await runner.execute(loadJsfl("get-document-info")))) as unknown;
                return {
                    content: [{ type: "text", text: JSON.stringify(info) }],
                    structuredContent: info as Record<string, unknown>,
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                    isError: true,
                };
            }
        },
    );

    server.registerTool(
        "export_scripts",
        {
            description:
                "Export the active Animate document's scene and library-symbol Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/.",
            inputSchema: { document: z.string().optional(), dir: z.string().optional() },
        },
        async ({ document, dir }, extra) => {
            try {
                const run = async (jsfl: string, items?: string[] | null) => {
                    const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n${items === undefined ? "" : `var __items = ${JSON.stringify(items)};\n`}`;
                    const code = `${prelude}${loadJsfl("select-document")}\n${loadJsfl("edit-state")}\n${loadJsfl("export-common")}\n${loadJsfl(jsfl)}`;
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
                const outDir =
                    dir ?? join(homedir(), ".animate-mcp", "exports", safeName(data.document.replace(/\.fla$/i, "")));
                const result = { ...(await writeExport(data, outDir)), warnings };
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: result,
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                    isError: true,
                };
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
                const { document: exported, edits, unchanged, failed } = await collectEdits(dir);
                if (document && document !== exported)
                    throw new Error(`Export was made from ${exported}, not ${document}`);
                const run = async (chunk: typeof edits) => {
                    const code = `var __docName = ${JSON.stringify(exported)};\nvar __edits = ${JSON.stringify(chunk)};\n${loadJsfl("select-document")}\n${loadJsfl("edit-state")}\n${loadJsfl("apply-scenes")}`;
                    return JSON.parse(String(await runner.execute(code))) as {
                        applied: string[];
                        failed: { file: string; error: string }[];
                        warning: string;
                    };
                };
                const applied: string[] = [];
                const warnings: string[] = [];
                // シーンは 1 Run、シンボルはタイムライン(item)10 個ずつ 1 Run
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
                const result = { applied, failed, unchanged, warnings };
                return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
            } catch (error) {
                return {
                    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                    isError: true,
                };
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
