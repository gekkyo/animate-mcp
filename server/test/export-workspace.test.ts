import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    collectChanges,
    prepareExport,
    recordApplied,
    writeManifest,
} from "../src/export-workspace/export-workspace.js";

test("Export workspace collects edits and new scripts from its manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-workspace-"));
    await writeManifest(dir, {
        document: "a.fla",
        type: "Flash",
        files: { "scenes/Scene/Layer/1.as": { scene: 0, layer: 0, start: 0, script: "old();" } },
        timelines: [{ dir: "scenes/Scene", scene: 0, layers: [{ index: 0, dir: "Layer", name: "Layer" }] }],
    });
    await mkdir(join(dir, "scenes/Scene/Layer"), { recursive: true });
    await writeFile(join(dir, "scenes/Scene/Layer/1.as"), "edited();");
    await mkdir(join(dir, "scenes/Scene/as"), { recursive: true });
    await writeFile(join(dir, "scenes/Scene/as/2.as"), "new();");

    const changes = await collectChanges(dir);
    assert.equal(changes.document, "a.fla");
    assert.deepEqual(
        changes.edits.map(({ file, script, expected }) => ({ file, script, expected })),
        [{ file: "scenes/Scene/Layer/1.as", script: "edited();", expected: "old();" }],
    );
    assert.deepEqual(
        changes.newScripts.map(({ file, layer, start, script }) => ({ file, layer, start, script })),
        [{ file: "scenes/Scene/as/2.as", layer: -1, start: 1, script: "new();" }],
    );
});

test("prepareExport tolerates a missing manifest and force removes only tracked scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-workspace-"));
    await prepareExport(dir, false);
    await writeManifest(dir, {
        document: "a.fla",
        type: "Flash",
        files: { "tracked.as": { scene: 0, layer: 0, start: 0, script: "original" } },
    });
    await writeFile(join(dir, "tracked.as"), "edited");
    await writeFile(join(dir, "unrelated.txt"), "keep");

    await assert.rejects(prepareExport(dir, false), /Unapplied edits.*tracked\.as/);
    assert.equal(await readFile(join(dir, "tracked.as"), "utf8"), "edited");
    await prepareExport(dir, true);

    await assert.rejects(readFile(join(dir, "tracked.as")), { code: "ENOENT" });
    assert.equal(await readFile(join(dir, "unrelated.txt"), "utf8"), "keep");
});

test("recordApplied updates only successful files and structure metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-workspace-"));
    await writeManifest(dir, {
        document: "a.fla",
        type: "Flash",
        files: { "scenes/Scene/Layer/1.as": { scene: 0, layer: 0, start: 0, script: "old();" } },
        timelines: [
            {
                dir: "scenes/Scene",
                scene: 0,
                structureFingerprint: "old-fingerprint",
                layers: [{ index: 0, dir: "Layer", name: "Layer" }],
            },
        ],
    });

    await recordApplied(dir, {
        edits: [
            {
                scene: 0,
                layer: 0,
                start: 0,
                script: "edited();",
                file: "scenes/Scene/Layer/1.as",
                expected: "old();",
            },
        ],
        newScripts: [
            {
                scene: 0,
                layer: 0,
                start: 1,
                script: "new();",
                file: "scenes/Scene/as/2.as",
                layerDir: "as",
                layerName: "as",
                asLayer: true,
            },
        ],
        fingerprints: [{ scene: 0, structureFingerprint: "new-fingerprint" }],
    });

    const manifest = JSON.parse(await readFile(join(dir, ".export.json"), "utf8"));
    assert.equal(manifest.files["scenes/Scene/Layer/1.as"].script, "edited();");
    assert.deepEqual(manifest.files["scenes/Scene/as/2.as"], {
        scene: 0,
        layer: 0,
        start: 1,
        script: "new();",
    });
    assert.deepEqual(
        manifest.timelines[0].layers.map(({ index, name }) => [index, name]),
        [
            [0, "as"],
            [1, "Layer"],
        ],
    );
    assert.equal(manifest.timelines[0].structureFingerprint, "new-fingerprint");
});
