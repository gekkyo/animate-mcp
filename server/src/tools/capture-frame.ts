import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

type CaptureResult = { path: string; frame: number; timeline: string; width: number; height: number };

const CAPTURE_FRAME_INPUT = {
    frame: z.number().int().optional().describe("1-based timeline frame; defaults to the current frame"),
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
    /** Captures one frame from the active timeline and returns its PNG.
     * @param frame Optional 1-based frame number
     * @param dir Optional output directory
     * @returns Tool result containing the image and capture metadata, or an MCP error result
     */
    const handleCaptureFrame: ToolCallback<typeof CAPTURE_FRAME_INPUT> = async ({ frame, dir }) => {
        try {
            const outputDir = dir === undefined ? undefined : resolve(dir);
            const prelude = [
                `var __captureFrame = ${frame ?? "null"};`,
                `var __captureDir = ${JSON.stringify(outputDir ?? "")};`,
                `var __captureRoot = ${JSON.stringify(join(homedir(), ".animate-mcp", "captures"))};`,
            ].join("\n");
            const result = JSON.parse(
                String(await runner.execute(`${prelude}\n${bundle("export-common", "capture-frame")}`)),
            ) as CaptureResult;
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
                "Capture one frame of the active AS3 or HTML5 Canvas timeline as a PNG image. Defaults to the current frame and saves a new file under ~/.animate-mcp/captures/<document>/. Unsaved documents are supported; the timeline frame is restored after capture, but changing frames may clear the selection. Stages larger than 2048px on either side are not scaled.",
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
