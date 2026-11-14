import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

test("edit_library creates folders, moves and renames items, and lists unused items", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: {
                ops: [
                    { op: "createFolder", path: "Actors/Enemies" },
                    { op: "moveItem", item: "Sound", toFolder: "F" },
                    { op: "renameItem", item: "Bitmap", newName: "Texture" },
                    { op: "listUnused" },
                ],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        const content = result.structuredContent as {
            applied: unknown[];
            failed: unknown;
            results: { result?: { items?: { name: string; itemType: string; linkage?: boolean }[] } }[];
            warnings: string[];
        };
        assert.equal(content.applied.length, 4);
        assert.equal(content.failed, null);
        const unused = content.results[3].result?.items ?? [];
        assert.ok(unused.some((item) => item.name === "dir/Hero" && item.itemType === "movie clip" && item.linkage));
        const items = JSON.parse((await readFile(join(tempDir, "log.library"), "utf8")).trim()) as { name: string }[];
        assert.ok(items.some((item) => item.name === "Actors/Enemies"));
        assert.ok(items.some((item) => item.name === "Actors"));
        assert.ok(items.some((item) => item.name === "F/Sound"));
        assert.ok(items.some((item) => item.name === "Texture"));
        assert.deepEqual(content.warnings, []);
    }),
);

test("edit_library refuses collisions and marks later operations skipped", { timeout: 30_000 }, () =>
    withServer({}, async (client) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: {
                ops: [
                    { op: "moveItem", item: "Bitmap", toFolder: "dir" },
                    { op: "createFolder", path: "NotCreated" },
                ],
            },
        });
        const content = result.structuredContent as {
            applied: unknown[];
            failed: { error: string } | null;
            skipped: unknown[];
        };
        assert.equal(content.applied.length, 0);
        assert.match(content.failed?.error ?? "", /already exists/);
        assert.equal(content.skipped.length, 1);
        const rename = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "renameItem", item: "Bitmap", newName: "Sound" }] },
        });
        assert.match((rename.structuredContent as { failed: { error: string } }).failed.error, /already exists/);
        const folder = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "createFolder", path: "F" }] },
        });
        assert.match((folder.structuredContent as { failed: { error: string } }).failed.error, /already exists/);
    }),
);

test("edit_library moves folders with their contents and warns for linked descendants", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "moveItem", item: "dir", toFolder: "F" }] },
        });
        const content = result.structuredContent as { applied: unknown[]; warnings: string[] };
        assert.equal(content.applied.length, 1);
        assert.equal(content.warnings.length, 1);
        const items = JSON.parse((await readFile(join(tempDir, "log.library"), "utf8")).trim()) as { name: string }[];
        assert.ok(items.some((item) => item.name === "F/dir/Hero"));
    }),
);

test("edit_library requires delete confirmation and refuses items in use", { timeout: 30_000 }, async () => {
    await withServer({}, async (client) => {
        const unconfirmed = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "deleteItem", item: "Bitmap" }] },
        });
        assert.equal(unconfirmed.isError, true);
        assert.match(text(unconfirmed), /confirm/);
    });
    await withServer({ FAKE_USED: "dir/Hero" }, async (client) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "deleteItem", item: "dir/Hero", confirm: true }] },
        });
        const content = result.structuredContent as { failed: { error: string } | null };
        assert.match(content.failed?.error ?? "", /in use/);
    });
    await withServer({ FAKE_USED: "dir/Hero" }, async (client) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "deleteItem", item: "dir", confirm: true }] },
        });
        const content = result.structuredContent as { failed: { error: string } | null };
        assert.match(content.failed?.error ?? "", /contains an item in use/);
    });
});

