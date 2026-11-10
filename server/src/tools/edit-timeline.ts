import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;
const EDIT_TIMELINE_OP = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("addLayer"),
        name: z.string().min(1),
        type: z.enum(["normal", "mask", "masked", "guide", "folder"]).optional(),
        parent: z.string().optional(),
        above: z.string().optional(),
        below: z.string().optional(),
    }),
    z.object({
        op: z.literal("deleteLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        confirm: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("moveLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        above: z.string().optional(),
        below: z.string().optional(),
        parent: z.string().optional(),
    }),
    z.object({
        op: z.literal("renameLayer"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        name: z.string().min(1),
    }),
    z.object({
        op: z.literal("setLayerType"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        type: z.enum(["normal", "mask", "masked", "guide", "folder"]),
        parent: z.string().optional(),
    }),
    z.object({
        op: z.literal("insertFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        count: z.number().int().positive(),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("removeFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        count: z.number().int().positive(),
        confirm: z.boolean().optional(),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("insertKeyframe"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
    }),
    z.object({
        op: z.literal("clearKeyframe"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
    }),
    z.object({
        op: z.literal("setLabel"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        label: z.string(),
    }),
    z.object({
        op: z.literal("setSpanLength"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        frame: z.number().int().positive(),
        length: z.number().int().min(2),
        ripple: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("shiftLayerFrames"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
        offset: z.number().int().positive(),
    }),
]);
const EDIT_TIMELINE_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    ops: z.array(EDIT_TIMELINE_OP).min(1),
    document: z.string().optional(),
};

/**
 * Registers the edit_timeline tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerEditTimeline(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Edits one timeline's layer and frame structure, then requires a fresh Export.
     * @param timeline Scene index (zero-based number) or library item path (string)
     * @param ops Ordered layer and frame operations
     * @param document Optional document name to select
     * @returns Tool result containing applied, failed, skipped, warning, and layer details
     */
    const handleEditTimeline: ToolCallback<typeof EDIT_TIMELINE_INPUT> = async ({ timeline, ops, document }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __timelineRef = ${JSON.stringify(timeline)};\nvar __ops = ${JSON.stringify(ops)};\n${bundle("select-document", "edit-state", "export-common", "edit-timeline")}`;
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
        "edit_timeline",
        {
            description:
                "Edit layers (addLayer, deleteLayer, moveLayer, renameLayer, setLayerType) and frames (insertFrames, removeFrames, insertKeyframe, clearKeyframe, setLabel, setSpanLength, shiftLayerFrames) in order. Layer references use a name and optional zero-based index; frame numbers are 1-based. shiftLayerFrames moves one layer's full content later without shifting other layers; it uses cut/paste (overwrites the clipboard, and if it fails midway the layer may be left changed: undo in Animate). Stops at the first failed op. deleteLayer and removeFrames require confirm: true. Tween interiors reject frame insertion/removal/keyframe changes. Always run export_scripts again before editing or applying scripts.",
            inputSchema: EDIT_TIMELINE_INPUT,
        },
        handleEditTimeline,
    );
}
