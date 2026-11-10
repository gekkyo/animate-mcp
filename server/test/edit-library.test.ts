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