test(
    "edit_library reads and updates AS3 linkage, returns read-back values, and preserves library selection",
    { timeout: 30_000 },
    () =>
        withServer(
            {
                FAKE_SELECTED_LIBRARY_ITEMS: "Sound,Bitmap",
                FAKE_INITIAL_SELECTED_ELEMENT: "1",
                FAKE_INITIAL_SELECTED_FRAMES: "[0,0,1]",
            },
            async (client, tempDir) => {
                const read = async () =>
                    client.callTool({
                        name: "edit_library",
                        arguments: { ops: [{ op: "getLinkage", item: "dir/Hero" }] },
                    });
                const initial = await read();
                assert.equal(initial.isError, undefined, text(initial));
                const initialValues = (initial.structuredContent as { results: { result: unknown }[] }).results[0]
                    .result;
                assert.deepEqual(initialValues, {
                    name: "dir/Hero",
                    exportForAS: true,
                    className: "com.Hero",
                    baseClass: "flash.display.MovieClip",
                    exportInFirstFrame: false,
                });

                const updated = await client.callTool({
                    name: "edit_library",
                    arguments: {
                        ops: [
                            {
                                op: "setLinkage",
                                item: "dir/Hero",
                                exportForAS: true,
                                className: "com.example.CustomClass",
                                baseClass: "",
                                exportInFirstFrame: true,
                            },
                            { op: "setLinkage", item: "dir/Hero", exportForAS: true },
                            { op: "setLinkage", item: "dir/Hero", exportForAS: false },
                            { op: "setLinkage", item: "dir/Hero", exportForAS: false },
                            { op: "setLinkage", item: "dir/Hero", exportForAS: false, exportInFirstFrame: false },
                            { op: "getLinkage", item: "dir/Hero" },
                        ],
                    },
                });
                assert.equal(updated.isError, undefined, text(updated));
                const updatedResults = (updated.structuredContent as { results: { result: unknown }[] }).results;
                assert.deepEqual(updatedResults[0].result, {
                    name: "dir/Hero",
                    exportForAS: true,
                    className: "com.example.CustomClass",
                    baseClass: "",
                    exportInFirstFrame: true,
                });
                assert.deepEqual(updatedResults[1].result, updatedResults[0].result);
                assert.deepEqual(updatedResults[2].result, {
                    name: "dir/Hero",
                    exportForAS: false,
                    className: "",
                    baseClass: "",
                    exportInFirstFrame: false,
                });
                assert.deepEqual(updatedResults[3].result, updatedResults[2].result);
                assert.deepEqual(updatedResults[4].result, updatedResults[2].result);
                assert.deepEqual(updatedResults[5].result, updatedResults[2].result);
                const linkageWrites = JSON.parse((await readFile(join(tempDir, "log.linkage-writes"), "utf8")).trim());
                assert.deepEqual(
                    linkageWrites.filter((write) => write.property === "linkageExportForAS"),
                    [{ item: "dir/Hero", property: "linkageExportForAS", value: false }],
                );
                assert.ok(
                    !linkageWrites.some(
                        (write) => write.property === "linkageExportInFirstFrame" && write.value === false,
                    ),
                );

                const selections = (await readFile(join(tempDir, "log.library-selection"), "utf8"))
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line));
                assert.deepEqual(selections.at(-1), ["Sound", "Bitmap"]);
                const states = (await readFile(join(tempDir, "log.state"), "utf8"))
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line));
                assert.ok(
                    states.every(
                        (state) => state.selectedFrames?.join(",") === "0,0,1" && state.selectedElements === 1,
                    ),
                );
            },
        ),
);

test("edit_library validates linkage operations before writing and rejects unsupported documents", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client, tempDir) => {
        const invalid = await client.callTool({
            name: "edit_library",
            arguments: {
                ops: [
                    { op: "setLinkage", item: "dir/Hero", exportForAS: false, exportInFirstFrame: true },
                    { op: "getLinkage", item: "dir/Hero" },
                ],
            },
        });
        const content = invalid.structuredContent as {
            applied: unknown[];
            failed: { error: string };
            skipped: unknown[];
        };
        assert.equal(content.applied.length, 0);
        assert.match(content.failed.error, /exportForAS|export flag/i);
        assert.equal(content.skipped.length, 1);
        await assert.rejects(readFile(join(tempDir, "log.linkage-writes"), "utf8"), /ENOENT/);

        const missingSetting = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "setLinkage", item: "dir/Hero" }] },
        });
        assert.equal(missingSetting.isError, true);
        const emptyClassName = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "setLinkage", item: "dir/Hero", className: "" }] },
        });
        assert.equal(emptyClassName.isError, true);
    });
    for (const env of [{ FAKE_TYPE: "htmlcanvas" }, { FAKE_AS_VERSION: "AS2" }]) {
        await withServer(env, async (client) => {
            const unsupported = await client.callTool({
                name: "edit_library",
                arguments: { ops: [{ op: "getLinkage", item: "dir/Hero" }] },
            });
            const content = unsupported.structuredContent as { failed: { error: string } };
            assert.match(content.failed.error, /AS3.*Flash|Flash.*AS3/i);
        });
    }
});

test(
    "edit_library warns about linkage references when moving, renaming, or deleting linked items",
    { timeout: 30_000 },
    () =>
        withServer({}, async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_library",
                arguments: {
                    ops: [
                        { op: "moveItem", item: "dir/Hero", toFolder: "F" },
                        { op: "renameItem", item: "F/Hero", newName: "Avatar" },
                        { op: "deleteItem", item: "F/Avatar", confirm: true },
                    ],
                },
            });
            const content = result.structuredContent as { applied: unknown[]; failed: unknown; warnings: string[] };
            assert.equal(content.applied.length, 3);
            assert.equal(content.failed, null);
            assert.equal(content.warnings.length, 3);
            assert.ok(content.warnings.every((warning) => /linkage|code-string/i.test(warning)));
            const items = JSON.parse((await readFile(join(tempDir, "log.library"), "utf8")).trim()) as {
                name: string;
            }[];
            assert.ok(!items.some((item) => item.name === "F/Avatar"));
        }),
);
