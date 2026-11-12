import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ExportData, type ExportScene, safeName, writeExport } from "../export-workspace/export.js";
import { prepareExport } from "../export-workspace/export-workspace.js";
import type { createRunner } from "../runner.js";
import { failure, TIMELINES_PER_RUN } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const EXPORT_SCRIPTS_INPUT = {
    document: z.string().optional(),
    dir: z.string().optional(),
    force: z.boolean().optional(),
};
/**
 * Registers the export_scripts tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerExportScripts(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
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
            await prepareExport(outputDirectory, force ?? false);
            const exportResult = { ...(await writeExport(exportData, outputDirectory)), warnings };
            return {
                content: [{ type: "text", text: JSON.stringify(exportResult) }],
                structuredContent: exportResult,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "export_scripts",
        {
            description:
                "Export the active Animate document's scene and library-symbol Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/. Refuses to overwrite edits not yet applied unless force is true; files of the previous Export are replaced.",
            annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
            inputSchema: EXPORT_SCRIPTS_INPUT,
        },
        handleExportScripts,
    );
}
