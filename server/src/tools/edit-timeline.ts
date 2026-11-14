import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "./shared.js";

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
    z.object({
        op: z.literal("distributeToLayers"),
        layer: z.string(),
        index: z.number().int().nonnegative().optional(),
    }),
]);
const EDIT_TIMELINE_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    ops: z.array(EDIT_TIMELINE_OP).min(1),
    document: z.string().optional(),
};

export const editTimelineTool: ToolDefinition<typeof EDIT_TIMELINE_INPUT> = {
    name: "edit_timeline",
    description:
        "Edit layers (addLayer, deleteLayer, moveLayer, renameLayer, setLayerType, distributeToLayers) and frames (insertFrames, removeFrames, insertKeyframe, clearKeyframe, setLabel, setSpanLength, shiftLayerFrames) in order. Layer references use a name and optional zero-based index; frame numbers are 1-based. distributeToLayers splits a single-span layer of symbol instances into one layer per instance. shiftLayerFrames moves one layer's full content later without shifting other layers; it uses cut/paste (overwrites the clipboard, and if it fails midway the layer may be left changed: undo in Animate). Stops at the first failed op. deleteLayer and removeFrames require confirm: true. Tween interiors reject frame insertion/removal/keyframe changes. Always run export_scripts again before editing or applying scripts. Changes apply to the open document but do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: EDIT_TIMELINE_INPUT,
    guidance: {
        basic: "- Use edit_timeline for layer or frame structure changes. shiftLayerFrames moves one layer's content later without shifting other layers. Always run export_scripts again before editing or applying scripts; delete operations require confirm: true.",
    },
    run: async (
        { timeline, ops, document }: Parameters<ToolCallback<typeof EDIT_TIMELINE_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const code = jsflRun(
            "timeline-index",
            { __docName: document ?? "", __timelineRef: timeline, __ops: ops },
            bundle,
        );
        const result = JSON.parse(String(await runner.execute(code))) as {
            applied: ((typeof ops)[number] & { createdLayers?: string[] })[];
            failed: { op: (typeof ops)[number]; error: string } | null;
            skipped: typeof ops;
            warnings: string[];
            layers: { name: string; type: string; parent?: string; locked: boolean }[];
        };
        return { data: result, text: `Export again before apply_scripts.\n${JSON.stringify(result)}` };
    },
};

export function registerEditTimeline(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, editTimelineTool, deps);
}
