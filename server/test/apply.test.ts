import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { clearPreviousExport, collectEdits, markApplied } from "../src/apply.js";
import { layersLog, SCENE_FILE, scriptsLog, symbolLayersLog, text, withServer } from "./helpers/fake-animate.js";

test("apply_scripts writes edits, deletes on empty file, skips unchanged", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = join(exportDir, SCENE_FILE);

        const none = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(none.structuredContent, { applied: [], failed: [], unchanged: 2, warnings: [] });

        await writeFile(file, "play();");
        const edited = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(edited.structuredContent, {
            applied: [SCENE_FILE],
            failed: [],
            unchanged: 1,
            warnings: [],
        });
        assert.deepEqual((await scriptsLog(tempDir)).at(-1), [["play();"]].flat(), "script written");
        assert.equal(
            JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8")).files[SCENE_FILE].script,
            "play();",
            "manifest records the applied content",
        );
        const again = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.equal((again.structuredContent as { unchanged: number }).unchanged, 2, "nothing left to apply");
    });
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        await writeFile(join(exportDir, SCENE_FILE), "");
        await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual((await scriptsLog(tempDir)).at(-1), [""], "empty file deletes the script");
    });
});

test("apply manifest lifecycle is idempotent and clears only exported files", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const scriptPath = join(exportDir, SCENE_FILE);
        await writeFile(scriptPath, "play();");

        const pending = await collectEdits(exportDir);
        assert.deepEqual(
            pending.edits.map(({ file }) => file),
            [SCENE_FILE],
        );
        await markApplied(exportDir, pending.edits);

        const collectedAgain = await collectEdits(exportDir);
        assert.deepEqual(collectedAgain.edits, []);
        assert.equal(collectedAgain.unchanged, 2);

        const untrackedPath = join(exportDir, "keep.txt");
        await writeFile(untrackedPath, "keep");
        await clearPreviousExport(exportDir, false);
        await assert.rejects(readFile(scriptPath), { code: "ENOENT" });
        assert.equal(await readFile(untrackedPath, "utf8"), "keep");
        assert.ok((await readdir(exportDir)).includes(".export.json"));
    }),
);

test("apply_scripts counts a frame already holding the new script as applied", { timeout: 30_000 }, () =>
    withServer({ FAKE_SCRIPT: "play();" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.files[SCENE_FILE].script = "old";
        await writeFile(manifestPath, JSON.stringify(manifest));
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual((result.structuredContent as { applied: string[] }).applied, [SCENE_FILE]);
    }),
);

test("apply_scripts creates the as layer at the top and registers a new script", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "scenes/Scene 1/as/4.as";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, file), "trace('new');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; failed: unknown[]; warnings: string[] };
        assert.deepEqual(summary.applied, [file]);
        assert.deepEqual(summary.failed, []);
        assert.ok(summary.warnings.some((warning) => warning.includes('Created layer "as"')));
        assert.ok(summary.warnings.some((warning) => warning.includes("Inserted keyframe at frame 4")));
        const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
        assert.deepEqual(manifest.files[file], { scene: 0, layer: 0, start: 3, script: "trace('new');" });
        assert.deepEqual(
            manifest.timelines[0].layers.map((entry: { index: number; name: string }) => [entry.index, entry.name]),
            [
                [0, "as"],
                [1, "a/b"],
            ],
        );
        const snapshot = (await layersLog(tempDir)).at(-1);
        assert.equal(snapshot[0].name, "as", "new layer is on top");
        assert.equal(snapshot[0].frames.find((frame: { start: number }) => frame.start === 3).script, "trace('new');");

        const again = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(again.structuredContent, { applied: [], failed: [], unchanged: 3, warnings: [] });
    }),
);

test("apply_scripts reuses case-insensitive as layer and restores its lock", { timeout: 30_000 }, () =>
    withServer({ FAKE_AS_LAYER: "AS", FAKE_LOCK_AS: "1" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "scenes/Scene 1/as/1.as";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, file), "trace('reuse');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; warnings: string[] };
        assert.deepEqual(summary.applied, [file]);
        assert.ok(!summary.warnings.some((warning) => warning.includes("Created layer")));
        const snapshot = (await layersLog(tempDir)).at(-1);
        assert.equal(snapshot[0].name, "AS");
        assert.equal(snapshot[0].locked, true, "locked layer is restored");
        assert.equal(snapshot[0].writeWasUnlocked, true, "the script is written while temporarily unlocked");
        assert.equal(snapshot[0].frames[0].script, "trace('reuse');");
    }),
);

