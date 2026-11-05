import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Fake Animate: runs the Run file with minimal FLfile/fl stubs.
// Does not respond to code containing HANG, and logs launch start/end to FAKE_LOG.
const fakeAnimate = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
const log = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, message + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
const lib = { name: "Hero", itemType: "movie clip" };
const makeKeyframe = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [] }, extra);
// Like real Animate, layer.frames has one element per frame (the keyframe's frame repeated duration times)
const expand = (keyframes) => keyframes.flatMap((keyframe) => Array(keyframe.duration).fill(keyframe));
const symTimeline = (symbolName, script) => ({ name: symbolName, libraryItem: { name: symbolName }, layers: [{ name: "L", layerType: "normal", frames: expand([makeKeyframe(0, 1, { actionScript: script })]) }] });
const doc = (documentName, documentType) => { const document = { name: documentName, type: documentType, width: 550, height: 400, frameRate: 24, currentTimeline: 0, timelines: [{ name: "Scene 1", layers: [
  { name: "a/b", layerType: "normal", frames: expand([
    makeKeyframe(0, 2, { actionScript: process.env.FAKE_SCRIPT ?? "stop();\\n// 日本語", elements: [{ name: "hero", elementType: "instance", libraryItem: lib }] }),
    makeKeyframe(2, 3, { name: "end", elements: [{ name: "", elementType: "instance", libraryItem: lib }] })]) },
  { name: "dir", layerType: "folder", frames: [] }] }] };
  let editing = null;
  document.syms = {};
  document.getTimeline = () => editing ? (document.syms[editing] ||= symTimeline(editing, process.env.FAKE_SYM_SCRIPT ?? "// " + editing)) : document.timelines[0];
  document.exitEditMode = () => { editing = null; };
  document.editScene = () => {};
  document.library = { items: [
    { name: "F", itemType: "folder" },
    { name: "dir/Hero", itemType: "movie clip", linkageExportForAS: true, linkageClassName: "com.Hero" },
    ...Array.from({ length: Number(process.env.FAKE_EXTRA ?? 0) }, (_, index) => ({ name: "S" + index, itemType: "graphic" })),
    { name: "Broken", itemType: "button" }],
    editItem: (itemName) => { if (itemName === "Broken" && !process.env.FAKE_NO_BROKEN) throw new Error("cannot edit"); editing = itemName; } };
  return document; };
