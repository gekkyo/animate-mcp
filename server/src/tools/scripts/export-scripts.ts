import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { exportsDir } from "../core/paths.js";
import {
    registerToolDefinition,
    TIMELINES_PER_RUN,
    type ToolDefinition,
    type ToolDeps,
    type ToolExtra,
} from "../core/shared.js";
import { type ExportData, type ExportScene, safeName, writeExport } from "./workspace/export.js";
import { prepareExport } from "./workspace/export-workspace.js";

const EXPORT_SCRIPTS_INPUT = {
    document: z.string().optional(),
    dir: z.string().optional(),
    force: z.boolean().optional(),
};
export const exportScriptsTool: ToolDefinition<typeof EXPORT_SCRIPTS_INPUT> = {
    name: "export_scripts",
    description:
        "Export the active Animate document's scene and library-symbol Timeline scripts (AS3 / HTML5 Canvas) to files, with index.md and per-timeline structure.md. Default dir: ~/.animate-mcp/exports/<document>/. Refuses to overwrite edits not yet applied unless force is true; files of the previous Export are replaced.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: EXPORT_SCRIPTS_INPUT,
    guidance: {
        basic: "- To add a script to a frame with none, create <timeline dir>/as/<frame>.as (or .js for HTML Canvas), avoid tween spans, and run apply_scripts.",
    },
    /** Exports scene and library scripts and writes the workspace files.
     * @param args Validated export options
     * @param deps Runtime runner and JSFL bundler
     * @param extra MCP callback metadata and notification helpers
     * @returns Export result and any warnings
     */
    run: async (
        { document, dir, force }: Parameters<ToolCallback<typeof EXPORT_SCRIPTS_INPUT>>[0],
        deps: ToolDeps,
        extra: ToolExtra,
    ) => {
        const { runner, bundle } = deps;

        /** Runs one JSFL export operation for the selected document and optional library items.
         * @param jsfl Export JSFL script name
         * @param items Optional symbol names to export, or null to list symbols
         * @returns Parsed result returned by Animate
         */
        const runJsflOnce = async (jsfl: string, items?: string[] | null) => {
            const code = jsflRun(
                jsfl,
                { __docName: document ?? "", ...(items !== undefined ? { __items: items } : {}) },
                bundle,
            );
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
            dir ?? join(exportsDir(), safeName(exportData.document.replace(/\.fla$/i, ""))),
        );
        await prepareExport(outputDirectory, force ?? false);
        const exportResult = { ...(await writeExport(exportData, outputDirectory)), warnings };
        return { data: exportResult };
    },
};

/** Registers the export_scripts tool.
 * @param server MCP server to register against
 * @param deps Runtime dependencies passed to the tool
 * @returns Nothing.
 */
export function registerExportScripts(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, exportScriptsTool, deps);
}
