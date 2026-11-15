import { open, readFile, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PNG } from "pngjs";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";
import { comparePixels, decodePng, isInside } from "./image-diff.js";

const INPUT = {
    before: z.string().min(1).describe("Absolute path to the earlier Capture PNG"),
    after: z.string().min(1).describe("Absolute path to the later Capture PNG"),
    tolerance: z.number().int().min(0).max(255).default(8).describe("Per-channel difference threshold (0–255)"),
};

/**
 * Validates and resolves a Capture PNG path within the capture directory.
 * @param path User-supplied PNG path.
 * @param root Canonical capture directory.
 * @returns The canonical validated PNG path.
 */
async function capturePath(path: string, root: string): Promise<string> {
    if (!isAbsolute(path) || !path.toLowerCase().endsWith(".png")) {
        throw new Error(`Capture path must be an absolute PNG path: ${path}`);
    }
    const resolved = await realpath(path).catch(() => {
        throw new Error(`Cannot read Capture PNG: ${path}`);
    });
    if (!isInside(root, resolved)) {
        throw new Error(`Capture path must be inside ${root}: ${path}`);
    }
    return resolved;
}

export const diffCapturesTool: ToolDefinition<typeof INPUT> = {
    name: "diff_captures",
    description:
        "Compare two existing Capture PNGs. Paths must be inside ~/.animate-mcp/captures/. Returns changed pixels, percentage, an inclusive bounding box (or null when unchanged), and a new red-highlight PNG in the earlier Capture's directory. Per-channel tolerance defaults to 8.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: INPUT,
    guidance: {
        basic: "- Use diff_captures with absolute before/after paths returned by capture_frame. It creates a non-overwriting red-highlight PNG alongside the earlier Capture.",
    },
    /**
     * Compares two captures and writes a red-highlight image of changed pixels.
     * @param before Absolute path to the earlier capture.
     * @param after Absolute path to the later capture.
     * @param tolerance Maximum per-channel difference treated as unchanged.
     * @returns Comparison statistics and the generated difference image.
     */
    run: async ({ before, after, tolerance }: Parameters<ToolCallback<typeof INPUT>>[0]) => {
        const root = await realpath(join(homedir(), ".animate-mcp", "captures")).catch(() => {
            throw new Error("Capture directory does not exist");
        });
        const beforePath = await capturePath(before, root);
        const afterPath = await capturePath(after, root);
        const [beforeBytes, afterBytes] = await Promise.all([readFile(beforePath), readFile(afterPath)]);
        const left = decodePng(beforePath, beforeBytes);
        const right = decodePng(afterPath, afterBytes);
        if (left.width !== right.width || left.height !== right.height) {
            throw new Error(
                `Capture dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`,
            );
        }

        const { diff, changedPixels, changedPercent, boundingBox } = comparePixels(left, right, tolerance);

        const directory = dirname(beforePath);
        const stem = `${basename(beforePath, ".png")}-diff`;
        let outputPath: string;
        let handle: Awaited<ReturnType<typeof open>>;
        const outputBytes = PNG.sync.write(diff);
        for (let suffix = 1; ; suffix++) {
            outputPath = join(directory, `${stem}${suffix === 1 ? "" : `-${suffix}`}.png`);
            try {
                handle = await open(outputPath, "wx");
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                    throw new Error(`Cannot create diff PNG in ${directory}: ${String(error)}`);
                }
            }
        }
        try {
            await handle.writeFile(outputBytes);
        } catch (error) {
            await handle.close();
            await unlink(outputPath).catch(() => {});
            throw new Error(`Cannot write diff PNG: ${String(error)}`);
        }
        await handle.close();

        const data = {
            before: beforePath,
            after: afterPath,
            path: outputPath,
            width: left.width,
            height: left.height,
            changedPixels,
            changedPercentage: changedPercent,
            boundingBox,
        };
        return {
            data,
            content: [
                { type: "image", data: outputBytes.toString("base64"), mimeType: "image/png" },
                { type: "text", text: JSON.stringify(data) },
            ],
        };
    },
};

/**
 * Registers the diff_captures tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerDiffCaptures(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, diffCapturesTool, deps);
}