const docs = process.env.FAKE_NO_DOC ? [] : [doc("a.fla", process.env.FAKE_TYPE || "Flash")].concat(process.env.FAKE_TWO ? [doc("b.fla", "Flash")] : []);
if (!src.includes("HANG")) runInNewContext(src, {
  FLfile: { platformPathToURI: (path) => path, write: (path, content) => writeFileSync(path, content) },
  fl: { trace() {}, documents: docs, getDocumentDOM: () => docs[0] || null },
});
process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".scripts", JSON.stringify(docs.map((document) => document.timelines[0].layers[0].frames[0].actionScript)) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".sym", JSON.stringify(Object.fromEntries(Object.entries(docs[0].syms).map(([symbolName, timeline]) => [symbolName, timeline.layers[0].frames[0].actionScript]))) + "\\n");
log("end");
`;

/**
 * Starts the Server over stdio with env, passes an MCP client to fn, and closes it afterwards.
 * @param env Extra environment variables for the Server
 * @param fn Test body; receives the MCP client, a temp directory and the Runs directory
 * @returns Promise<void> that resolves when fn completes
 */
async function withServer(
    env: Record<string, string>,
    fn: (client: Client, tempDir: string, runsDir: string) => Promise<void>,
) {
    const tempDir = await mkdtemp(join(tmpdir(), "animate-mcp-test-"));
    const launcher = join(tempDir, "fake-animate.cjs");
    await writeFile(launcher, fakeAnimate);
    await chmod(launcher, 0o755);
    const runsDir = join(tempDir, "runs");
    const client = new Client({ name: "animate-mcp-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "server/src/index.ts"],
        cwd: resolve("."),
        env: {
            ...process.env,
            ANIMATE_MCP_LAUNCH_COMMAND: launcher,
            ANIMATE_MCP_RUNS_DIR: runsDir,
            // Treat the test process itself as "Animate running"
            ANIMATE_MCP_PROCESS_PATTERN: "node",
            FAKE_LOG: join(tempDir, "log"),
            ...env,
        },
    });
    try {
        await client.connect(transport);
        await fn(client, tempDir, runsDir);
    } finally {
        await client.close();
        await rm(tempDir, { recursive: true, force: true });
    }
}

const text = (result: { content?: unknown }) => (result.content as Array<{ text: string }>)[0]?.text ?? "";

test("run_jsfl success, JSFL error, cleanup", { timeout: 20_000 }, () =>
    withServer({}, async (client, _tempDir, runsDir) => {
        const tools = await client.listTools();
        const runJsfl = tools.tools.find((tool) => tool.name === "run_jsfl");
        assert.match(runJsfl?.description ?? "", /arbitrary code/i);

        const success = await client.callTool({ name: "run_jsfl", arguments: { code: "1 + 2" } });
        assert.deepEqual(success.structuredContent, { result: 3 });

        const failure = await client.callTool({
            name: "run_jsfl",
            arguments: { code: "throw new Error('JSFL exploded');" },
        });
        assert.equal(failure.isError, true);
        assert.equal(text(failure), "JSFL exploded");

        assert.deepEqual(await readdir(runsDir), [], "Run and Result files are removed");
    }),
);

test("hung Run times out and cleans up", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_TIMEOUT_MS: "500" }, async (client, _tempDir, runsDir) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "/* HANG */ 1" } });
        assert.equal(result.isError, true);
        assert.match(text(result), /timed out/i);
        assert.deepEqual(await readdir(runsDir), []);
    }),
);

test("hung launcher times out; special values survive", { timeout: 20_000 }, async () => {
    await withServer(
        { ANIMATE_MCP_LAUNCH_COMMAND: "/bin/sleep", ANIMATE_MCP_TIMEOUT_MS: "500" },
        async (client, _tempDir, runsDir) => {
            const result = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
            assert.equal(result.isError, true);
            assert.match(text(result), /timed out|Launcher exited/i);
            assert.deepEqual(await readdir(runsDir), []);
        },
    );
    await withServer({}, async (client) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "'a\\tb\\n\"c\"'" } });
        assert.deepEqual(result.structuredContent, { result: 'a\tb\n"c"' });
    });
});

test("Animate not running is a clear error and nothing is launched", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_PROCESS_PATTERN: "no-such-process-xyzzy" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        assert.equal(result.isError, true);
        assert.match(text(result), /Animate not running/);
        await assert.rejects(readFile(join(tempDir, "log"), "utf8"), { code: "ENOENT" });
    }),
);

test("concurrent Runs are serialized", { timeout: 20_000 }, () =>
    withServer({}, async (client, tempDir) => {
        await Promise.all(
            [1, 2, 3].map((runNumber) => client.callTool({ name: "run_jsfl", arguments: { code: String(runNumber) } })),
        );
        assert.equal(
            (await readFile(join(tempDir, "log"), "utf8")).trim().split("\n").join(","),
            "start,end,start,end,start,end",
        );
    }),
);

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
        assert.ok(JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8")).files["scenes/Scene 1/a_b/1.as"]);
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

const scriptsLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.scripts"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));

const SCENE_FILE = "scenes/Scene 1/a_b/1.as";

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

test("old leftovers in the runs directory are removed on the next Run", { timeout: 20_000 }, () =>
    withServer({}, async (client, _tempDir, runsDir) => {
        await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        const old = join(runsDir, "orphan.result.json");
        await writeFile(old, "{}");
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await utimes(old, twoHoursAgo, twoHoursAgo);
        await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        assert.deepEqual(await readdir(runsDir), []);
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
        assert.deepEqual(seen, [1, 2]);
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

test("get_document_info returns info, or a clear error with no document", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            name: "a.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            timelines: ["Scene 1"],
        });
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(text(result), "No document open");
    });
});
