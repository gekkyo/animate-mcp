import { open, readFile, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PNG } from "pngjs";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const INPUT = {
    before: z.string().min(1).describe("Absolute path to the earlier Capture PNG"),
    after: z.string().min(1).describe("Absolute path to the later Capture PNG"),
    tolerance: z.number().int().min(0).max(255).default(8).describe("Per-channel difference threshold (0–255)"),
};

function isInside(root: string, path: string): boolean {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

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

function decode(path: string, bytes: Buffer): PNG {
    try {
        return PNG.sync.read(bytes);
    } catch {
        throw new Error(`Invalid PNG: ${path}`);
    }
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
    run: async ({ before, after, tolerance }: Parameters<ToolCallback<typeof INPUT>>[0]) => {
        const root = await realpath(join(homedir(), ".animate-mcp", "captures")).catch(() => {
            throw new Error("Capture directory does not exist");
        });
        const beforePath = await capturePath(before, root);
        const afterPath = await capturePath(after, root);
        const [beforeBytes, afterBytes] = await Promise.all([readFile(beforePath), readFile(afterPath)]);
        const left = decode(beforePath, beforeBytes);
        const right = decode(afterPath, afterBytes);
        if (left.width !== right.width || left.height !== right.height) {
            throw new Error(
                `Capture dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`,
            );
        }

        const diff = new PNG({ width: left.width, height: left.height });
        let changedPixels = 0;
        let minX = left.width;
        let minY = left.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < left.height; y++) {
            for (let x = 0; x < left.width; x++) {
                const offset = (y * left.width + x) * 4;
                const changed = [0, 1, 2, 3].some(
                    (channel) => Math.abs(left.data[offset + channel] - right.data[offset + channel]) > tolerance,
                );
                if (changed) {
                    changedPixels++;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                    diff.data[offset] = 255;
                    diff.data[offset + 3] = 255;
                }
            }
        }

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
            changedPercentage: (changedPixels / (left.width * left.height)) * 100,
            boundingBox:
                changedPixels === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
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

export function registerDiffCaptures(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, diffCapturesTool, deps);
}
