import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;
const EASE_PRESET = z.enum([
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
]);
const EASE = z.union([
    EASE_PRESET,
    z.number().min(-100).max(100),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);
const FILTER = z.object({
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
});
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

/**
 * Registers the edit_tween tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerEditTween(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Applies instance-tween operations to a scene or library-item timeline.
     * @param timeline Scene index (zero-based number) or library item path (string)
     * @param ops Ordered tween operations
     * @param document Optional document name to select
     * @returns Tool result containing applied, failed, skipped, warning, and layer details
     */
    const handleEditTween: ToolCallback<typeof EDIT_TWEEN_INPUT> = async ({ timeline, ops, document }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __timelineRef = ${JSON.stringify(timeline)};\nvar __ops = ${JSON.stringify(ops)};\n${bundle("select-document", "edit-state", "export-common", "timeline-helpers", "tween-index")}`;
            const result = JSON.parse(String(await runner.execute(code))) as {
                applied: typeof ops;
                failed: { op: (typeof ops)[number]; error: string } | null;
                skipped: typeof ops;
                warnings: string[];
                layers: { name: string; type: string; parent?: string; locked: boolean }[];
            };
            return {
                content: [{ type: "text", text: `Export again before apply_scripts.\n${JSON.stringify(result)}` }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "edit_tween",
        {
            description:
                "Create motion (default) or classic tweens for a named instance with createTween, or change easing on an existing tween with setEase. Frames are 1-based; layer references use a name and optional zero-based index. The instance must be the only element on its layer; existing tween spans are not replaced. Alpha, brightness, and tint are mutually exclusive Animate color modes. Ease presets include quad, cubic, quart, quint, sine, expo, circ, back In/Out/InOut and linear. Stops at the first failed op. Always run export_scripts again before editing or applying scripts. Changes apply to the open document but do not save the .fla; save it in Animate.",
            annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            inputSchema: EDIT_TWEEN_INPUT,
        },
        handleEditTween,
    );
}