test("apply_scripts inserts a keyframe in a non-tween span", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "scenes/Scene 1/a_b/4.as";
        await mkdir(join(exportDir, "scenes/Scene 1/a_b"), { recursive: true });
        await writeFile(join(exportDir, file), "trace('insert');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; failed: unknown[]; warnings: string[] };
        assert.deepEqual(summary.applied, [file]);
        assert.deepEqual(summary.failed, []);
        assert.ok(summary.warnings.some((warning) => warning.includes("Inserted keyframe at frame 4")));
        const targetLayer = (await layersLog(tempDir)).at(-1).find((entry: { name: string }) => entry.name === "a/b");
        assert.ok(
            targetLayer.frames.some(
                (frame: { start: number; script: string }) => frame.start === 3 && frame.script === "trace('insert');",
            ),
        );
    }),
);

test(
    "apply_scripts inserts a keyframe when the target layer ends before the timeline",
    { timeout: 30_000 },
    /** Runs the apply operation against a shorter layer.
     * @returns The asynchronous test result
     */
    () =>
        withServer(
            { FAKE_SECOND_LAYER: "Other", FAKE_SECOND_LENGTH: "2" },
            /** Verifies a missing frame within the timeline receives the script.
             * @param client MCP client connected to the fake Animate server
             * @param tempDir Temporary directory for the test fixture
             * @returns The asynchronous assertion result
             */
            async (client, tempDir) => {
                const exportDir = join(tempDir, "out");
                await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
                const file = "scenes/Scene 1/Other/4.as";
                await mkdir(join(exportDir, "scenes/Scene 1/Other"), { recursive: true });
                await writeFile(join(exportDir, file), "trace('insert absent');");

                const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
                const summary = result.structuredContent as {
                    applied: string[];
                    failed: unknown[];
                    warnings: string[];
                };
                assert.deepEqual(summary.applied, [file]);
                assert.deepEqual(summary.failed, []);
                assert.ok(summary.warnings.join("\n").includes("Inserted keyframe at frame 4"));
                const snapshot = (await layersLog(tempDir)).at(-1);
                const targetLayer = snapshot.find(
                    /** Finds the target layer in the timeline snapshot.
                     * @param entry Layer snapshot to inspect
                     * @returns Whether this is the target layer
                     */
                    (entry: { name: string }) => entry.name === "Other",
                );
                const insertedFrame = targetLayer.frames.at(-1);
                assert.equal(insertedFrame.start, 3, "the missing frame becomes a keyframe");
                assert.equal(
                    insertedFrame.script,
                    "trace('insert absent');",
                    "a missing frame on a shorter layer receives the script",
                );
            },
        ),
);

test("apply_scripts rejects new scripts inside tweens and beyond timeline length", { timeout: 30_000 }, () =>
    withServer({ FAKE_TWEEN: "motion" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        for (const frame of [2, 4, 6]) {
            await writeFile(join(exportDir, `scenes/Scene 1/a_b/${frame}.as`), `trace(${frame});`);
        }
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as {
            applied: string[];
            failed: { file: string; error: string }[];
        };
        assert.deepEqual(summary.applied, ["scenes/Scene 1/a_b/2.as"], "one failure does not block other new scripts");
        const failed = summary.failed;
        assert.match(failed.find((entry) => entry.file.endsWith("/4.as"))?.error ?? "", /Frame is inside a tween/);
        assert.match(failed.find((entry) => entry.file.endsWith("/6.as"))?.error ?? "", /Frame beyond timeline length/);
    }),
);

test("apply_scripts rejects structural changes made in Animate after Export", { timeout: 30_000 }, () =>
    withServer({ FAKE_CONFLICT_NEW: "1" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "scenes/Scene 1/a_b/4.as";
        await writeFile(join(exportDir, file), "mine");
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; failed: { error: string }[] };
        assert.deepEqual(summary.applied, []);
        assert.match(summary.failed[0]?.error ?? "", /Structure changed since Export/);
    }),
);

test("apply_scripts rejects a stale fingerprint and keeps backward compatibility", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.timelines[0].structureFingerprint = "stale";
        await writeFile(manifestPath, JSON.stringify(manifest));
        await writeFile(join(exportDir, SCENE_FILE), "mine");
        const refused = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const failures = (refused.structuredContent as { failed: { error: string }[] }).failed;
        assert.match(failures[0]?.error ?? "", /Structure changed since Export/);
    });
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        delete manifest.timelines[0].structureFingerprint;
        await writeFile(manifestPath, JSON.stringify(manifest));
        await writeFile(join(exportDir, SCENE_FILE), "legacy edit");
        const accepted = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual((accepted.structuredContent as { applied: string[] }).applied, [SCENE_FILE]);
    });
});

