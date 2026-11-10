import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { writeExport } from "../src/export.js";
import { SCENE_FILE, text, withServer } from "./helpers/fake-animate.js";

test("layer names differing only in case get separate folders", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "export-"));
    /**
     * Creates a one-frame script-bearing layer frame.
     * @param script Script text for the frame
     * @returns A single-frame timeline
     */
    const frame = (script: string) => [{ start: 0, duration: 1, label: "", tween: "none", script, elements: [] }];
    await writeExport(
        {
            document: "a.fla",
            type: "Flash",
            scenes: [
                {
                    name: "s",
                    layers: [
                        { index: 0, name: "Layer", frames: frame("one();") },
                        { index: 1, name: "layer", frames: frame("two();") },
                    ],
                },
            ],
        },
        tempDir,
    );
    const files = Object.keys(JSON.parse(await readFile(join(tempDir, ".export.json"), "utf8")).files);
    assert.equal(new Set(files.map((file) => file.toLowerCase())).size, 2);
    assert.equal(await readFile(join(tempDir, "scenes/s/Layer/1.as"), "utf8"), "one();");
});

test("export_scripts writes scripts, structure.md and manifest; Canvas uses .js", { timeout: 20_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        const result = await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        assert.equal(result.isError, undefined, text(result));
        assert.equal(await readFile(join(exportDir, "scenes/Scene 1/a_b/1.as"), "utf8"), "stop();\n// 日本語");
        const structureMd = await readFile(join(exportDir, "scenes/Scene 1/structure.md"), "utf8");
        assert.match(structureMd, /\| hero \| a\/b: 1-2 \|/);
        assert.match(structureMd, /\| Hero \| a\/b: 3-5 \|/, "unnamed instance is listed by library item name");
        assert.match(structureMd, /\| end \|/);
        assert.match(await readFile(join(exportDir, "index.md"), "utf8"), /Scene 1/);
        const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
        assert.ok(manifest.files["scenes/Scene 1/a_b/1.as"]);
        assert.match(manifest.timelines[0].structureFingerprint, /^fnv1a32:/);
        assert.match(manifest.libraryFingerprint, /^fnv1a32:/);
    });
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        assert.match(await readFile(join(exportDir, "scenes/Scene 1/a_b/1.js"), "utf8"), /^stop\(\)/);
    });
});

test("export_scripts exports library symbols in chunks, continues past failures, reports Linked class", {
    timeout: 60_000,
}, async () => {
    await withServer({ FAKE_EXTRA: "11" }, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        const result = await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        assert.equal(result.isError, undefined, text(result));
        assert.equal(await readFile(join(exportDir, "library/dir/Hero/L/1.as"), "utf8"), "// dir/Hero");
        const exportSummary = result.structuredContent as {
            failed: { name: string; error: string }[];
            linkedClasses: unknown[];
            warnings: string[];
        };
        assert.deepEqual(exportSummary.failed, [{ name: "Broken", error: "cannot edit" }]);
        assert.deepEqual(exportSummary.linkedClasses, [
            { symbol: "dir/Hero", className: "com.Hero", path: "com/Hero.as" },
        ]);
        assert.deepEqual(exportSummary.warnings, []);
        assert.equal(
            (await readFile(join(tempDir, "log"), "utf8")).match(/start/g)?.length,
            4,
            "scenes + list + 2 chunks",
        );
    });
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "export_scripts", arguments: { dir: join(tempDir, "out") } });
        assert.deepEqual((result.structuredContent as { linkedClasses: unknown[] }).linkedClasses, []);
    });
});

test("export_scripts sends progress only when the client asks", { timeout: 60_000 }, () =>
    withServer({ FAKE_EXTRA: "11" }, async (client, tempDir) => {
        const seen: number[] = [];
        await client.callTool({ name: "export_scripts", arguments: { dir: join(tempDir, "a") } }, undefined, {
            onprogress: (progress) => seen.push(progress.progress),
        });
        assert.deepEqual(seen, [10, 13]);
    }),
);

test("export_scripts errors: multiple documents list names; no document", { timeout: 20_000 }, async () => {
    await withServer({ FAKE_TWO: "1" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "export_scripts", arguments: { dir: join(tempDir, "out") } });
        assert.equal(result.isError, true);
        assert.match(text(result), /a\.fla, b\.fla/);
        const ok = await client.callTool({
            name: "export_scripts",
            arguments: { document: "b.fla", dir: join(tempDir, "out") },
        });
        assert.equal(ok.isError, undefined, text(ok));
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "export_scripts", arguments: { dir: join(tempDir, "out") } });
        assert.equal(text(result), "No document open");
    });
});

test("export_scripts refuses to re-export over an unapplied new script", { timeout: 30_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, "scenes/Scene 1/as/4.as"), "trace('new');");

        const result = await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        assert.equal(result.isError, true);
        assert.match(text(result), /Unapplied edits.*as\/4\.as/);
    }),
);

test(
    "export_scripts refuses to overwrite unapplied edits, force overwrites, stale files are removed",
    {
        timeout: 30_000,
    },
    () =>
        withServer({}, async (client, tempDir) => {
            const exportDir = join(tempDir, "out");
            const file = join(exportDir, SCENE_FILE);
            await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
            await writeFile(file, "mine");
            const refused = await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
            assert.equal(refused.isError, true);
            assert.match(text(refused), /Unapplied edits.*force: true/);
            assert.equal(await readFile(file, "utf8"), "mine", "edit is kept");

            const manifestPath = join(exportDir, ".export.json");
            const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
            const stale = "scenes/Scene 1/old/9.as";
            manifest.files[stale] = { scene: 0, layer: 0, start: 8, script: "gone" };
            await writeFile(join(exportDir, "stale-marker"), "");
            await writeFile(manifestPath, JSON.stringify(manifest));
            await mkdir(join(exportDir, "scenes/Scene 1/old"), { recursive: true });
            await writeFile(join(exportDir, stale), "gone");
            const forced = await client.callTool({
                name: "export_scripts",
                arguments: { dir: exportDir, force: true },
            });
            assert.equal(forced.isError, undefined, text(forced));
            assert.equal(await readFile(file, "utf8"), "stop();\n// 日本語", "force overwrites");
            await assert.rejects(readFile(join(exportDir, stale), "utf8"), { code: "ENOENT" });
            assert.equal(await readFile(join(exportDir, "stale-marker"), "utf8"), "", "unrelated files are kept");
        }),
);

test("relative dir is resolved to an absolute path", { timeout: 20_000 }, () =>
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        const result = await client.callTool({
            name: "export_scripts",
            arguments: { dir: relative(resolve("."), exportDir) },
        });
        assert.equal((result.structuredContent as { dir: string }).dir, exportDir);
    }),
);
