import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Fake Animate: runs the Run file with minimal FLfile/fl stubs.
// Does not respond to code containing HANG, and logs launch start/end to FAKE_LOG.
export const fakeAnimate = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
/**
 * Writes a message to the configured fake-runtime log when logging is enabled.
 * @param message Message to append to the fake-runtime log
 */
const log = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, message + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
const lib = { name: "Hero", itemType: "movie clip" };
/**
 * Creates a fake Animate keyframe with default properties and any supplied overrides.
 * @param startFrame Starting frame index
 * @param duration Number of frames in the keyframe
 * @param extra Additional keyframe properties to apply
 * @returns The constructed keyframe
 */
const makeKeyframe = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [] }, extra);
// Like real Animate, layer.frames has one element per frame (the keyframe's frame repeated duration times)
/**
 * Expands keyframes into one entry per timeline frame.
 * @param keyframes Keyframes to expand
 * @returns The expanded frame array
 */
const expand = (keyframes) => keyframes.flatMap((keyframe) => Array(keyframe.duration).fill(keyframe));
/**
 * Creates a fake Animate layer and enforces lock behavior on its frames.
 * @param name Layer name
 * @param frames Expanded layer frame array
 * @param layerType Animate layer type
 * @param locked Whether the layer starts locked
 * @param parentLayer Parent layer, if any
 * @returns The constructed layer
 */
