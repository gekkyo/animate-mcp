import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "./shared.js";

type CaptureResult = { path: string; frame: number; timeline: string; width: number; height: number };
type CaptureResponse = CaptureResult | { captures: CaptureResult[] };

const CAPTURE_RANGE_INPUT = z
    .object({
        start: z.number().int().min(1),
        end: z.number().int().min(1),
        step: z.number().int().min(1).optional(),
    })
    .strict()
    .refine(({ start, end }) => end >= start, "range.end must be greater than or equal to range.start");

const CAPTURE_FRAME_INPUT = {
    frame: z.number().int().optional().describe("1-based timeline frame; defaults to the current frame"),
    range: CAPTURE_RANGE_INPUT.optional().describe(
        "Inclusive ascending range; captures at most 24 frames, with step defaulting to 1",
    ),
    dir: z.string().optional().describe("Output directory; defaults to ~/.animate-mcp/captures/<document>/"),
};

export const captureFrameTool: ToolDefinition<typeof CAPTURE_FRAME_INPUT> = {
    name: "capture_frame",
    description:
        "Capture one frame or an inclusive ascending range of the active AS3 or HTML5 Canvas timeline as PNG images. Specify either frame (defaults to the current frame) or range {start, end, step?}; range step defaults to 1 and at most 24 frames may be captured. Saves new files under ~/.animate-mcp/captures/<document>/. Unsaved documents are supported; the timeline frame is restored after capture, but changing frames may clear the selection. Stages larger than 2048px on either side are not scaled.",
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    inputSchema: CAPTURE_FRAME_INPUT,
    guidance: {
        basic: "- Use capture_frame to inspect the active timeline as PNG images; request one frame or an inclusive range of up to 24 frames. It saves new images under ~/.animate-mcp/captures/<document>/ and restores the current frame.",
    },
    run: async ({ frame, range, dir }: Parameters<ToolCallback<typeof CAPTURE_FRAME_INPUT>>[0], deps: ToolDeps) => {
        const { runner, bundle } = deps;

        if (frame !== undefined && range !== undefined) {
            throw new Error("Specify either frame or range, not both");
        }
        if (range && Math.floor((range.end - range.start) / (range.step ?? 1)) + 1 > 24) {
            throw new Error("Capture range cannot exceed 24 frames");
        }
        const outputDir = dir === undefined ? undefined : resolve(dir);
        const prelude = [
            `var __captureFrame = ${frame ?? "null"};`,
            `var __captureRange = ${JSON.stringify(range ?? null)};`,
            `var __captureDir = ${JSON.stringify(outputDir ?? "")};`,
            `var __captureRoot = ${JSON.stringify(join(homedir(), ".animate-mcp", "captures"))};`,
        ].join("\n");
        const result = JSON.parse(
            String(await runner.execute(`${prelude}\n${bundle("capture-frame")}`)),
        ) as CaptureResponse;
        if ("captures" in result) {
            const content = [];
            for (const capture of result.captures) {
                const image = await readFile(capture.path);
                content.push(
                    { type: "image" as const, data: image.toString("base64"), mimeType: "image/png" as const },
                    { type: "text" as const, text: JSON.stringify(capture) },
                );
            }
            return { data: result, content: content };
        }
        const image = await readFile(result.path);
        return {
            data: result,
            content: [
                { type: "image", data: image.toString("base64"), mimeType: "image/png" },
                { type: "text", text: JSON.stringify(result) },
            ],
        };
    },
};

export function registerCaptureFrame(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, captureFrameTool, deps);
}
