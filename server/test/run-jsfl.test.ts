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
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
const log = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, message + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
const lib = { name: "Hero", itemType: "movie clip" };
const makeKeyframe = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [] }, extra);
// Like real Animate, layer.frames has one element per frame (the keyframe's frame repeated duration times)
const expand = (keyframes) => keyframes.flatMap((keyframe) => Array(keyframe.duration).fill(keyframe));
const layer = (name, frames, layerType = "normal", locked = false, parentLayer = null) => {
  const result = { name, frames, layerType, locked, writeWasUnlocked: false };
  if (parentLayer) result.parentLayer = parentLayer;
  if (locked) {
    for (const frame of new Set(frames)) {
      let actionScript = frame.actionScript;
      Object.defineProperty(frame, "actionScript", {
        get: () => actionScript,
        set: (value) => {
          if (result.locked) throw new Error("Layer is locked");
          result.writeWasUnlocked = true;
          actionScript = value;
        },
      });
    }
  }
  return result;
};
const makeTimeline = (name, frames, layers, libraryItem) => {
  const timeline = { name, frameCount: frames, currentLayer: 0, currentFrame: 0, selectedFrames: null, clipboard: null, layers, libraryItem,
    recalculateFrameCount() { this.frameCount = Math.max(0, ...this.layers.map((candidate) => candidate.frames.length)); },
    recalculateLayer(targetLayer) {
      let start = 0;
      while (start < targetLayer.frames.length) {
        const frame = targetLayer.frames[start];
        let end = start + 1;
        while (end < targetLayer.frames.length && targetLayer.frames[end] === frame) end++;
        frame.startFrame = start;
        frame.duration = end - start;
        start = end;
      }
      this.recalculateFrameCount();
    },
    insertFrames(count, allLayers, frameNumberIndex) {
      const targets = allLayers ? this.layers.filter((candidate) => candidate.layerType !== "folder") : [this.layers[this.currentLayer]];
      for (const target of targets) {
        if (target.locked) throw new Error("Layer is locked");
        const index = Math.min(frameNumberIndex, target.frames.length);
        const active = target.frames[Math.min(index, target.frames.length - 1)];
        const insertAt = active && active.startFrame === index ? index + 1 : index;
        const content = active || makeKeyframe(insertAt, count);
        target.frames.splice(insertAt, 0, ...Array(count).fill(content));
        this.recalculateLayer(target);
      }
    },
    removeFrames(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    insertKeyframe(frameNumber) {
      const currentLayer = this.layers[this.currentLayer];
      if (currentLayer.locked) throw new Error("Layer is locked");
      const oldFrame = currentLayer.frames[frameNumber];
      if (!oldFrame) {
        currentLayer.frames[frameNumber] = makeKeyframe(frameNumber, 1);
        return;
      }
      if (oldFrame.startFrame === frameNumber) return;
      const oldEnd = oldFrame.startFrame + oldFrame.duration;
      oldFrame.duration = frameNumber - oldFrame.startFrame;
      const insertedFrame = Object.assign({}, oldFrame, { startFrame: frameNumber, duration: oldEnd - frameNumber, actionScript: "" });
      for (let index = frameNumber; index < oldEnd; index++) { currentLayer.frames[index] = insertedFrame; }
      if (process.env.FAKE_PERSIST_AS && currentLayer.name.toLowerCase() === "as") {
        writeFileSync(process.env.FAKE_LOG + ".as-keyframe-created", "yes");
      }
    },
    convertToKeyframes(frameNumber) {
      this.insertKeyframe(frameNumber);
    },
    clearKeyframes(frameNumber) {
      const currentLayer = this.layers[this.currentLayer];
      if (currentLayer.locked) throw new Error("Layer is locked");
      const frame = currentLayer.frames[frameNumber];
      if (!frame || frame.startFrame !== frameNumber) return;
      if (frameNumber === 0) {
        const blank = makeKeyframe(0, frame.duration);
        for (let index = 0; index < frame.duration; index++) currentLayer.frames[index] = blank;
      } else {
        const previous = currentLayer.frames[frameNumber - 1];
        previous.duration += frame.duration;
        for (let index = frameNumber; index < frameNumber + frame.duration; index++) currentLayer.frames[index] = previous;
      }
      this.recalculateLayer(currentLayer);
    },
    setFrameProperty(property, value, startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      const end = endFrameIndex === undefined ? startFrameIndex + 1 : endFrameIndex;
      for (let index = startFrameIndex; index < end; index++) target.frames[index][property] = value;
    },
    setSelectedLayers(layerIndex) {
      this.currentLayer = layerIndex;
    },
    setSelectedFrames(startFrameIndex, endFrameIndex) {
      this.selectedFrames = [this.currentLayer, startFrameIndex, endFrameIndex];
    },
    cutFrames() {
      const [layerIndex, startFrameIndex, endFrameIndex] = this.selectedFrames;
      const target = this.layers[layerIndex];
      if (target.locked) throw new Error("Layer is locked");
      this.clipboard = target.frames.slice(startFrameIndex, endFrameIndex).map((frame) => Object.assign({}, frame));
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    pasteFrames(startFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      const keyframes = this.clipboard.filter((frame, index) => frame.startFrame === index).map((frame) =>
        Object.assign({}, frame, { startFrame: frame.startFrame + startFrameIndex }),
      );
      const lastKeyframe = keyframes.at(-1);
      if (lastKeyframe) lastKeyframe.duration = Math.max(lastKeyframe.duration, this.frameCount - lastKeyframe.startFrame);
      const frames = [];
      if (startFrameIndex > 0) {
        const blank = makeKeyframe(0, startFrameIndex);
        frames.push(...Array(startFrameIndex).fill(blank));
      }
      for (const frame of keyframes) frames.push(...Array(frame.duration).fill(frame));
      target.frames.splice(0, target.frames.length, ...frames);
      this.recalculateLayer(target);
    },
    deleteLayer(layerIndex) {
      const removed = this.layers.splice(layerIndex, 1)[0];
      for (const candidate of this.layers) if (candidate.parentLayer === removed) delete candidate.parentLayer;
      this.currentLayer = Math.min(this.currentLayer, this.layers.length - 1);
      this.recalculateFrameCount();
    },
    reorderLayer(layerToMove, layerToPutItBy, addBefore = true) {
      const moved = this.layers.splice(layerToMove, 1)[0];
      let target = layerToPutItBy - (layerToMove < layerToPutItBy ? 1 : 0);
      if (!addBefore) target++;
      this.layers.splice(target, 0, moved);
    },
    addNewLayer(layerName, layerType, addAbove) {
      const newLayer = layer(layerName, expand([makeKeyframe(0, this.frameCount)]), layerType);
      const index = this.layers.length ? this.currentLayer + (addAbove ? 0 : 1) : 0;
      this.layers.splice(index, 0, newLayer);
      this.currentLayer = index;
      if (process.env.FAKE_PERSIST_AS && layerName.toLowerCase() === "as") {
        writeFileSync(process.env.FAKE_LOG + ".as-created", "yes");
      }
      return index;
    },
  };
  return timeline;
};
const symTimeline = (symbolName, script) => makeTimeline(symbolName, 1, [layer("L", expand([makeKeyframe(0, 1, { actionScript: script })]))], { name: symbolName });
const doc = (documentName, documentType) => {
  const sceneFrames = [
    makeKeyframe(0, 2, { actionScript: process.env.FAKE_SCRIPT ?? "stop();\\n// 日本語", elements: [{ name: "hero", elementType: "instance", libraryItem: lib }] }),
    makeKeyframe(2, 3, { name: "end", ...(process.env.FAKE_TWEEN ? { tweenType: process.env.FAKE_TWEEN } : {}), elements: [{ name: "", elementType: "instance", libraryItem: lib }] }),
  ];
  if (process.env.FAKE_INNER_KEYFRAME) sceneFrames[1].duration = 3;
  const sceneLayers = [layer("a/b", expand(sceneFrames)),
    ...(process.env.FAKE_SECOND_LAYER ? [layer(process.env.FAKE_SECOND_LAYER, expand([makeKeyframe(0, Number(process.env.FAKE_SECOND_LENGTH ?? 5))]))] : []),
    layer("dir", [], "folder")];
  if (process.env.FAKE_INNER_KEYFRAME) sceneLayers[0].frames[3] = makeKeyframe(3, 1);
  if (process.env.FAKE_AS_LAYER) {
    sceneLayers.unshift(layer(process.env.FAKE_AS_LAYER, expand([makeKeyframe(0, 5)]), "normal", Boolean(process.env.FAKE_LOCK_AS)));
  }
  const sceneTimeline = makeTimeline("Scene 1", Math.max(5, ...sceneLayers.map((candidate) => candidate.frames.length)), sceneLayers);
  const document = { name: documentName, type: documentType, width: 550, height: 400, frameRate: 24, currentTimeline: 0, timelines: [sceneTimeline] };
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
if (process.env.FAKE_PERSIST_AS && docs[0] && existsSync(process.env.FAKE_LOG + ".scene-script")) {
  const actionLayer = docs[0].timelines[0].layers.find((candidate) => candidate.name === "a/b");
  actionLayer.frames[0].actionScript = readFileSync(process.env.FAKE_LOG + ".scene-script", "utf8");
}
if (process.env.FAKE_PERSIST_AS && src.includes("var __newScripts") && existsSync(process.env.FAKE_LOG + ".as-created")) {
  const asFrames = existsSync(process.env.FAKE_LOG + ".as-keyframe-created")
    ? expand([makeKeyframe(0, 3), makeKeyframe(3, 2)])
    : expand([makeKeyframe(0, 5)]);
  docs[0].timelines[0].layers.unshift(layer("as", asFrames));
}
if (process.env.FAKE_CONFLICT_NEW && src.includes("var __newScripts")) {
  const targetLayer = docs[0].timelines[0].layers.find((candidate) => candidate.name === "a/b");
  const oldFrame = targetLayer.frames[3];
  const end = oldFrame.startFrame + oldFrame.duration;
  oldFrame.duration = 3 - oldFrame.startFrame;
  const newFrame = Object.assign({}, oldFrame, { startFrame: 3, duration: end - 3, actionScript: "changed in Animate" });
  for (let index = 3; index < end; index++) { targetLayer.frames[index] = newFrame; }
}
if (!src.includes("HANG")) runInNewContext(src, {
  FLfile: { platformPathToURI: (path) => path, write: (path, content) => writeFileSync(path, content) },
  fl: { trace() {}, documents: docs, getDocumentDOM: () => docs[0] || null },
});
if (process.env.FAKE_LOG && src.includes("var __newScripts")) {
  const stage = [];
  if (!src.includes("var __edits = [];")) stage.push("edits");
  if (!src.includes("var __newScripts = [];")) stage.push("new");
  appendFileSync(process.env.FAKE_LOG + ".order", stage.join("+") + "\\n");
}
if (process.env.FAKE_PERSIST_AS && src.includes("play();")) {
  writeFileSync(process.env.FAKE_LOG + ".scene-script", "play();");
}
process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".scripts", JSON.stringify(docs.map((document) => document.timelines[0].layers[0]?.frames[0]?.actionScript)) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".sym", JSON.stringify(Object.fromEntries(Object.entries(docs[0].syms).map(([symbolName, timeline]) => [symbolName, timeline.layers[0].frames[0].actionScript]))) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".sym-layers", JSON.stringify(Object.fromEntries(Object.entries(docs[0].syms).map(([symbolName, timeline]) => [symbolName, timeline.layers.map((candidate) => ({ name: candidate.name, script: candidate.frames[0]?.actionScript }))]))) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".layers", JSON.stringify(docs[0].timelines[0].layers.map((candidate) => ({ name: candidate.name, type: candidate.layerType, parent: candidate.parentLayer?.name, locked: candidate.locked, writeWasUnlocked: candidate.writeWasUnlocked, frames: candidate.frames.map((frame, index) => frame.startFrame === index ? { start: frame.startFrame, duration: frame.duration, script: frame.actionScript, tween: frame.tweenType, label: frame.name } : null).filter(Boolean) }))) + "\\n");
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
    await withServer({}, async (client, _tempDir) => {
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
        const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
        assert.ok(manifest.files["scenes/Scene 1/a_b/1.as"]);
        assert.match(manifest.timelines[0].structureFingerprint, /^fnv1a32:/);
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
const layersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
const symbolLayersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.sym-layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));

const editTimeline = (client: Client, timeline: number | string, ops: unknown[]) =>
    client.callTool({ name: "edit_timeline", arguments: { timeline, ops } });

test("edit_timeline applies layer operations, parenting and relative placement", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client) => {
        const result = await editTimeline(client, 0, [
            { op: "addLayer", name: "Folder", type: "folder" },
            { op: "addLayer", name: "Child", parent: "Folder" },
            { op: "addLayer", name: "Mask", type: "mask" },
            { op: "addLayer", name: "Masked", type: "masked", parent: "Mask" },
            { op: "addLayer", name: "Mover", above: "Other" },
            { op: "addLayer", name: "After", below: "Other" },
            { op: "setLayerType", layer: "Child", type: "masked", parent: "Mask" },
            { op: "setLayerType", layer: "Child", type: "normal", parent: "Folder" },
            { op: "moveLayer", layer: "Mover", below: "Child", parent: "Folder" },
            { op: "renameLayer", layer: "a/b", name: "Renamed" },
            { op: "setLayerType", layer: "Other", type: "guide" },
        ]);
        const summary = result.structuredContent as {
            applied: unknown[];
            failed: unknown;
            skipped: unknown[];
            warnings: string[];
            layers: { name: string; type: string; parent?: string; locked: boolean }[];
        };
        assert.equal(result.isError, undefined, text(result));
        assert.equal(summary.applied.length, 11);
        assert.equal(summary.failed, null);
        assert.deepEqual(summary.skipped, []);
        assert.match(text(result), /Export again before apply_scripts/);
        assert.equal(summary.layers.find((entry) => entry.name === "Child")?.parent, "Folder");
        assert.equal(summary.layers.find((entry) => entry.name === "Masked")?.parent, "Mask");
        assert.equal(summary.layers.find((entry) => entry.name === "Child")?.type, "normal");
        assert.equal(summary.layers.find((entry) => entry.name === "Other")?.type, "guide");
        assert.equal(summary.layers.find((entry) => entry.name === "Mover")?.parent, "Folder");
        assert.ok(
            summary.layers.findIndex((entry) => entry.name === "Mover") >
                summary.layers.findIndex((entry) => entry.name === "Child"),
        );
        assert.ok(
            summary.layers.findIndex((entry) => entry.name === "After") >
                summary.layers.findIndex((entry) => entry.name === "Other"),
        );
    }),
);

