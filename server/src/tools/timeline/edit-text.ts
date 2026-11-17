import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const TEXT_STYLE = z
    .object({
        face: z.string().min(1).optional(),
        size: z.number().finite().positive().optional(),
        fillColor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        alignment: z.enum(["left", "center", "right", "justify"]).optional(),
        textType: z.enum(["static", "dynamic", "input"]).optional(),
        lineType: z.enum(["single line", "multiline", "multiline no wrap"]).optional(),
    })
    .strict()
    .refine((style) => Object.keys(style).length > 0, "style requires at least one field");

const RECTANGLE = z
    .object({
        left: z.number().finite(),
        top: z.number().finite(),
        right: z.number().finite(),
        bottom: z.number().finite(),
    })
    .strict()
    .refine(
        (rectangle) => rectangle.right > rectangle.left && rectangle.bottom > rectangle.top,
        "rectangle must have positive width and height",
    );

const EDIT_TEXT_OP = z
    .discriminatedUnion("op", [
        z
            .object({
                op: z.literal("add"),
                layer: z.string().min(1),
                frame: z.number().int().positive(),
                rectangle: RECTANGLE,
                text: z.string().min(1),
                style: TEXT_STYLE.optional(),
            })
            .strict(),
        z
            .object({
                op: z.literal("set"),
                layer: z.union([z.number().int().nonnegative(), z.string().min(1)]),
                frame: z.number().int().positive(),
                element: z.union([z.number().int().nonnegative(), z.string().min(1)]),
                text: z.string().min(1).optional(),
                style: TEXT_STYLE.optional(),
            })
            .strict()
            .refine((op) => op.text !== undefined || op.style !== undefined, "set requires text or style"),
    ])
    .refine(
        (op) =>
            op.op !== "add" ||
            op.style?.lineType === undefined ||
            op.style.textType === "dynamic" ||
            op.style.textType === "input",
        "lineType requires textType: dynamic or input",
    )
    .refine(
        (op) =>
            op.op !== "set" ||
            op.style?.lineType === undefined ||
            op.style.textType === undefined ||
            op.style.textType === "dynamic" ||
            op.style.textType === "input",
        "lineType can only be set on dynamic or input text",
    );

const EDIT_TEXT_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    document: z.string().optional(),
    ops: z.array(EDIT_TEXT_OP).min(1),
};
const EDIT_TEXT_RESULT = z
    .object({
        applied: z.number(),
        elements: z.array(z.record(z.string(), z.unknown())),
        warning: z.string().optional(),
    })
    .passthrough();

export const editTextTool: ToolDefinition<typeof EDIT_TEXT_INPUT> = {
    name: "edit_text",
    description:
        "Add text to a 1-based keyframe using a left/top/right/bottom rectangle, or set the string and whole-field style of an existing text element. Add creates missing layers, extends the timeline, and makes a keyframe when needed; tween spans and non-text elements are refused. lineType is supported only for dynamic/input text; Canvas also refuses input text and single-line text. Layer locks, selection, and the current frame are restored. Changes do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: EDIT_TEXT_INPUT,
    guidance: {
        basic: "- Use edit_text to add or update whole text fields; Canvas does not support input or single-line text. Use import_assets for images/audio and set_document_properties for stage settings; neither saves the .fla.",
    },
    /**
     * Adds or updates text fields in the selected timeline.
     * @param timeline Scene index or Library item path.
     * @param document Optional document selector.
     * @param ops Text operations to apply.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The result of the applied text operations.
     */
    run: async ({ timeline, document, ops }: Parameters<ToolCallback<typeof EDIT_TEXT_INPUT>>[0], deps: ToolDeps) => {
        const result = await deps.jsfl.run(
            "timeline/edit-text",
            { __docName: document ?? "", __timelineRef: timeline, __ops: ops },
            EDIT_TEXT_RESULT,
        );
        return { data: result };
    },
};

/**
 * Registers the edit_text tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerEditText(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, editTextTool, deps);
}
