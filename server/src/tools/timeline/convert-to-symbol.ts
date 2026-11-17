import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const ELEMENT_REFERENCE = z.union([z.number().int().nonnegative(), z.string().min(1)]);
const REGISTRATION_POINT = z.enum([
    "top left",
    "top center",
    "top right",
    "center left",
    "center",
    "center right",
    "bottom left",
    "bottom center",
    "bottom right",
]);
const CONVERT_TO_SYMBOL_INPUT = {
    timeline: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    document: z.string().optional(),
    frame: z.number().int().positive(),
    elements: z
        .array(
            z
                .object({
                    layer: ELEMENT_REFERENCE,
                    element: ELEMENT_REFERENCE,
                })
                .strict(),
        )
        .min(1),
    name: z
        .string()
        .min(1)
        .regex(/^[^/]+$/, "name must be a plain Library name without a folder path"),
    type: z.enum(["movie clip", "button", "graphic"]),
    registrationPoint: REGISTRATION_POINT.default("center"),
};

export const convertToSymbolTool: ToolDefinition<typeof CONVERT_TO_SYMBOL_INPUT> = {
    name: "convert_to_symbol",
    description:
        "Convert one or more elements on the same 1-based frame of a scene or Library-symbol timeline into one movie clip, button, or graphic symbol. Each element identifies a layer and a zero-based element index or unique name. The timeline, layers, elements, tween state, and unique plain Library name are validated before conversion; tween interiors are refused. Registration defaults to center. Selection, current frame, layer, and touched layer locks are restored when Animate permits. This does not set linkage or save the .fla; use edit_library setLinkage afterwards if needed, and save with save_document (after confirming any overwrite) or in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: CONVERT_TO_SYMBOL_INPUT,
    guidance: {},
    /**
     * Converts the requested elements into one Library symbol.
     * @param timeline Scene index or Library item path.
     * @param document Optional document selector.
     * @param frame 1-based frame containing the elements.
     * @param elements Layer and element references to convert.
     * @param name New Library symbol name.
     * @param type Symbol type to create.
     * @param registrationPoint Symbol registration point.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The created symbol name, type, and registration point.
     */
    run: async (
        {
            timeline,
            document,
            frame,
            elements,
            name,
            type,
            registrationPoint,
        }: Parameters<ToolCallback<typeof CONVERT_TO_SYMBOL_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const code = jsflRun(
            "convert-to-symbol",
            {
                __docName: document ?? "",
                __timelineRef: timeline,
                __request: { frame, elements, name, type, registrationPoint },
            },
            bundle,
        );
        const result = JSON.parse(String(await runner.execute(code))) as {
            name: string;
            type: string;
            registrationPoint: string;
        };
        return { data: result };
    },
};

/**
 * Registers the convert_to_symbol tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerConvertToSymbol(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, convertToSymbolTool, deps);
}
