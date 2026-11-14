import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("capture_frame returns ordered PNGs and metadata for an inclusive range", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_INITIAL_CURRENT_FRAME: "2" }, async (client, tempDir) => {
        const dir = join(tempDir, "range captures");
        const result = await client.callTool({
            name: "capture_frame",
            arguments: { range: { start: 1, end: 5, step: 2 }, dir },
        });
        assert.equal(result.isError, undefined, text(result));
        const captures = (
            result.structuredContent as { captures: Array<{ frame: number; path: string; timeline: string }> }
        ).captures;
        assert.deepEqual(
            captures.map(({ frame }) => frame),
            [1, 3, 5],
        );
        assert.ok(captures.every(({ path, timeline }) => path.startsWith(`${dir}/`) && timeline === "Scene 1"));
        const content = result.content;
        assert.deepEqual(
            content.map(({ type }) => type),
            ["image", "text", "image", "text", "image", "text"],
        );
        for (let index = 0; index < captures.length; index++) {
            const image = content[index * 2];
            const metadata = content[index * 2 + 1];
            assert.equal(image?.type, "image");
            if (image?.type === "image") {
                assert.equal(image.mimeType, "image/png");
                assert.deepEqual(Buffer.from(image.data, "base64"), PNG);
                assert.deepEqual(await readFile(captures[index].path), PNG);
            }
            assert.equal(metadata?.type, "text");
            if (metadata?.type === "text") {
                assert.deepEqual(JSON.parse(metadata.text), captures[index]);
            }
        }
        const defaultStep = await client.callTool({
            name: "capture_frame",
            arguments: { range: { start: 2, end: 3 }, dir },
        });
        assert.equal(defaultStep.isError, undefined, text(defaultStep));
        assert.deepEqual(
            (defaultStep.structuredContent as { captures: Array<{ frame: number }> }).captures.map(
                ({ frame }) => frame,
            ),
            [2, 3],
        );
        assert.deepEqual(
            (await stateLog(tempDir)).map(({ currentFrame }) => currentFrame),
            [2, 2],
        );
        assert.deepEqual(
            (await readFile(join(tempDir, "log.capture"), "utf8"))
                .trim()
                .split("\n")
                .map((entry) => JSON.parse(entry).frame),
            [0, 2, 4, 1, 2],
        );
    });
});

test("capture_frame rejects invalid or oversized ranges before launching Animate", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        for (const args of [
            { frame: 1, range: { start: 1, end: 2 } },
            { range: { start: 0, end: 2 } },
            { range: { start: 2, end: 1 } },
            { range: { start: 1, end: 3, step: 0 } },
            { range: { start: 1, end: 25 } },
            { range: { start: 1, end: 2, unexpected: true } },
        ]) {
            const result = await client.callTool({ name: "capture_frame", arguments: args });
            assert.equal(result.isError, true);
        }
        await assert.rejects(readFile(join(tempDir, "log")), { code: "ENOENT" });
    });
});

test("capture_frame accepts exactly 24 captures", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_FRAME_COUNT: "24" }, async (client, tempDir) => {
        const tooMany = await client.callTool({ name: "capture_frame", arguments: { range: { start: 1, end: 25 } } });
        assert.equal(tooMany.isError, true);
        await assert.rejects(readFile(join(tempDir, "log")), { code: "ENOENT" });

        const dir = join(tempDir, "24 captures");
        const result = await client.callTool({
            name: "capture_frame",
            arguments: { range: { start: 1, end: 24 }, dir },
        });
        assert.equal(result.isError, undefined, text(result));
        const captures = (result.structuredContent as { captures: Array<{ frame: number }> }).captures;
        assert.deepEqual(
            captures.map(({ frame }) => frame),
            Array.from({ length: 24 }, (_, index) => index + 1),
        );
        assert.equal(result.content.filter((item) => item.type === "image").length, 24);
        assert.equal(result.content.filter((item) => item.type === "text").length, 24);
        assert.equal((await readdir(dir)).filter((name) => name.endsWith(".png")).length, 24);
    });
});

test("capture_frame validates every requested frame before rendering a range", { timeout: 20_000 }, async () => {
    await withServer({ FAKE_INITIAL_CURRENT_FRAME: "2" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "capture_frame", arguments: { range: { start: 4, end: 6 } } });
        assert.equal(result.isError, true);
        assert.equal(text(result), "Frame 6 does not exist (timeline has 5 frames)");
        await assert.rejects(readFile(join(tempDir, "log.capture")), { code: "ENOENT" });
        assert.deepEqual(
            (await stateLog(tempDir)).map(({ currentFrame }) => currentFrame),
            [2],
        );
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
    await withServer({ FAKE_EXPORT_FAIL_FRAME: "3", FAKE_INITIAL_CURRENT_FRAME: "2" }, async (client, tempDir) => {
        const dir = join(tempDir, "partial captures");
        await mkdir(dir);
        await writeFile(join(dir, "preexisting.png"), PNG);
        const result = await client.callTool({
            name: "capture_frame",
            arguments: { range: { start: 1, end: 4 }, dir },
        });
        assert.equal(result.isError, true);
        assert.equal(text(result), "Capture export failed");
        assert.deepEqual(await readdir(dir), ["preexisting.png"]);
        assert.deepEqual(await readFile(join(dir, "preexisting.png")), PNG);
        assert.deepEqual(
            (await stateLog(tempDir)).map(({ currentFrame }) => currentFrame),
            [2],
        );
        assert.deepEqual(
            (await readFile(join(tempDir, "log.capture"), "utf8"))
                .trim()
                .split("\n")
                .map((entry) => JSON.parse(entry).frame),
            [0, 1, 2],
        );
    });
});