test("apply_scripts accepts hand-placed files in known layers and warns for unknown layers", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const knownFile = "scenes/Scene 1/Other/2.as";
        const unknownFile = "scenes/Scene 1/Ghost/2.as";
        await mkdir(join(exportDir, "scenes/Scene 1/Other"), { recursive: true });
        await mkdir(join(exportDir, "scenes/Scene 1/Ghost"), { recursive: true });
        await writeFile(join(exportDir, knownFile), "trace('other');");
        await writeFile(join(exportDir, unknownFile), "trace('ghost');");
        await writeFile(join(exportDir, "scenes/Scene 1/Ghost/structure.md"), "ignored");
        await writeFile(join(exportDir, "scenes/Scene 1/Ghost/not-a-frame.as"), "ignored");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; warnings: string[] };
        assert.deepEqual(summary.applied, [knownFile]);
        assert.deepEqual(summary.warnings, [
            `ignored: ${unknownFile}`,
            "Inserted keyframe at frame 2 in Other of Scene 1",
        ]);
    }),
);

test("apply_scripts accepts .js new scripts for HTML5 Canvas", { timeout: 30_000 }, () =>
    withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "scenes/Scene 1/as/1.js";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, file), "trace('canvas');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual((result.structuredContent as { applied: string[] }).applied, [file]);
    }),
);

test("apply_scripts preserves layer indices after creating as and remains idempotent", { timeout: 30_000 }, () =>
    withServer({ FAKE_PERSIST_AS: "1" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const newFile = "scenes/Scene 1/as/4.as";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, newFile), "new();");
        await writeFile(join(exportDir, SCENE_FILE), "play();");
        await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });

        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        assert.equal(manifest.files[SCENE_FILE].layer, 1);
        assert.equal(manifest.files[newFile].layer, 0);
        assert.equal(manifest.timelines[0].layers.find((entry: { name: string }) => entry.name === "a/b").index, 1);
        assert.match(manifest.timelines[0].structureFingerprint, /^fnv1a32:/);

        await writeFile(join(exportDir, SCENE_FILE), "play-again();");
        const afterStructureUpdate = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(
            (afterStructureUpdate.structuredContent as { applied: string[] }).applied,
            [SCENE_FILE],
            text(afterStructureUpdate),
        );
        assert.deepEqual(
            (afterStructureUpdate.structuredContent as { failed: unknown[] }).failed,
            [],
            text(afterStructureUpdate),
        );

        const again = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(again.structuredContent, { applied: [], failed: [], unchanged: 3, warnings: [] });
    }),
);

test("apply_scripts writes new scripts in library symbol timelines", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = "library/dir/Hero/as/1.as";
        await mkdir(join(exportDir, "library/dir/Hero/as"), { recursive: true });
        await writeFile(join(exportDir, file), "trace('symbol');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const summary = result.structuredContent as { applied: string[]; failed: unknown[] };
        assert.deepEqual(summary.applied, [file]);
        assert.deepEqual(summary.failed, []);
        const symbolLayers = (await symbolLayersLog(tempDir)).at(-1)["dir/Hero"];
        assert.equal(symbolLayers[0].name, "as");
        assert.equal(symbolLayers[0].script, "trace('symbol');");
        const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
        assert.deepEqual(manifest.files[file], {
            scene: 0,
            layer: 0,
            start: 0,
            script: "trace('symbol');",
            item: "dir/Hero",
        });
    }),
);

test("apply_scripts applies existing edits before new scripts across timelines", { timeout: 30_000 }, () =>
    withServer({ FAKE_SCRIPT: "changed" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.files[SCENE_FILE].script = "old";
        await writeFile(manifestPath, JSON.stringify(manifest));
        await writeFile(join(exportDir, SCENE_FILE), "mine");
        await writeFile(join(exportDir, "library/dir/Hero/L/1.as"), "play();");
        const newFile = "scenes/Scene 1/as/1.as";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, newFile), "trace('new');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.equal(result.isError, undefined, text(result));
        const summary = result.structuredContent as { applied: string[]; failed: { file: string }[] };
        assert.deepEqual(summary.applied, ["library/dir/Hero/L/1.as", newFile]);
        assert.deepEqual(
            summary.failed.map(({ file }) => file),
            [SCENE_FILE],
        );
        assert.deepEqual((await readFile(join(tempDir, "log.order"), "utf8")).trim().split("\n"), [
            "edits",
            "edits",
            "new",
        ]);
        const appliedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
        assert.equal(appliedManifest.files[SCENE_FILE].script, "old", "failed edit stays pending");
        assert.equal(appliedManifest.files["library/dir/Hero/L/1.as"].script, "play();");
        assert.equal(appliedManifest.files[newFile].script, "trace('new');");
    }),
);

