import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const EASE_PRESETS = [
    "linear",
    "quadIn",
    "quadOut",
    "quadInOut",
    "cubicIn",
    "cubicOut",
    "cubicInOut",
    "quartIn",
    "quartOut",
    "quartInOut",
    "quintIn",
    "quintOut",
    "quintInOut",
    "sineIn",
    "sineOut",
    "sineInOut",
    "expoIn",
    "expoOut",
    "expoInOut",
    "circIn",
    "circOut",
    "circInOut",
    "backIn",
    "backOut",
    "backInOut",
];
// A string + refine keeps the emitted JSON schema small (an enum repeated per property exceeds scanners' string budget); the tool description lists the presets.
const EASE_PRESET = z.string().refine((value) => EASE_PRESETS.includes(value), { message: "Unknown ease preset" });
const EASE = z
    .union([EASE_PRESET, z.number().min(-100).max(100), z.tuple([z.number(), z.number(), z.number(), z.number()])])
    .meta({ id: "Ease" });
const FILTER = z
    .object({
        x: z.number().nonnegative().optional(),
        y: z.number().nonnegative().optional(),
        blurX: z.number().nonnegative().optional(),
        blurY: z.number().nonnegative().optional(),
        color: z.string().optional(),
        alpha: z.number().min(0).max(100).optional(),
        strength: z.number().min(0).max(255).optional(),
        quality: z.number().int().min(1).max(15).optional(),
        distance: z.number().optional(),
        angle: z.number().optional(),
        inner: z.boolean().optional(),
        knockout: z.boolean().optional(),
        hideObject: z.boolean().optional(),
    })
    .meta({ id: "TweenFilter" });
const KEYFRAME = z.object({
    frame: z.number().int().positive(),
    x: z.number().optional(),
    dx: z.number().optional(),
    y: z.number().optional(),
    dy: z.number().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    rotation: z.number().optional(),
    alpha: z.number().min(0).max(100).optional(),
    brightness: z.number().min(-100).max(100).optional(),
    tint: z.object({ color: z.string(), amount: z.number().min(0).max(100) }).optional(),
    blur: FILTER.optional(),
    glow: FILTER.optional(),
    dropShadow: FILTER.optional(),
    ease: z
        .union([
            EASE,
            z.object({
                default: EASE.optional(),
                x: EASE.optional(),
                y: EASE.optional(),
                rotation: EASE.optional(),
                scaleX: EASE.optional(),
                scaleY: EASE.optional(),
                alpha: EASE.optional(),
                brightness: EASE.optional(),
                tint: EASE.optional(),
                blur: EASE.optional(),
                glow: EASE.optional(),
                dropShadow: EASE.optional(),
            }),
        ])
        .optional(),
});
const EDIT_TWEEN_OP = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("createShapeTween"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        from: z.number().int().positive(),
        to: z.number().int().positive(),
        ease: z.number().min(-100).max(100).optional(),
        blend: z.enum(["distributive", "angular"]).optional(),
    }),
    z.object({
        op: z.literal("createTween"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        instance: z.string().min(1),
        kind: z.enum(["motion", "classic"]).optional(),
        keyframes: z
            .array(KEYFRAME)
            .min(2)
            .refine(
                (keyframes) =>
                    keyframes.some((keyframe) =>
                        Object.keys(keyframe).some((key) => key !== "frame" && key !== "ease"),
                    ),
                {
                    message: "At least one tween property is required",
                },
            ),
    }),
    z.object({
        op: z.literal("setEase"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        ease: EASE,
    }),
]);
const EDIT_TWEEN_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    ops: z.array(EDIT_TWEEN_OP).min(1),
    document: z.string().optional(),
};

export const editTweenTool: ToolDefinition<typeof EDIT_TWEEN_INPUT> = {
    name: "edit_tween",
    description:
        "Create motion (default) or classic tweens for a named instance with createTween, shape tweens with createShapeTween (no shape hints), or change easing on an existing tween with setEase. Shape tweens require raw shapes on both keyframes. Frames are 1-based; layer references use a name and optional zero-based index. For createTween, the instance must be the only element on its layer. Existing tween spans are not replaced. Alpha, brightness, and tint are mutually exclusive Animate color modes. Ease presets include quad, cubic, quart, quint, sine, expo, circ, back In/Out/InOut and linear. Stops at the first failed op. Always run export_scripts again before editing or applying scripts. Changes apply to the open document but do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: EDIT_TWEEN_INPUT,
    guidance: {
        basic: "- Use edit_tween to animate instances; motion is the default and ease presets include quad, cubic, quart, quint, sine, expo, circ and back.",
    },
    /**
     * Applies tween creation and easing operations to the selected timeline.
     * @param timeline Scene index or Library item path.
     * @param ops Tween operations to apply.
     * @param document Optional document selector.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Applied, failed, and skipped operations with current layer metadata.
     */
    run: async ({ timeline, ops, document }: Parameters<ToolCallback<typeof EDIT_TWEEN_INPUT>>[0], deps: ToolDeps) => {
        const { runner, bundle } = deps;

        const code = jsflRun("tween-index", { __docName: document ?? "", __timelineRef: timeline, __ops: ops }, bundle);
        const result = JSON.parse(String(await runner.execute(code))) as {
            applied: typeof ops;
            failed: { op: (typeof ops)[number]; error: string } | null;
            skipped: typeof ops;
            warnings: string[];
            layers: { name: string; type: string; parent?: string; locked: boolean }[];
        };
        return { data: result, text: `Export again before apply_scripts.\n${JSON.stringify(result)}` };
    },
};

/**
 * Registers the edit_tween tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerEditTween(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, editTweenTool, deps);
}
