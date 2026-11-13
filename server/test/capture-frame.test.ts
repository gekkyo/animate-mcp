import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stateLog, text, withServer } from "./helpers/fake-animate.js";

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHqkAAAAASUVORK5CYII=",
    "base64",
);

test("capture_frame returns PNG and metadata, uses the default directory, and restores the current frame", {
    timeout: 30_000,
}, async () => {
    const home = join(tmpdir(), `animate-mcp-capture-home-${randomUUID()}`);
    try {
        await withServer({ HOME: home, FAKE_INITIAL_CURRENT_FRAME: "2" }, async (client, tempDir) => {
            const captures = join(home, ".animate-mcp", "captures", "a");
            const first = await client.callTool({ name: "capture_frame", arguments: {} });
            assert.equal(first.isError, undefined, text(first));
            const structured = first.structuredContent as {
                path: string;
                frame: number;
                timeline: string;
                width: number;
                height: number;
            };
            assert.equal(structured.frame, 3);
            assert.equal(structured.timeline, "Scene 1");
            assert.equal(structured.width, 550);
            assert.equal(structured.height, 400);
            const image = first.content.find((item) => item.type === "image");
            assert.equal(image?.type, "image");
            if (image?.type !== "image") {
                throw new Error("capture_frame did not return an image");
            }
            assert.equal(image.mimeType, "image/png");
            assert.deepEqual(Buffer.from(image.data, "base64"), PNG);
            const textContent = first.content.find((item) => item.type === "text");
            assert.equal(textContent?.type, "text");
            if (textContent?.type !== "text") {
                throw new Error("capture_frame did not return metadata text");
            }
            const metadata = JSON.parse(textContent.text);
            assert.deepEqual(metadata, structured);
            assert.ok(metadata.path.startsWith(`${captures}/`));
            assert.deepEqual(await readFile(metadata.path), PNG);

            const fifth = await client.callTool({ name: "capture_frame", arguments: { frame: 5 } });
            assert.equal(fifth.isError, undefined, text(fifth));
            assert.equal((fifth.structuredContent as { frame: number }).frame, 5);
            assert.notEqual((fifth.structuredContent as { path: string }).path, metadata.path);
            assert.deepEqual(await readFile((fifth.structuredContent as { path: string }).path), PNG);
            assert.deepEqual(
                (await stateLog(tempDir)).map((state) => state.currentFrame),
                [2, 2],
            );
        });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test("capture_frame accepts unsaved HTML5 Canvas documents and a directory override", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_TYPE: "htmlcanvas", FAKE_UNSAVED: "1" }, async (client, tempDir) => {
        const dir = join(tempDir, "capture override");
        const result = await client.callTool({ name: "capture_frame", arguments: { frame: 1, dir } });
        assert.equal(result.isError, undefined, text(result));
        assert.equal((result.structuredContent as { frame: number }).frame, 1);
        assert.ok((result.structuredContent as { path: string }).path.startsWith(`${dir}/`));
        assert.deepEqual(await readFile((result.structuredContent as { path: string }).path), PNG);
    });
});

test("capture_frame reports missing documents, invalid frames, and oversized stages", { timeout: 40_000 }, async () => {
    await withServer({ FAKE_NO_DOC: "1" }, async (client) => {
        const result = await client.callTool({ name: "capture_frame", arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(text(result), "No document open");
    });
    await withServer({}, async (client) => {
        for (const frame of [0, 6]) {
            const result = await client.callTool({ name: "capture_frame", arguments: { frame } });
            assert.equal(result.isError, true);
            assert.equal(text(result), `Frame ${frame} does not exist (timeline has 5 frames)`);
        }
    });
    await withServer({ FAKE_WIDTH: "2049" }, async (client) => {
        const result = await client.callTool({ name: "capture_frame", arguments: {} });
        assert.equal(result.isError, true);
        assert.match(text(result), /Stage size 2049x400 exceeds 2048px/);
    });
});

test("capture_frame restores the frame when export fails", { timeout: 20_000 }, async () => {
    for (const failure of [{ FAKE_EXPORT_FALSE: "1" }, { FAKE_EXPORT_MISSING: "1" }]) {
        await withServer({ ...failure, FAKE_INITIAL_CURRENT_FRAME: "2" }, async (client, tempDir) => {
            const result = await client.callTool({ name: "capture_frame", arguments: { frame: 5 } });
            assert.equal(result.isError, true);
            assert.equal(text(result), "Capture export failed");
            assert.deepEqual(
                (await stateLog(tempDir)).map((state) => state.currentFrame),
                [2],
            );
        });
    }
});
