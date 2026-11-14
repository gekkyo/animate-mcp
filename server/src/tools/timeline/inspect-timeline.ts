import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const INSPECT_TIMELINE_INPUT = {
    timeline: z
        .union([z.number().int().nonnegative(), z.string().min(1)])
        .describe("Scene index (0-based number) or library item path (string)"),
    layers: z
        .array(z.union([z.string().min(1), z.number().int().nonnegative()]))
        .optional()
        .describe("Layer names or zero-based indexes; defaults to all layers"),
    frame: z.number().int().positive().default(1).describe("Frame number, 1-based; defaults to 1"),
    document: z.string().optional(),
};

export const inspectTimelineTool: ToolDefinition<typeof INSPECT_TIMELINE_INPUT> = {
    name: "inspect_timeline",
    description:
        "Read layer metadata, keyframe spans, and element properties at a 1-based frame in a scene or library symbol. Text elements include their string and whole-field style. Specify layers by name or zero-based index; defaults to all layers and frame 1. Motion tween properties are reported from motion keyframes rather than unreliable interpolated instances.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: INSPECT_TIMELINE_INPUT,
    guidance: {
        basic: "- Use inspect_timeline to check instances and tweens instead of run_jsfl; use the distributeToLayers operation to split a layer.",
    },
    run: async (
        { timeline, layers, frame, document }: Parameters<ToolCallback<typeof INSPECT_TIMELINE_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const code = jsflRun(
            "inspect-timeline",
            { __docName: document ?? "", __timelineRef: timeline, __layers: layers, __frame: frame },
            bundle,
        );
        const result = JSON.parse(String(await runner.execute(code))) as {
            timeline: number | string;
            frame: number;
            warning?: string;
            layers: {
                name: string;
                index: number;
                type: string;
                parent: string | null;
                locked: boolean;
                visible: boolean;
                frameCount: number;
                spans: { start: number; end: number; keyframe: boolean; tweenType: string; label?: string }[];
                elements: Record<string, unknown>[];
                motionKeyframes?: { frame: number; values: Record<string, string> }[];
            }[];
        };
        return { data: result };
    },
};

export function registerInspectTimeline(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, inspectTimelineTool, deps);
}