test("edit_timeline requires confirmation, stops after failure, and disambiguates duplicate names", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client) => {
        const result = await editTimeline(client, 0, [
            { op: "renameLayer", layer: "a/b", name: "Before failure" },
            { op: "deleteLayer", layer: "Before failure" },
            { op: "renameLayer", layer: "dir", name: "Skipped" },
        ]);
        const summary = result.structuredContent as {
            applied: unknown[];
            failed: { error: string };
            skipped: unknown[];
            layers: { name: string }[];
        };
        assert.equal(summary.applied.length, 1);
        assert.match(summary.failed.error, /confirm required/);
        assert.equal(summary.skipped.length, 1);
        assert.ok(summary.layers.some((entry) => entry.name === "Before failure"));
        assert.ok(!summary.layers.some((entry) => entry.name === "Skipped"));
        const unconfirmedFrames = await editTimeline(client, 0, [
            { op: "removeFrames", layer: "a/b", frame: 1, count: 1 },
        ]);
        assert.match(
            (unconfirmedFrames.structuredContent as { failed: { error: string } }).failed.error,
            /confirm required/,
        );
        const confirmed = await editTimeline(client, 0, [{ op: "deleteLayer", layer: "a/b", confirm: true }]);
        assert.equal((confirmed.structuredContent as { failed: unknown }).failed, null, text(confirmed));
    });
    await withServer({ FAKE_SECOND_LAYER: "a/b" }, async (client) => {
        const ambiguous = await editTimeline(client, 0, [{ op: "renameLayer", layer: "a/b", name: "Nope" }]);
        assert.match((ambiguous.structuredContent as { failed: { error: string } }).failed.error, /ambiguous/);
        const selected = await editTimeline(client, 0, [{ op: "renameLayer", layer: "a/b", index: 1, name: "Second" }]);
        assert.equal((selected.structuredContent as { failed: unknown }).failed, null);
        assert.equal(
            (selected.structuredContent as { layers: { name: string }[] }).layers.filter(
                (entry) => entry.name === "Second",
            ).length,
            1,
        );
    });
});