test("apply_scripts ignores untracked files when the legacy manifest has no timelines", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        delete manifest.timelines;
        await writeFile(manifestPath, JSON.stringify(manifest));
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, "scenes/Scene 1/as/1.as"), "ignored");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.deepEqual(result.structuredContent, { applied: [], failed: [], unchanged: 2, warnings: [] });
    }),
);

test("apply_scripts rejects manifest paths outside the export directory", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.files["../secret.txt"] = { scene: 0, layer: 0, start: 0, script: "x" };
        await writeFile(manifestPath, JSON.stringify(manifest));
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const failed = (result.structuredContent as { failed: { file: string; error: string }[] }).failed;
        assert.equal(failed[0]?.file, "../secret.txt");
        assert.match(failed[0]?.error ?? "", /outside the export directory/);
    }),
);

test("apply_scripts does not overwrite frames changed in Animate; rejects another document", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const other = await client.callTool({
            name: "apply_scripts",
            arguments: { dir: exportDir, document: "b.fla" },
        });
        assert.equal(other.isError, true);
        assert.match(text(other), /a\.fla/);
    });
    await withServer({ FAKE_SCRIPT: "changed" }, async (client, tempDir) => {
        // Prepare the exported content by hand (differs by FAKE_SCRIPT)
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const file = join(exportDir, "scenes/Scene 1/a_b/1.as");
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.files["scenes/Scene 1/a_b/1.as"].script = "old";
        await writeFile(manifestPath, JSON.stringify(manifest));
        await writeFile(file, "mine");
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const applySummary = result.structuredContent as { applied: string[]; failed: { error: string }[] };
        assert.deepEqual(applySummary.applied, []);
        assert.match(applySummary.failed[0]?.error ?? "", /Changed in Animate/);
        assert.deepEqual((await scriptsLog(tempDir)).at(-1), ["changed"], "not overwritten");
    });
});

test("apply_scripts applies library symbols, detects conflicts, continues past failures", {
    timeout: 60_000,
}, async () => {
    await withServer({ FAKE_EXTRA: "11" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        await writeFile(join(exportDir, "library/dir/Hero/L/1.as"), "play();");
        await writeFile(join(exportDir, "scenes/Scene 1/a_b/1.as"), "");
        const seen: number[] = [];
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } }, undefined, {
            onprogress: (progress) => seen.push(progress.progress),
        });
        assert.equal(result.isError, undefined, text(result));
        const applySummary = result.structuredContent as { applied: string[]; failed: unknown[]; warnings: string[] };
        assert.deepEqual(applySummary.applied.sort(), ["library/dir/Hero/L/1.as", "scenes/Scene 1/a_b/1.as"]);
        assert.deepEqual(applySummary.failed, []);
        assert.deepEqual(applySummary.warnings, []);
        // The SDK client drops a progress notification that arrives in the same read as the final response
        // (notification handlers run a microtask later, response handlers run at once), so the last one may be lost.
        assert.equal(seen[0], 1);
        assert.deepEqual(seen, [1, 2].slice(0, seen.length));
        const lastSymbol = (await readFile(join(tempDir, "log.sym"), "utf8")).trim().split("\n").at(-1);
        assert.equal(JSON.parse(lastSymbol ?? "{}")["dir/Hero"], "play();");
    });
    await withServer({ FAKE_SYM_SCRIPT: "changed" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        const manifestPath = join(exportDir, ".export.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.files["library/dir/Hero/L/1.as"].script = "old";
        await writeFile(manifestPath, JSON.stringify(manifest));
        await writeFile(join(exportDir, "library/dir/Hero/L/1.as"), "mine");
        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        const applySummary = result.structuredContent as { applied: string[]; failed: { error: string }[] };
        assert.deepEqual(applySummary.applied, []);
        assert.match(applySummary.failed[0]?.error ?? "", /Changed in Animate/);
    });
});
