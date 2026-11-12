import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;
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

/** Registers the read-only inspect_timeline tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerInspectTimeline(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Reads layer spans and element properties from a scene or library-symbol timeline.
     * @param timeline Scene index or library item path
     * @param layers Optional layer names or zero-based indexes
     * @param frame Requested one-based frame number
     * @param document Optional document name to select
     * @returns Tool result containing the requested timeline inspection
     */
    const handleInspectTimeline: ToolCallback<typeof INSPECT_TIMELINE_INPUT> = async ({
        timeline,
        layers,
        frame,
        document,
    }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __timelineRef = ${JSON.stringify(timeline)};\nvar __layers = ${JSON.stringify(layers)};\nvar __frame = ${frame};\n${bundle("select-document", "edit-state", "export-common", "inspect-timeline")}`;
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
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "inspect_timeline",
        {
            description:
                "Read layer metadata, keyframe spans, and element properties at a 1-based frame in a scene or library symbol. Specify layers by name or zero-based index; defaults to all layers and frame 1. Motion tween properties are reported from motion keyframes rather than unreliable interpolated instances.",
            inputSchema: INSPECT_TIMELINE_INPUT,
        },
        handleInspectTimeline,
    );
}