test("edit_timeline supports frame edits and labels", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const result = await editTimeline(client, 0, [
            { op: "insertFrames", layer: "a/b", frame: 3, count: 1 },
            { op: "setLabel", layer: "a/b", frame: 1, label: "intro" },
            { op: "insertKeyframe", layer: "a/b", frame: 2 },
            { op: "clearKeyframe", layer: "a/b", frame: 2 },
            { op: "removeFrames", layer: "a/b", frame: 3, count: 1, confirm: true },
        ]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown; warnings: string[] };
        assert.equal(summary.applied.length, 5);
        assert.equal(summary.failed, null);
        assert.equal(summary.warnings.length, 2, "single-layer frame shifts warn");
        const layers = (await layersLog(tempDir)).at(-1);
        const targetLayer = layers.find((entry: { name: string }) => entry.name === "a/b");
        assert.equal(targetLayer.frames[0].label, "intro");
        assert.equal(targetLayer.frames[0].duration, 2, "clearing the inserted keyframe joins its span");
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);
    }),
);

test("edit_timeline ripple inserts and removes the same range on every layer", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const result = await editTimeline(client, 0, [
            { op: "insertFrames", layer: "a/b", frame: 3, count: 1, ripple: true },
            { op: "removeFrames", layer: "a/b", frame: 3, count: 1, confirm: true, ripple: true },
        ]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null);
        assert.deepEqual((result.structuredContent as { warnings: string[] }).warnings, []);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[0].duration, 2);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);
    }),
);