const layer = (name, frames, layerType = "normal", locked = false, parentLayer = null) => {
  const result = { name, frames, layerType, locked, writeWasUnlocked: false };
  if (parentLayer) result.parentLayer = parentLayer;
  if (locked) {
    for (const frame of new Set(frames)) {
      let actionScript = frame.actionScript;
      Object.defineProperty(frame, "actionScript", {
        /** Returns the frame's current ActionScript. */
        get: () => actionScript,
        /**
         * Updates the frame's ActionScript, enforcing the layer lock.
         * @param value New ActionScript text
         */
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
/**
 * Creates a fake Animate timeline with the operations used by the tests.
 * @param name Timeline name
 * @param frames Initial timeline frame count
 * @param layers Timeline layers
 * @param libraryItem Library item associated with the timeline, if any
 * @returns The constructed timeline
 */
const makeTimeline = (name, frames, layers, libraryItem) => {
  const timeline = { name, frameCount: frames, currentLayer: 0, currentFrame: 0, selectedFrames: null, clipboard: null, layers, libraryItem,
    /** Recalculates the timeline frame count from its layers. */
    recalculateFrameCount() { this.frameCount = Math.max(0, ...this.layers.map((candidate) => candidate.frames.length)); },
    /**
     * Recalculates keyframe spans on a layer and updates the timeline frame count.
     * @param targetLayer Layer whose keyframe spans to recalculate
     */
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
    /**
     * Inserts frames into the current layer or all non-folder layers.
     * @param count Number of frames to insert
     * @param allLayers Whether to insert into every non-folder layer
     * @param frameNumberIndex Zero-based insertion frame index
     */
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
    /**
     * Removes a range of frames from the current layer.
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index
     */
    removeFrames(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    /**
     * Inserts a keyframe at the requested frame on the current layer.
     * @param frameNumber Zero-based frame index for the new keyframe
     */
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
    /**
     * Converts the requested frame on the current layer to a keyframe.
     * @param frameNumber Zero-based frame index to convert
     */
    convertToKeyframes(frameNumber) {
      this.insertKeyframe(frameNumber);
    },
    /**
     * Clears a keyframe on the current layer and merges its span with the prior span.
     * @param frameNumber Zero-based frame index of the keyframe to clear
     */
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
    /**
     * Sets a property on frames in the current layer.
     * @param property Frame property to update
     * @param value New property value
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index, or undefined for one frame
     */
    setFrameProperty(property, value, startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      const end = endFrameIndex === undefined ? startFrameIndex + 1 : endFrameIndex;
      for (let index = startFrameIndex; index < end; index++) target.frames[index][property] = value;
    },
    /**
     * Selects the current layer by index.
     * @param layerIndex Zero-based layer index
     */
    setSelectedLayers(layerIndex) {
      this.currentLayer = layerIndex;
    },
    /**
     * Selects a frame range on the current layer.
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index
     */
    setSelectedFrames(startFrameIndex, endFrameIndex) {
      this.selectedFrames = [this.currentLayer, startFrameIndex, endFrameIndex];
    },
    /** Cuts the selected range from its layer into the timeline clipboard. */
    cutFrames() {
      const [layerIndex, startFrameIndex, endFrameIndex] = this.selectedFrames;
      const target = this.layers[layerIndex];
      if (target.locked) throw new Error("Layer is locked");
      this.clipboard = target.frames.slice(startFrameIndex, endFrameIndex).map((frame) => Object.assign({}, frame));
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    /**
     * Pastes the clipboard into the current layer at the given frame.
     * @param startFrameIndex Zero-based frame index for the paste
     */
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
    /**
     * Deletes a layer and clears child references to it.
     * @param layerIndex Zero-based index of the layer to delete
     */
    deleteLayer(layerIndex) {
      const removed = this.layers.splice(layerIndex, 1)[0];
      for (const candidate of this.layers) if (candidate.parentLayer === removed) delete candidate.parentLayer;
      this.currentLayer = Math.min(this.currentLayer, this.layers.length - 1);
      this.recalculateFrameCount();
    },
    /**
     * Moves a layer before or after another layer.
     * @param layerToMove Zero-based index of the layer to move
     * @param layerToPutItBy Zero-based index of the reference layer
     * @param addBefore Whether to place the moved layer before the reference layer
     */
    reorderLayer(layerToMove, layerToPutItBy, addBefore = true) {
      const moved = this.layers.splice(layerToMove, 1)[0];
      let target = layerToPutItBy - (layerToMove < layerToPutItBy ? 1 : 0);
      if (!addBefore) target++;
      this.layers.splice(target, 0, moved);
    },
    /**
     * Adds a layer adjacent to the current layer and selects it.
     * @param layerName Name of the new layer
     * @param layerType Animate layer type
     * @param addAbove Whether to insert above the current layer
     * @returns The zero-based index of the new layer
     */
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
/**
 * Creates a one-frame fake timeline for a library symbol.
 * @param symbolName Library symbol name
 * @param script Initial ActionScript for the symbol
 * @returns The constructed symbol timeline
 */
const symTimeline = (symbolName, script) => makeTimeline(symbolName, 1, [layer("L", expand([makeKeyframe(0, 1, { actionScript: script })]))], { name: symbolName });
/**
 * Builds a fake Animate document and its scene and library timelines.
 * @param documentName Document name
 * @param documentType Document type
 * @returns The constructed fake document
 */
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
  /**
   * Returns the active library-symbol timeline or the main scene timeline.
   * @returns The currently active timeline
   */
  document.getTimeline = () => editing ? (document.syms[editing] ||= symTimeline(editing, process.env.FAKE_SYM_SCRIPT ?? "// " + editing)) : document.timelines[0];
  /** Exits library-item editing mode. */
  document.exitEditMode = () => { editing = null; };
  /** Provides the scene-editing stub required by the fake Animate API. */
  document.editScene = () => {};
  const libraryItems = [
    { name: "F", itemType: "folder" },
    { name: "dir", itemType: "folder" },
    { name: "dir/Hero", itemType: "movie clip", linkageExportForAS: true, linkageClassName: "com.Hero" },
    { name: "dir/Bitmap", itemType: "bitmap" },
    { name: "Bitmap", itemType: "bitmap" },
    { name: "Sound", itemType: "sound" },
    ...Array.from({ length: Number(process.env.FAKE_EXTRA ?? 0) }, (_, index) => ({ name: "S" + index, itemType: "graphic" })),
    { name: "Broken", itemType: "button" },
  ];
  let selectedLibraryItem = null;
  const library = {
    items: libraryItems,
    /** Returns library items that are not marked as used by the test environment.
     * @returns Unused library items.
     */
    get unusedItems() {
      const used = (process.env.FAKE_USED ?? "").split(",");
      return libraryItems.filter((item) => !used.includes(item.name));
    },
    /** Tests whether a library path exists.
     * @param path Library path.
     * @returns Whether the path exists.
     */
    itemExists: (path) => libraryItems.some((item) => item.name === path),
    /** Creates a library folder and any missing intermediate folders.
     * @param path Folder path.
     * @returns Nothing.
     */
    newFolder(path) {
      let current = "";
      for (const part of path.split("/")) {
        current = current ? current + "/" + part : part;
        if (!libraryItems.some((item) => item.name === current)) {
          libraryItems.push({ name: current, itemType: "folder" });
        }
      }
    },
    /** Moves a library item into a folder.
     * @param folder Destination folder.
     * @param itemPath Source path.
     * @param overwrite Whether the move may replace an existing item.
     * @returns Nothing.
     */
    moveToFolder(folder, itemPath, overwrite) {
      const source = libraryItems.find((item) => item.name === itemPath);
      const basename = itemPath.split("/").at(-1);
      const destination = folder ? folder + "/" + basename : basename;
      if (!source) {
        throw new Error("missing source");
      }
      if (overwrite) {
        throw new Error("overwrite is unsupported in the fake runtime");
      }
      const prefix = itemPath + "/";
      for (const item of libraryItems) {
        if (item.name === itemPath || item.name.startsWith(prefix)) {
          item.name = destination + item.name.slice(itemPath.length);
        }
      }
    },
    /** Clears library selection.
     * @returns Nothing.
     */
    selectNone() {
      selectedLibraryItem = null;
    },
    /** Selects the library item at a path.
     * @param path Library item path.
     * @returns Nothing.
     */
    selectItem(path) {
      selectedLibraryItem = libraryItems.find((item) => item.name === path) ?? null;
    },
    /** Renames the selected library item.
     * @param name New basename.
     * @returns Nothing.
     */
    renameItem(name) {
      if (!selectedLibraryItem) {
        throw new Error("nothing selected");
      }
      const oldPath = selectedLibraryItem.name;
      const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) + "/" : "";
      const nextPath = parent + name;
      for (const item of libraryItems) {
        if (item.name === oldPath || item.name.startsWith(oldPath + "/")) {
          item.name = nextPath + item.name.slice(oldPath.length);
        }
      }
    },
    /** Deletes a library item and its descendants.
     * @param path Library item path.
     * @returns Nothing.
     */
    deleteItem(path) {
      for (let index = libraryItems.length - 1; index >= 0; index--) {
        if (libraryItems[index].name === path || libraryItems[index].name.startsWith(path + "/")) {
          libraryItems.splice(index, 1);
        }
      }
    },
    /**
     * Opens a library item for timeline editing.
     * @param itemName Library item name to open
     * @returns Nothing.
     */
    editItem: (itemName) => {
      if (itemName === "Broken" && !process.env.FAKE_NO_BROKEN) {
        throw new Error("cannot edit");
      }
      editing = itemName;
    },
  };
  document.library = library;
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
  FLfile: {
    /**
     * Converts a platform path to its fake URI representation.
     * @param path Path to convert
     * @returns The unchanged path
     */
    platformPathToURI: (path) => path,
    /**
     * Writes content to a fake Animate file path.
     * @param path Destination path
     * @param content File contents
     */
    write: (path, content) => writeFileSync(path, content),
  },
  fl: {
    /** Provides the no-op trace method used by the fake Animate API. */
    trace() {},
    documents: docs,
    /**
     * Returns the first open fake document, or null when no document is open.
     * @returns The active document or null
     */
    getDocumentDOM: () => docs[0] || null,
  },
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
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".library", JSON.stringify(docs[0].library.items.map((item) => ({ name: item.name, itemType: item.itemType }))) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".layers", JSON.stringify(docs[0].timelines[0].layers.map((candidate) => ({ name: candidate.name, type: candidate.layerType, parent: candidate.parentLayer?.name, locked: candidate.locked, writeWasUnlocked: candidate.writeWasUnlocked, frames: candidate.frames.map((frame, index) => frame.startFrame === index ? { start: frame.startFrame, duration: frame.duration, script: frame.actionScript, tween: frame.tweenType, label: frame.name } : null).filter(Boolean) }))) + "\\n");
log("end");
`;

/**
 * Starts the Server over stdio with env, passes an MCP client to fn, and closes it afterwards.
 * @param env Extra environment variables for the Server
 * @param fn Test body; receives the MCP client, a temp directory and the Runs directory
 * @returns Promise<void> that resolves when fn completes
 */
export async function withServer(
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

/**
 * Extracts the first text item from an MCP tool result.
 * @param result MCP tool result with optional content
 * @returns The first text item, or an empty string
 */
export const text = (result: { content?: unknown }) => (result.content as Array<{ text: string }>)[0]?.text ?? "";
/**
 * Reads and parses the fake runtime's script-write log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed script log entries
 */
export const scriptsLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.scripts"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
/**
 * Reads and parses the fake runtime's layer-state log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed layer snapshots
 */
export const layersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
/**
 * Reads and parses the fake runtime's symbol-layer log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed symbol-layer snapshots
 */
export const symbolLayersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.sym-layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));

/**
 * Calls the edit_timeline MCP tool with the supplied operations.
 * @param client Connected MCP client
 * @param timeline Timeline index or library item name
 * @param ops Timeline operations to apply
 * @returns The MCP tool call promise
 */
export const editTimeline = (client: Client, timeline: number | string, ops: unknown[]) =>
    client.callTool({ name: "edit_timeline", arguments: { timeline, ops } });

export const SCENE_FILE = "scenes/Scene 1/a_b/1.as";
