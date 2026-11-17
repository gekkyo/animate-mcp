import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ZodType, z } from "zod";
import { exportsDir } from "../core/paths.js";
import {
    registerToolDefinition,
    TIMELINES_PER_RUN,
    type ToolDefinition,
    type ToolDeps,
    type ToolExtra,
} from "../core/shared.js";
import { type ExportData, safeName, writeExport } from "./workspace/export.js";
import { prepareExport } from "./workspace/export-workspace.js";

const EXPORT_SCRIPTS_INPUT = {
    document: z.string().optional(),
    dir: z.string().optional(),
    force: z.boolean().optional(),
};
const EXPORT_ELEMENT_RESULT = z.object({ name: z.string(), item: z.string(), type: z.string() }).strict();
const EXPORT_FRAME_RESULT = z
    .object({
        start: z.number(),
        duration: z.number(),
        label: z.string(),
        tween: z.string(),
        script: z.string(),
        elements: z.array(EXPORT_ELEMENT_RESULT),
    })
    .strict();
const EXPORT_SCENE_RESULT = z
    .object({
        name: z.string(),
        layers: z
            .array(z.object({ index: z.number(), name: z.string(), frames: z.array(EXPORT_FRAME_RESULT) }).strict())
            .optional(),
        structureFingerprint: z.string().optional(),
        error: z.string().optional(),
    })
    .strict();
const EXPORT_DATA_RESULT = z
    .object({
        document: z.string(),
        type: z.string(),
        scenes: z.array(EXPORT_SCENE_RESULT),
        libraryFingerprint: z.string().optional(),
    })
    .strict();
const LIBRARY_LIST_RESULT = z
    .object({
        document: z.string(),
        type: z.string(),
        symbols: z.array(z.object({ name: z.string(), linked: z.string() }).strict()),
    })
    .strict();
const LIBRARY_EXPORT_RESULT = z
    .object({
        document: z.string(),
        type: z.string(),
        symbols: z.array(EXPORT_SCENE_RESULT),
        warning: z.string(),
    })
    .strict();
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
     * @param deps Runtime dependencies
     * @param extra MCP callback metadata and notification helpers
     * @returns Export result and any warnings
     */
    run: async (
        { document, dir, force }: Parameters<ToolCallback<typeof EXPORT_SCRIPTS_INPUT>>[0],
        deps: ToolDeps,
        extra: ToolExtra,
    ) => {
        /** Runs one JSFL export operation for the selected document and optional library items.
         * @param jsfl Export JSFL script name
         * @param items Optional symbol names to export, or null to list symbols
         * @param schema Expected JSFL result shape
         * @returns Validated result returned by Animate
         */
        const runJsflOnce = async <T>(jsfl: string, items: string[] | null | undefined, schema: ZodType<T>) =>
            deps.jsfl.run(
                jsfl,
                { __docName: document ?? "", ...(items !== undefined ? { __items: items } : {}) },
                schema,
            );
        const exportData: ExportData = await runJsflOnce("scripts/export-scenes", undefined, EXPORT_DATA_RESULT);
        const libraryList = await runJsflOnce("scripts/export-library", null, LIBRARY_LIST_RESULT);
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
                const chunk = await runJsflOnce("scripts/export-library", names, LIBRARY_EXPORT_RESULT);
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
            symbol.linked = linkedBySymbolName.get(symbol.name);
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