test("edit_timeline restores locks and edits library-item timelines", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_AS_LAYER: "AS", FAKE_LOCK_AS: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "setLabel", layer: "AS", frame: 1, label: "locked edit" }]);
        const layer = (result.structuredContent as { layers: { name: string; locked: boolean }[] }).layers[0];
        assert.equal(layer.name, "AS");
        assert.equal(layer.locked, true);
    });
    await withServer({}, async (client) => {
        const result = await editTimeline(client, "dir/Hero", [{ op: "renameLayer", layer: "L", name: "Actions" }]);
        assert.equal(result.isError, undefined, text(result));
        assert.equal((result.structuredContent as { layers: { name: string }[] }).layers[0].name, "Actions");
    });
});

test("edit_timeline rejects tween interiors but setSpanLength may resize a tween span", { timeout: 30_000 }, () =>
    withServer({ FAKE_TWEEN: "motion" }, async (client) => {
        for (const op of [
            { op: "insertFrames", layer: "a/b", frame: 4, count: 1 },
            { op: "removeFrames", layer: "a/b", frame: 4, count: 1, confirm: true },
            { op: "insertKeyframe", layer: "a/b", frame: 4 },
            { op: "clearKeyframe", layer: "a/b", frame: 4 },
        ]) {
            const result = await editTimeline(client, 0, [op]);
            assert.match(
                (result.structuredContent as { failed: { error: string } }).failed.error,
                /Frame is inside a tween/,
            );
        }
        const start = await editTimeline(client, 0, [{ op: "insertKeyframe", layer: "a/b", frame: 3 }]);
        assert.equal((start.structuredContent as { failed: unknown }).failed, null);
        const resized = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 4 }]);
        assert.equal((resized.structuredContent as { failed: unknown }).failed, null);
    }),
);

