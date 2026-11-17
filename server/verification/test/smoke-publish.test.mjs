import assert from "node:assert/strict";
import { test } from "node:test";
import { runPublishSmoke } from "../smoke/scenarios/smoke-publish.mjs";

/** Supplies fake disposable Publish dependencies while recording each operation.
 * @param events Ordered fake operations.
 * @param overrides Optional operation replacements.
 * @returns Injectable Publish dependencies.
 */
function fakeDeps(events, overrides = {}) {
    return {
        publish: async ({ document }) => {
            events.push(`publish:${document}`);
            return { structuredContent: { ok: true, compilerOutput: "verified", errors: [] } };
        },
        runJsfl: async () => {},
        makeDirectory: async () => "/tmp/owned-publish",
        createDocument: async (_runJsfl, uri) => {
            events.push(`create:${uri}`);
            return { name: "owned-publish.fla", pathURI: "file:///Macintosh%20HD/tmp/owned-publish/owned-publish.fla" };
        },
        listFiles: async () => ["owned-publish.fla", "owned-publish.swf"],
        fileStat: async () => ({ isFile: () => true, size: 1024 }),
        closeDocument: async (_runJsfl, uri) => {
            events.push(`close:${uri}`);
        },
        removeDirectory: async () => {
            events.push("remove");
        },
        ...overrides,
    };
}

test("no-argument Publish uses only an owned saved AS3 fixture and confirms its SWF", async () => {
    const events = [];
    await runPublishSmoke([], fakeDeps(events));
    assert.deepEqual(events, [
        "create:file:///tmp/owned-publish/owned-publish.fla",
        "publish:owned-publish.fla",
        "close:file:///Macintosh%20HD/tmp/owned-publish/owned-publish.fla",
        "remove",
    ]);
});

test("Publish tool failure, compiler failure, or missing/empty SWF never reports success", async () => {
    for (const overrides of [
        { publish: async () => ({ isError: true, content: [{ text: "tool error" }] }) },
        { publish: async () => ({ structuredContent: { ok: false, compilerOutput: "verified", errors: [] } }) },
        { publish: async () => ({ structuredContent: { ok: true, compilerOutput: "verified", errors: [{}] } }) },
        { listFiles: async () => ["owned-publish.fla"] },
        { fileStat: async () => ({ isFile: () => true, size: 0 }) },
    ]) {
        const events = [];
        const dependencies = fakeDeps(events, overrides);
        await assert.rejects(runPublishSmoke([], dependencies));
        assert.equal(events[0], "create:file:///tmp/owned-publish/owned-publish.fla");
        assert.equal(events.at(-1), "close:file:///Macintosh%20HD/tmp/owned-publish/owned-publish.fla");
        assert.ok(!events.includes("remove"), "retain failed fixture evidence");
    }
});

test("owned AS3 Publish accepts unavailable compiler output only with a confirmed SWF", async () => {
    const events = [];
    await runPublishSmoke(
        [],
        fakeDeps(events, {
            publish: async () => ({ structuredContent: { ok: true, compilerOutput: "unavailable", errors: [] } }),
        }),
    );
    assert.deepEqual(events, [
        "create:file:///tmp/owned-publish/owned-publish.fla",
        "close:file:///Macintosh%20HD/tmp/owned-publish/owned-publish.fla",
        "remove",
    ]);
    await assert.rejects(
        runPublishSmoke(
            [],
            fakeDeps([], {
                publish: async () => ({ structuredContent: { ok: true, compilerOutput: "unavailable", errors: [] } }),
                listFiles: async () => ["owned-publish.fla"],
            }),
        ),
        /no expected SWF/,
    );
});

test("Publish cleanup failure preserves the owned directory and fails", async () => {
    const events = [];
    await assert.rejects(
        runPublishSmoke(
            [],
            fakeDeps(events, {
                closeDocument: async () => {
                    events.push("close-failed");
                    throw new Error("close refused");
                },
            }),
        ),
        /close refused/,
    );
    assert.equal(events.at(-1), "close-failed");
    assert.ok(!events.includes("remove"));
});

test("a rejected disposable Publish fixture fails before calling Publish", async () => {
    const events = [];
    await assert.rejects(
        runPublishSmoke(
            [],
            fakeDeps(events, {
                createDocument: async () => {
                    throw new Error("fixture refused");
                },
            }),
        ),
        /fixture refused/,
    );
    assert.deepEqual(events, []);
});

test("explicit document Publish retains manual targeting and fails on tool errors without creating a fixture", async () => {
    const events = [];
    const dependencies = fakeDeps(events);
    await runPublishSmoke(["User.fla"], dependencies);
    assert.deepEqual(events, ["publish:User.fla"]);
    await runPublishSmoke(
        ["Canvas.fla"],
        fakeDeps(events, {
            publish: async ({ document }) => {
                events.push(`publish:${document}`);
                return { structuredContent: { ok: true, compilerOutput: "not_checked", errors: [] } };
            },
        }),
    );
    assert.deepEqual(events, ["publish:User.fla", "publish:Canvas.fla"]);
    await assert.rejects(
        runPublishSmoke(
            ["User.fla"],
            fakeDeps(events, { publish: async () => ({ isError: true, content: [{ text: "tool error" }] }) }),
        ),
        /tool error/,
    );
    assert.deepEqual(events, ["publish:User.fla", "publish:Canvas.fla"]);
});
