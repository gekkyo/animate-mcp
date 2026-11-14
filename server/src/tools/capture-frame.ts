import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

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

/** Registers the capture_frame tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerCaptureFrame(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Captures one frame or an inclusive range from the active timeline.
     * @param frame Optional 1-based frame number
     * @param range Optional inclusive ascending frame range
     * @param dir Optional output directory
     * @returns Tool result containing the image and capture metadata, or an MCP error result
     */
    const handleCaptureFrame: ToolCallback<typeof CAPTURE_FRAME_INPUT> = async ({ frame, range, dir }) => {
        try {
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
                String(await runner.execute(`${prelude}\n${bundle("export-common", "capture-frame")}`)),
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
                return { content, structuredContent: result };
            }
            const image = await readFile(result.path);
            return {
                content: [
                    { type: "image", data: image.toString("base64"), mimeType: "image/png" },
                    { type: "text", text: JSON.stringify(result) },
                ],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "capture_frame",
        {
            description:
                "Capture one frame or an inclusive ascending range of the active AS3 or HTML5 Canvas timeline as PNG images. Specify either frame (defaults to the current frame) or range {start, end, step?}; range step defaults to 1 and at most 24 frames may be captured. Saves new files under ~/.animate-mcp/captures/<document>/. Unsaved documents are supported; the timeline frame is restored after capture, but changing frames may clear the selection. Stages larger than 2048px on either side are not scaled.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: CAPTURE_FRAME_INPUT,
        },
        handleCaptureFrame,
    );
}
