import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const INSPECT_TIMELINE_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    layers: z
        .array(z.union([z.string().min(1), z.number().int().nonnegative()]))
        .optional()
        .describe("Layer names or zero-based indexes; defaults to all layers"),
    frame: z.number().int().positive().default(1).describe("Frame number, 1-based; defaults to 1"),
    geometry: z.boolean().default(false).describe("Include element bounds and symbol playback metadata"),
    document: z.string().optional(),
};
const INSPECT_TIMELINE_RESULT = z
    .object({
        timeline: z.union([z.number(), z.string()]),
        frame: z.number(),
        warning: z.string().optional(),
        layers: z.array(
            z
                .object({
                    name: z.string(),
                    index: z.number(),
                    type: z.string(),
                    parent: z.string().nullable(),
                    locked: z.boolean(),
                    visible: z.boolean(),
                    frameCount: z.number(),
                    spans: z.array(
                        z
                            .object({
                                start: z.number(),
                                end: z.number(),
                                keyframe: z.boolean(),
                                tweenType: z.string(),
                                ease: z.number().nullable().optional(),
                                blend: z.string().nullable().optional(),
                                label: z.string().optional(),
                            })
                            .passthrough(),
                    ),
                    elements: z.array(z.record(z.string(), z.unknown())),
                    motionKeyframes: z
                        .array(
                            z
                                .object({
                                    frame: z.number(),
                                    values: z.record(z.string(), z.string()),
                                })
                                .passthrough(),
                        )
                        .optional(),
                })
                .passthrough(),
        ),
    })
    .passthrough();

export const inspectTimelineTool: ToolDefinition<typeof INSPECT_TIMELINE_INPUT> = {
    name: "inspect_timeline",
    description:
        "Read layer metadata, keyframe spans, and element properties at a 1-based frame in a scene or library symbol. Text elements include their string and whole-field style. Specify layers by name or zero-based index; defaults to all layers and frame 1. Set geometry to include element bounds and symbol playback metadata; tween interior coordinates are marked interpolated and omit their unreliable matrix.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: INSPECT_TIMELINE_INPUT,
    guidance: {
        basic: "- Use inspect_timeline to check instances and tweens instead of run_jsfl; use the distributeToLayers operation to split a layer.",
    },
    /**
     * Reads layer, span, and element details at the requested timeline frame.
     * @param timeline Scene index or Library item path.
     * @param layers Optional layer names or zero-based indexes to inspect.
     * @param frame 1-based frame to inspect.
     * @param document Optional document selector.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Timeline and layer details for the requested frame.
     */
    run: async (
        { timeline, layers, frame, geometry, document }: Parameters<ToolCallback<typeof INSPECT_TIMELINE_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const result = await deps.jsfl.run(
            "timeline/inspect-timeline",
            {
                __docName: document ?? "",
                __timelineRef: timeline,
                __layers: layers,
                __frame: frame,
                __geometry: geometry,
            },
            INSPECT_TIMELINE_RESULT,
        );
        return { data: result };
    },
};

/**
 * Registers the inspect_timeline tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerInspectTimeline(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, inspectTimelineTool, deps);
}
