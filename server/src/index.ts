import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type ExportData, safeName, writeExport } from "./export.js";
import { createRunner, type Launcher } from "./runner.js";

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
                "Export the active Animate document's scene Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/.",
            inputSchema: { document: z.string().optional(), dir: z.string().optional() },
        },
        async ({ document, dir }) => {
            try {
                const code = `var __docName = ${JSON.stringify(document ?? "")};\n${loadJsfl("export-scenes")}`;
                const data = JSON.parse(String(await runner.execute(code))) as ExportData;
                const outDir =
                    dir ?? join(homedir(), ".animate-mcp", "exports", safeName(data.document.replace(/\.fla$/i, "")));
                const result = await writeExport(data, outDir);
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

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