test("edit_timeline setSpanLength grows, shrinks, enforces minimum, rejects inner keys and ripples", {
    timeout: 30_000,
}, async () => {
    await withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const grew = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 4 }]);
        assert.equal((grew.structuredContent as { failed: unknown }).failed, null);
        assert.match((grew.structuredContent as { warnings: string[] }).warnings[0], /Only layer a\/b shifted/);
        let layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 4);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);

        const shrunk = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 2 }]);
        assert.equal((shrunk.structuredContent as { failed: unknown }).failed, null);
        layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 2);
    });
    await withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const ripple = await editTimeline(client, 0, [
            { op: "setSpanLength", layer: "a/b", frame: 4, length: 5, ripple: true },
        ]);
        assert.equal((ripple.structuredContent as { failed: unknown }).failed, null);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 5);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 7);
        assert.deepEqual((ripple.structuredContent as { warnings: string[] }).warnings, []);
    });
    await withServer({ FAKE_INNER_KEYFRAME: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 3, length: 4 }]);
        assert.match(
            (result.structuredContent as { failed: { error: string } }).failed.error,
            /Another keyframe lies inside the span/,
        );
        const tooShort = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 3, length: 1 }]);
        assert.equal(tooShort.isError, true, "length below 2 is rejected by the input schema");
    });
});

