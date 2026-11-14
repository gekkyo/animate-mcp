import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const COLOR_EFFECT = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }).strict(),
    z.object({ mode: z.literal("alpha"), alphaPercent: z.number().finite() }).strict(),
    z.object({ mode: z.literal("brightness"), brightnessPercent: z.number().finite() }).strict(),
    z
        .object({
            mode: z.literal("tint"),
            tintColor: z.string(),
            tintPercent: z.number().finite(),
        })
        .strict(),
    z
        .object({
            mode: z.literal("advanced"),
            redPercent: z.number().finite().optional(),
            greenPercent: z.number().finite().optional(),
            bluePercent: z.number().finite().optional(),
            redAmount: z.number().finite().optional(),
            greenAmount: z.number().finite().optional(),
            blueAmount: z.number().finite().optional(),
        })
        .strict()
        .refine((effect) => Object.keys(effect).length > 1, "advanced colorEffect requires at least one value"),
]);

const EDIT_ELEMENT_SET = z
    .object({
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        scaleX: z.number().finite().optional(),
        scaleY: z.number().finite().optional(),
        rotation: z.number().finite().optional(),
        skewX: z.number().finite().optional(),
        skewY: z.number().finite().optional(),
        name: z.string().optional(),
        blendMode: z.string().min(1).optional(),
        visible: z.boolean().optional(),
        loop: z.enum(["loop", "play once", "single frame"]).optional(),
        firstFrame: z.number().int().nonnegative().optional(),
        swapSymbol: z.string().min(1).optional(),
        colorEffect: COLOR_EFFECT.optional(),
        filters: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .strict()
    .refine((set) => Object.keys(set).length > 0, "set requires at least one field");

const EDIT_ELEMENT_OP = z.union([
    z
        .object({
            op: z.literal("add"),
            item: z.string().min(1),
            layer: z.string().min(1),
            frame: z.number().int().positive(),
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
            set: EDIT_ELEMENT_SET.optional(),
        })
        .strict(),
    z
        .object({
            layer: z.union([z.number().int().nonnegative(), z.string().min(1)]),
            frame: z.number().int().positive(),
            element: z.union([z.number().int().nonnegative(), z.string().min(1)]),
            set: EDIT_ELEMENT_SET,
        })
        .strict(),
]);

const EDIT_ELEMENTS_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    document: z.string().optional(),
    ops: z.array(EDIT_ELEMENT_OP).min(1),
};

export const editElementsTool: ToolDefinition<typeof EDIT_ELEMENTS_INPUT> = {
    name: "edit_elements",
    description:
        "Set symbol-instance properties on 1-based keyframes in a scene or library-symbol timeline, or add a Library item to a named layer and frame. Add creates a missing layer and extends the timeline; omitted coordinates use the stage center. Graphic instances support loop and firstFrame; swapSymbol replaces the selected instance's Library symbol. Existing layer and element references are names or zero-based indexes; all operations are validated before any write, tween interiors and non-instance elements are refused, and temporary layer unlocks, selection, and the current frame are restored. Rotation and skew cannot be set together in one operation. Supplying filters replaces all existing filters; [] clears them. Read-back element fields match inspect_timeline, plus layer/frame/element references. Animate may quantize transform values. Changes do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: EDIT_ELEMENTS_INPUT,
    guidance: {
        basic: "- Use edit_elements to set instance properties on keyframes; tween interiors are refused, and the .fla is not saved.",
    },
    run: async (
        { timeline, document, ops }: Parameters<ToolCallback<typeof EDIT_ELEMENTS_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const code = jsflRun(
            "edit-elements",
            { __docName: document ?? "", __timelineRef: timeline, __ops: ops },
            bundle,
        );
        const result = JSON.parse(String(await runner.execute(code))) as {
            applied: number;
            elements: Record<string, unknown>[];
        };
        return { data: result };
    },
};

export function registerEditElements(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, editElementsTool, deps);
}
