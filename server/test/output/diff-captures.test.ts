import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PNG } from "pngjs";
import { text, withServer } from "../helpers/fake-animate.js";

/** Narrows an MCP result before accessing its content blocks.
 * @param result Value returned by the MCP client
 * @returns Whether the value is a call-tool result
 */
function isCallToolResult(result: unknown): result is CallToolResult {
    return typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content);
}

/** Encodes RGBA pixels as a PNG fixture.
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param pixels RGBA values in row-major order
 * @returns The encoded PNG bytes
 */
function png(width: number, height: number, pixels: Array<[number, number, number, number]>): Buffer {
    const image = new PNG({ width, height });
    for (let i = 0; i < pixels.length; i++) {
        image.data.set(pixels[i], i * 4);
    }
    return PNG.sync.write(image);
}

test("diff_captures compares real PNGs, applies channel tolerance, and returns a red diff image", async () => {
    const home = join(tmpdir(), `animate-mcp-diff-${process.pid}-${Date.now()}`);
    const dir = join(home, ".animate-mcp", "captures", "doc");
    await mkdir(dir, { recursive: true });
    try {
        const beforePath = join(dir, "before.png");
        const afterPath = join(dir, "after.png");
        const before = png(
            3,
            2,
            Array.from({ length: 6 }, () => [10, 20, 30, 255]),
        );
        const after = png(3, 2, [
            [18, 28, 38, 255], // boundary: ignored
            [19, 20, 30, 255], // over boundary
            [10, 20, 30, 255],
            [10, 20, 30, 255],
            [10, 20, 30, 255],
            [10, 20, 30, 255],
        ]);
        await writeFile(beforePath, before);
        await writeFile(afterPath, after);

        await withServer({ HOME: home }, async (client) => {
            const result = await client.callTool({
                name: "diff_captures",
                arguments: { before: beforePath, after: afterPath, tolerance: 8 },
            });
            assert.equal(result.isError, undefined, text(result));
            const data = result.structuredContent as {
                path: string;
                changedPixels: number;
                changedPercentage: number;
                boundingBox: { x: number; y: number; width: number; height: number } | null;
            };
            assert.equal(data.changedPixels, 1);
            assert.ok(Math.abs(data.changedPercentage - 100 / 6) < Number.EPSILON * 100);
            assert.deepEqual(data.boundingBox, { x: 1, y: 0, width: 1, height: 1 });
            assert.ok(data.path.endsWith("/before-diff.png"));
            assert.deepEqual((await readdir(dir)).sort(), ["after.png", "before-diff.png", "before.png"]);

            assert.ok(isCallToolResult(result));
            const image = result.content.find((item) => item.type === "image");
            assert.equal(image?.type, "image");
            if (image?.type === "image") {
                const output = PNG.sync.read(Buffer.from(image.data, "base64"));
                assert.deepEqual([...output.data.slice(4, 8)], [255, 0, 0, 255]);
                assert.deepEqual([...output.data.slice(0, 4)], [0, 0, 0, 0]);
                assert.deepEqual(await readFile(data.path), PNG.sync.write(output));
            }
            const metadata = result.content.find((item) => item.type === "text");
            assert.equal(metadata?.type, "text");
            if (metadata?.type === "text") {
                assert.deepEqual(JSON.parse(metadata.text), data);
            }

            const equal = await client.callTool({
                name: "diff_captures",
                arguments: { before: beforePath, after: beforePath },
            });
            assert.equal(equal.isError, undefined, text(equal));
            const equalData = equal.structuredContent as { changedPixels: number; boundingBox: unknown; path: string };
            assert.equal(equalData.changedPixels, 0);
            assert.equal(equalData.boundingBox, null);
            assert.ok(equalData.path.endsWith("/before-diff-2.png"));
        });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test("diff_captures gives explicit errors for mismatched, invalid, and out-of-root inputs", async () => {
    const home = join(tmpdir(), `animate-mcp-diff-errors-${process.pid}-${Date.now()}`);
    const dir = join(home, ".animate-mcp", "captures", "doc");
    await mkdir(dir, { recursive: true });
    const first = join(dir, "first.png");
    const other = join(dir, "other.png");
    const invalid = join(dir, "invalid.png");
    const outside = join(home, "outside.png");
    await writeFile(first, png(1, 1, [[0, 0, 0, 255]]));
    await writeFile(
        other,
        png(2, 1, [
            [0, 0, 0, 255],
            [0, 0, 0, 255],
        ]),
    );
    await writeFile(invalid, "not a png");
    await writeFile(outside, png(1, 1, [[0, 0, 0, 255]]));
    try {
        await withServer({ HOME: home }, async (client) => {
            for (const [before, after, expected] of [
                [first, other, "Capture dimensions differ"],
                [first, invalid, "Invalid PNG:"],
                [first, outside, "Capture path must be inside"],
            ]) {
                const result = await client.callTool({ name: "diff_captures", arguments: { before, after } });
                assert.equal(result.isError, true);
                assert.match(text(result), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            }
        });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