test("edit_timeline shiftLayerFrames offsets content without changing span lengths", { timeout: 30_000 }, async () => {
    await withServer(
        { FAKE_TWEEN: "motion", FAKE_SECOND_LAYER: "Other", FAKE_SECOND_LENGTH: "10" },
        async (client, tempDir) => {
            const result = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "a/b", offset: 2 }]);
            assert.equal(result.isError, undefined, text(result));
            const summary = result.structuredContent as {
                applied: unknown[];
                failed: unknown;
                warnings: string[];
            };
            assert.equal(summary.applied.length, 1);
            assert.equal(summary.failed, null);
            assert.match(summary.warnings[0], /other layers were not shifted/);

            const layers = (await layersLog(tempDir)).at(-1);
            const shifted = layers.find((entry: { name: string }) => entry.name === "a/b");
            assert.deepEqual(
                shifted.frames.map((frame: { start: number; duration: number }) => [frame.start, frame.duration]),
                [
                    [0, 2],
                    [2, 2],
                    [4, 3],
                ],
            );
            assert.equal(shifted.frames[0].script, "", "the leading offset is empty");
            assert.equal(shifted.frames[1].script, "stop();\n// 日本語");
            assert.equal(shifted.frames[1].tween, "none");
            assert.equal(shifted.frames[2].tween, "motion", "the tween type is preserved");
            assert.equal(
                shifted.frames.reduce((length: number, frame: { duration: number }) => length + frame.duration, 0),
                7,
            );
            assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 10);
        },
    );

    await withServer({ FAKE_AS_LAYER: "AS", FAKE_LOCK_AS: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "AS", offset: 1 }]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null, text(result));
        assert.equal((result.structuredContent as { layers: { locked: boolean }[] }).layers[0].locked, true);
    });

    await withServer({ FAKE_SECOND_LAYER: "a/b" }, async (client) => {
        const invalidOffset = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "dir", offset: 0 }]);
        assert.match(
            (invalidOffset.structuredContent as { failed: { error: string } }).failed.error,
            /offset must be at least 1/,
        );
        const ambiguous = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "a/b", offset: 1 }]);
        assert.match((ambiguous.structuredContent as { failed: { error: string } }).failed.error, /ambiguous/);
        const missing = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "missing", offset: 1 }]);
        assert.match((missing.structuredContent as { failed: { error: string } }).failed.error, /Layer not found/);
        const empty = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "dir", offset: 1 }]);
        assert.match((empty.structuredContent as { failed: { error: string } }).failed.error, /no frames/);
    });
});

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
    withServer({}, async (client, tempDir) => {
        const exportDir = join(tempDir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: exportDir } });
        await writeFile(join(exportDir, "library/dir/Hero/L/1.as"), "play();");
        const newFile = "scenes/Scene 1/as/1.as";
        await mkdir(join(exportDir, "scenes/Scene 1/as"), { recursive: true });
        await writeFile(join(exportDir, newFile), "trace('new');");

        const result = await client.callTool({ name: "apply_scripts", arguments: { dir: exportDir } });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual((await readFile(join(tempDir, "log.order"), "utf8")).trim().split("\n"), ["edits", "new"]);
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
