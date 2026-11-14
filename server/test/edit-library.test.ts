import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEditLibrary } from "../src/tools/edit-library.js";
import { text, withServer } from "./helpers/fake-animate.js";

const libraryJsflParts = {
    "select-document": readFileSync(new URL("../jsfl/shared/select-document.jsfl", import.meta.url), "utf8"),
    "edit-state": readFileSync(new URL("../jsfl/shared/edit-state.jsfl", import.meta.url), "utf8"),
    "export-common": readFileSync(new URL("../jsfl/shared/export-common.jsfl", import.meta.url), "utf8"),
    "library-helpers": readFileSync(new URL("../jsfl/library/helpers.jsfl", import.meta.url), "utf8"),
    "library-ops": readFileSync(new URL("../jsfl/library/ops.jsfl", import.meta.url), "utf8"),
    "library-index": readFileSync(new URL("../jsfl/library/index.jsfl", import.meta.url), "utf8"),
};

function libraryToolFor(document: Record<string, unknown>) {
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    registerEditLibrary(
        {
            registerTool(_name, _options, callback) {
                handler = callback as (input: unknown) => Promise<unknown>;
            },
        } as unknown as McpServer,
        {
            runner: {
                execute: async (code) => runInNewContext(code, { fl: { documents: [document] } }),
            },
            bundle: (...names) =>
                names.map((name) => libraryJsflParts[name as keyof typeof libraryJsflParts]).join("\n"),
        },
    );
    assert.ok(handler);
    return handler;
}

function makeLibraryDocument(items: { name: string; itemType: string }[], frame: Record<string, unknown>) {
    const selectedItems: { name: string; itemType: string }[] = [];
    const layer = { name: "Audio", layerType: "normal", frames: [{ startFrame: 0, elements: [], ...frame }] };
    const timeline = {
        name: "Scene 1",
        currentLayer: 0,
        currentFrame: 0,
        layers: [layer],
        getSelectedFrames: () => [],
    };
    const document = {
        name: "test.fla",
        type: "Flash",
        currentTimeline: 0,
        timelines: [timeline],
        getTimeline: () => timeline,
        exitEditMode() {},
        editScene() {},
        selectNone() {},
        library: {
            items,
            getSelectedItems: () => selectedItems.slice(),
            selectNone: () => (selectedItems.length = 0),
            selectItem(name: string, replaceCurrentSelection = true) {
                const selected = items.find((item) => item.name === name);
                if (!selected) {
                    throw new Error("Library item not found");
                }
                if (replaceCurrentSelection) {
                    selectedItems.length = 0;
                }
                if (!selectedItems.includes(selected)) {
                    selectedItems.push(selected);
                }
            },
            itemExists: (name: string) => items.some((item) => item.name === name),
            duplicateItem(name: string) {
                const source = items.find((item) => item.name === name);
                if (!source) {
                    return false;
                }
                items.push({ name: `${name} コピー`, itemType: source.itemType });
                return true;
            },
            renameItemCalls: [] as [string, string][],
            renameItem(newName: string, oldName: string) {
                this.renameItemCalls.push([newName, oldName]);
                const item = items.find((candidate) => candidate.name === oldName);
                if (!item) {
                    throw new Error("Library item not found");
                }
                const parent = oldName.slice(0, oldName.lastIndexOf("/") + 1);
                item.name = parent + newName;
            },
        },
    };
    return document;
}

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

test("edit_library finds direct placements in scene keyframes and restores state", { timeout: 30_000 }, () =>
    withServer(
        {
            FAKE_DISTRIBUTE: "1",
            FAKE_NO_BROKEN: "1",
            FAKE_SYM_INSTANCE: "1",
            FAKE_INITIAL_CURRENT_FRAME: "2",
            FAKE_INITIAL_SELECTED_FRAMES: "[0,1,2]",
            FAKE_INITIAL_SELECTED_ELEMENT: "1",
            FAKE_SELECTED_LIBRARY_ITEMS: "Sound,Bitmap",
        },
        async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_library",
                arguments: { ops: [{ op: "findUsages", item: "dir/Hero" }] },
            });
            assert.equal(result.isError, undefined, text(result));
            const content = result.structuredContent as {
                failed: { error: string } | null;
                results: {
                    result: { usages: { timeline: string | number; layer: string; frame: number; element: number }[] };
                }[];
            };
            assert.equal(content.failed, null);
            assert.deepEqual(content.results[0].result.usages, [
                { timeline: 0, layer: "a/b", frame: 1, element: 0 },
                { timeline: 0, layer: "a/b", frame: 1, element: 1 },
                { timeline: 0, layer: "a/b", frame: 1, element: 2 },
            ]);
            const states = (await readFile(join(tempDir, "log.state"), "utf8"))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            assert.ok(
                states.every(
                    (state) =>
                        state.currentFrame === 2 &&
                        state.selectedFrames?.join(",") === "0,1,2" &&
                        state.selectedElements === 1,
                ),
            );
            const selections = (await readFile(join(tempDir, "log.library-selection"), "utf8"))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            assert.deepEqual(selections.at(-1), ["Sound", "Bitmap"]);
        },
    ),
);

test("edit_library findUsages returns empty for unused items and refuses unknown items", { timeout: 30_000 }, () =>
    withServer({ FAKE_NO_BROKEN: "1" }, async (client) => {
        const unused = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "findUsages", item: "Bitmap" }] },
        });
        assert.equal(unused.isError, undefined, text(unused));
        assert.deepEqual((unused.structuredContent as { results: { result: unknown }[] }).results[0].result, {
            item: "Bitmap",
            usages: [],
        });
        const unknown = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "findUsages", item: "Missing" }] },
        });
        assert.match((unknown.structuredContent as { failed: { error: string } }).failed.error, /not found/i);
    }),
);

test("edit_library finds uses inside nested symbol timelines", { timeout: 30_000 }, () =>
    withServer({ FAKE_SYM_INSTANCE: "1", FAKE_NO_BROKEN: "1" }, async (client) => {
        const result = await client.callTool({
            name: "edit_library",
            arguments: {
                ops: [
                    { op: "moveItem", item: "dir/Hero", toFolder: "" },
                    { op: "findUsages", item: "Hero" },
                ],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        const usages = (
            result.structuredContent as {
                results: {
                    result: { usages: { timeline: string | number; layer: string; frame: number; element: number }[] };
                }[];
            }
        ).results[1].result.usages;
        assert.ok(
            usages.some(
                (usage) =>
                    usage.timeline === "Broken" && usage.layer === "L" && usage.frame === 1 && usage.element === 0,
            ),
        );
    }),
);

test("edit_library reports direct sound usages without an element index", async () => {
    const sound = { name: "Theme", itemType: "sound" };
    const handler = libraryToolFor(makeLibraryDocument([sound], { soundLibraryItem: sound }));
    const result = (await handler({ ops: [{ op: "findUsages", item: "Theme" }] })) as {
        structuredContent: { results: { result: { usages: unknown[] } }[] };
    };
    assert.deepEqual(result.structuredContent.results[0].result.usages, [
        { timeline: 0, layer: "Audio", frame: 1, element: null },
    ]);
});

test("edit_library duplicates with explicit rename arguments and restores Library selection", async () => {
    const item = { name: "dir/Hero", itemType: "movie clip" };
    const document = makeLibraryDocument([{ name: "dir", itemType: "folder" }, item], {});
    document.library.selectItem(item.name);
    const handler = libraryToolFor(document);
    const result = (await handler({ ops: [{ op: "duplicateItem", item: item.name, newName: "Copy" }] })) as {
        structuredContent: { results: { result: { name: string; itemType: string } }[] };
    };
    assert.deepEqual(result.structuredContent.results[0].result, { name: "dir/Copy", itemType: "movie clip" });
    assert.deepEqual(document.library.renameItemCalls, [["Copy", "dir/Hero コピー"]]);
    assert.deepEqual(
        document.library.getSelectedItems().map((selected) => selected.name),
        [item.name],
    );
});

test("edit_library reports the generated duplicate name when rename fails", async () => {
    const item = { name: "dir/Hero", itemType: "movie clip" };
    const document = makeLibraryDocument([{ name: "dir", itemType: "folder" }, item], {});
    document.library.renameItem = () => {
        throw new Error("fake rename failure");
    };
    const handler = libraryToolFor(document);
    const result = (await handler({ ops: [{ op: "duplicateItem", item: "dir/Hero", newName: "Copy" }] })) as {
        structuredContent: { failed: { error: string } };
    };
    assert.match(result.structuredContent.failed.error, /dir\/Hero コピー/);
});

test("edit_library validates symbol creation and duplication and refuses existing names before writing", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client, tempDir) => {
        for (const op of [
            { op: "createSymbol", type: "graphic", name: "Bitmap" },
            { op: "duplicateItem", item: "dir/Hero", newName: "Bitmap" },
        ]) {
            const result = await client.callTool({ name: "edit_library", arguments: { ops: [op] } });
            assert.equal(result.isError, undefined, text(result));
            assert.match((result.structuredContent as { failed: { error: string } }).failed.error, /already exists/i);
        }
        const items = (await readFile(join(tempDir, "log.library"), "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .at(-1) as { name: string }[];
        assert.deepEqual(
            items.map((item) => item.name),
            ["F", "dir", "dir/Hero", "dir/Bitmap", "Bitmap", "Sound", "Font", "Broken"],
        );
    });
    await withServer({}, async (client) => {
        for (const op of [
            { op: "createSymbol", type: "unsupported", name: "NewSymbol" },
            { op: "createSymbol", type: "graphic", name: "Folder/NewSymbol" },
            { op: "duplicateItem", item: "dir/Hero", newName: "Folder/NewName" },
        ]) {
            const result = await client.callTool({ name: "edit_library", arguments: { ops: [op] } });
            assert.equal(result.isError, true, text(result));
        }
        const folderCopy = await client.callTool({
            name: "edit_library",
            arguments: { ops: [{ op: "duplicateItem", item: "dir", newName: "FolderCopy" }] },
        });
        assert.equal(folderCopy.isError, undefined, text(folderCopy));
        assert.match((folderCopy.structuredContent as { failed: { error: string } }).failed.error, /folder/i);
        for (const op of [
            { op: "createSymbol", type: "graphic" },
            { op: "duplicateItem", item: "dir/Hero" },
        ]) {
            const result = await client.callTool({ name: "edit_library", arguments: { ops: [op] } });
            assert.equal(result.isError, true, text(result));
        }
    });
});

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
