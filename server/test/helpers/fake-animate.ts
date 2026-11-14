import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Fake Animate: runs the Run file with minimal FLfile/fl stubs.
// Does not respond to code containing HANG, and logs launch start/end to FAKE_LOG.
export const fakeAnimate = `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
/**
 * Writes a message to the configured fake-runtime log when logging is enabled.
 * @param message Message to append to the fake-runtime log
 */
const log = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, message + "\\n");
const logPublish = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".publish", message + "\\n");
const logReadOutput = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".read-output", message + "\\n");
const logCapture = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".capture", message + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
const lib = { name: "Hero", itemType: "movie clip" };
/** Simulates Animate's read-only color-effect properties. */
const lockColorEffectProperties = (element) => {
  Object.defineProperties(element, {
    __fakeBrightness: { value: element.brightness, writable: true, configurable: true },
    __fakeTintColor: { value: element.tintColor, writable: true, configurable: true },
    __fakeTintPercent: { value: element.tintPercent, writable: true, configurable: true },
    brightness: { enumerable: true, configurable: true, get() { return this.__fakeBrightness; } },
    tintColor: { enumerable: true, configurable: true, get() { return this.__fakeTintColor; } },
    tintPercent: { enumerable: true, configurable: true, get() { return this.__fakeTintPercent; } },
  });
};
/** Creates a fake Animate symbol instance with a writable transformation point.
 * @param name Instance name
 * @param x Horizontal position
 * @param libraryItem Referenced library symbol
 * @returns The fake symbol instance
 */
const makeInstance = (name, x, libraryItem = lib) => ({ elementType: "instance", name, libraryItem, x, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: 0 }, transformationPoint: { x: 2, y: 3 }, colorMode: "alpha", colorAlphaPercent: 75, colorAlphaAmount: 75, brightness: 0, colorBrightnessPercent: 0, tintColor: "#FFFFFF", tintPercent: 0, color: "#ffffff", colorTintPercent: 0, colorRedPercent: 100, colorGreenPercent: 100, colorBluePercent: 100, colorRedAmount: 0, colorGreenAmount: 0, colorBlueAmount: 0, filters: [], blendMode: "normal", visible: true, cacheAsBitmap: false, loop: "loop", firstFrame: 1, lastFrame: 5, trackAsMenu: false,
  /** Reads the fake transformation point. @returns The transformation point */
  getTransformationPoint() { return this.transformationPoint; },
  /** Writes the fake transformation point.
   * @param point New transformation point
   * @returns Nothing
   */
  setTransformationPoint(point) { this.transformationPoint = { x: point.x, y: point.y }; }
});
/**
 * Creates a fake Animate keyframe with default properties and any supplied overrides.
 * @param startFrame Starting frame index
 * @param duration Number of frames in the keyframe
 * @param extra Additional keyframe properties to apply
 * @returns The constructed keyframe
 */
const makeKeyframe = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [],
  /** Stores fake classic custom-ease points. @param group Tween property group @param points Ease control points @returns Nothing */
  setCustomEase(group, points) { this.customEases = this.customEases || {}; this.customEases[group] = points; },
  /** Returns a minimal fake motion-object XML graph for tween tests. */
  getMotionObjectXML() {
    const timeline = this.__fakeTimeline;
    if (timeline) {
      const layerIndex = timeline.layers.findIndex((candidate) => candidate.frames.includes(this));
      const selected = timeline.selectedFrames;
      if (timeline.currentLayer !== layerIndex || !selected || selected[0] !== layerIndex || selected[1] !== this.startFrame || selected[2] !== this.startFrame + 1) {
        throw new Error("motion XML requested without selecting its layer and frame");
      }
    }
    return this.motionXML || '<AnimationCore TimeScale="24000" Version="1" duration="5000"><PropertyContainer id="Basic_Motion"><Property id="Motion_X"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property><Property id="Motion_Y"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property><Property id="Rotation_Z"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property></PropertyContainer><PropertyContainer id="Transformation"><Property id="Scale_X"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property><Property id="Scale_Y"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property></PropertyContainer><PropertyContainer id="Colors"><Property id="Alpha_Amount"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property><Property id="Brightness_Amount"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property></PropertyContainer></AnimationCore>';
  },
  /** Stores a fake motion-object XML graph. @param xml XML graph to store */
  setMotionObjectXML(xml) { this.motionXML = xml; }
}, extra);
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
  if (process.env.FAKE_ENFORCE_ELEMENT_LOCK) {
    for (const frame of new Set(frames)) for (const element of frame.elements || []) {
      let x = element.x;
      Object.defineProperty(element, "x", {
        enumerable: true,
        configurable: true,
        get: () => x,
        set: (value) => {
          if (result.locked) throw new Error("Layer is locked");
          result.writeWasUnlocked = true;
          x = value;
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
      const insertedFrame = Object.assign({}, oldFrame, { startFrame: frameNumber, duration: oldEnd - frameNumber, actionScript: "", elements: oldFrame.elements.map((element) => Object.assign({}, element, { filters: (element.filters || []).map((filter) => Object.assign({}, filter)) })) });
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
    getSelectedFrames() { return this.selectedFrames ? this.selectedFrames.slice() : []; },
    setSelectedFrames(startFrameIndex, endFrameIndex) {
      if (Array.isArray(startFrameIndex)) {
        this.selectedFrames = startFrameIndex.slice();
        if (this.selectedFrames.length) this.currentLayer = this.selectedFrames[0];
      } else {
        this.selectedFrames = [this.currentLayer, startFrameIndex, endFrameIndex];
      }
    },
    /** Creates a fake motion-object span from a zero-based start to an exclusive end.
     * @param startFrameIndex Zero-based start frame
     * @param endFrameIndex Exclusive end frame
     * @returns Nothing
     */
    createMotionObject(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      this.insertKeyframe(startFrameIndex);
      const frame = target.frames[startFrameIndex];
      frame.tweenType = "motion object";
      for (let index = startFrameIndex; index < endFrameIndex; index++) target.frames[index] = frame;
      this.recalculateLayer(target);
    },
    /** Creates a fake classic tween between adjacent keyframes.
     * @param startFrameIndex Zero-based start frame
     * @param endFrameIndex Exclusive end frame
     * @returns Nothing
     */
    createMotionTween(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      const frame = target.frames[startFrameIndex];
      frame.tweenType = "motion";
      frame.duration = endFrameIndex - startFrameIndex;
      this.recalculateLayer(target);
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
      const actualName = process.env.FAKE_RENAME_STATIC && layerName === "static" ? "static_idn" : layerName;
      const newLayer = layer(actualName, expand([makeKeyframe(0, this.frameCount)]), layerType);
      const insertIndex = this.layers.length ? this.currentLayer + (addAbove ? 0 : 1) : 0;
      this.layers.splice(insertIndex, 0, newLayer);
      this.currentLayer = insertIndex;
      if (process.env.FAKE_PERSIST_AS && layerName.toLowerCase() === "as") {
        writeFileSync(process.env.FAKE_LOG + ".as-created", "yes");
      }
      return insertIndex;
    },
  };
  for (const candidate of layers) for (const frame of new Set(candidate.frames)) {
    Object.defineProperty(frame, "__fakeTimeline", { value: timeline, configurable: true });
  }
  return timeline;
};
/**
 * Creates a one-frame fake timeline for a library symbol.
 * @param symbolName Library symbol name
 * @param script Initial ActionScript for the symbol
 * @returns The constructed symbol timeline
 */
const symTimeline = (symbolName, script) => makeTimeline(symbolName, 1, [layer("L", expand([makeKeyframe(0, 1, { actionScript: script, elements: process.env.FAKE_SYM_INSTANCE ? [makeInstance("symbolInstance", 10)] : [] })]))], { name: symbolName });
/**
 * Builds a fake Animate document and its scene and library timelines.
 * @param documentName Document name
 * @param documentType Document type
 * @returns The constructed fake document
 */
const doc = (documentName, documentType) => {
  const distributeLib = { name: "dir/Hero", itemType: "movie clip" };
  const distributeElements = [makeInstance("hero", 10, distributeLib), makeInstance("", 20, distributeLib), makeInstance("hero", 30, distributeLib)];
  distributeElements[1].colorMode = "tint";
  distributeElements[1].tintColor = "#336699";
  distributeElements[1].tintPercent = 35;
  distributeElements[1].color = "#336699";
  distributeElements[1].colorTintPercent = 35;
  if (process.env.FAKE_DISTRIBUTE_BRIGHTNESS) {
    distributeElements[2].colorMode = "brightness";
    distributeElements[2].brightness = 42;
    distributeElements[2].colorBrightnessPercent = 42;
  }
  distributeElements[2].filters = [{ name: "blurFilter", blurX: 8, blurY: 6, quality: "high", enabled: false, color: "#123456", distance: 9, angle: 30, inner: true, knockout: true, hideObject: true }];
  if (process.env.FAKE_DISTRIBUTE_BAD_ELEMENT) distributeElements[0].elementType = "shape";
  if (process.env.FAKE_READONLY_COLOR_PROPERTIES) distributeElements.forEach(lockColorEffectProperties);
  const sceneFrames = process.env.FAKE_DISTRIBUTE ? [makeKeyframe(0, 5, {
    ...(process.env.FAKE_DISTRIBUTE_TWEEN ? { tweenType: process.env.FAKE_DISTRIBUTE_TWEEN } : {}),
    ...(process.env.FAKE_DISTRIBUTE_ACTIONSCRIPT ? { actionScript: "stop();" } : {}),
    ...(process.env.FAKE_DISTRIBUTE_LABEL ? { name: "label" } : {}),
    elements: distributeElements,
  })] : [
    makeKeyframe(0, 2, { actionScript: process.env.FAKE_SCRIPT ?? "stop();\\n// 日本語", elements: [makeInstance("hero", Number(process.env.FAKE_INITIAL_X ?? 0))] }),
    makeKeyframe(2, 3, { name: "end", ...(process.env.FAKE_TWEEN ? { tweenType: process.env.FAKE_TWEEN } : {}), elements: [makeInstance(process.env.FAKE_INSTANCE_CONTINUES ? "hero" : "", Number(process.env.FAKE_INITIAL_X ?? 0))] }),
  ];
  if (process.env.FAKE_FRAME_COUNT !== undefined && sceneFrames.length > 1) {
    sceneFrames[1].duration = Number(process.env.FAKE_FRAME_COUNT) - sceneFrames[0].duration;
  }
  if (process.env.FAKE_INITIAL_BRIGHTNESS !== undefined) {
    for (const frame of sceneFrames) for (const element of frame.elements || []) {
      element.colorMode = "brightness";
      element.brightness = Number(process.env.FAKE_INITIAL_BRIGHTNESS);
      element.colorBrightnessPercent = 0;
    }
  }
  if (process.env.FAKE_INSPECT_TINT) {
    sceneFrames[1].elements[0].colorMode = "tint";
    sceneFrames[1].elements[0].tintColor = "#336699";
    sceneFrames[1].elements[0].tintPercent = 35;
  }
  if (process.env.FAKE_INSPECT_FILTERS) sceneFrames[1].elements[0].filters = [{ name: "blurFilter", blurX: 8, blurY: 4, quality: "high", enabled: false, color: "#123456", distance: 9, angle: 30, inner: true, knockout: true, hideObject: true }];
  if (process.env.FAKE_INNER_KEYFRAME) sceneFrames[1].duration = 3;
  const secondFrame = makeKeyframe(0, Number(process.env.FAKE_SECOND_LENGTH ?? 5), {
    ...(process.env.FAKE_SECOND_TWEEN ? { tweenType: process.env.FAKE_SECOND_TWEEN } : {}),
    ...(process.env.FAKE_SECOND_MOTION_XML ? { motionXML: process.env.FAKE_SECOND_MOTION_XML } : {}),
  });
  const sceneLayers = [layer("a/b", expand(sceneFrames), "normal", Boolean(process.env.FAKE_LOCK_DISTRIBUTE)),
    ...(process.env.FAKE_SECOND_LAYER ? [layer(process.env.FAKE_SECOND_LAYER, expand([secondFrame]))] : []),
    layer("dir", [], "folder")];
  if (process.env.FAKE_INNER_KEYFRAME) sceneLayers[0].frames[3] = makeKeyframe(3, 1);
  if (process.env.FAKE_AS_LAYER) {
    sceneLayers.unshift(layer(process.env.FAKE_AS_LAYER, expand([makeKeyframe(0, 5)]), "normal", Boolean(process.env.FAKE_LOCK_AS)));
  }
  const sceneTimeline = makeTimeline("Scene 1", Math.max(5, ...sceneLayers.map((candidate) => candidate.frames.length)), sceneLayers);
  if (process.env.FAKE_INITIAL_CURRENT_LAYER !== undefined) sceneTimeline.currentLayer = Number(process.env.FAKE_INITIAL_CURRENT_LAYER);
  if (process.env.FAKE_INITIAL_CURRENT_FRAME !== undefined) sceneTimeline.currentFrame = Number(process.env.FAKE_INITIAL_CURRENT_FRAME);
  if (process.env.FAKE_INITIAL_SELECTED_FRAMES) sceneTimeline.selectedFrames = JSON.parse(process.env.FAKE_INITIAL_SELECTED_FRAMES);
  const document = { name: process.env.FAKE_DOCUMENT_NAME || documentName, type: documentType, asVersion: process.env.FAKE_AS_VERSION || "AS3", pathURI: process.env.FAKE_UNSAVED ? undefined : pathToFileURL(join(process.env.FAKE_DOCUMENT_DIR, documentName)).href, width: Number(process.env.FAKE_WIDTH || 550), height: Number(process.env.FAKE_HEIGHT || 400), frameRate: 24, currentTimeline: 0, timelines: [sceneTimeline],
    /** Writes a small PNG fixture for capture_frame tests. */
    exportPNG(uri, useCurrentSettings, currentFrameOnly) {
      logCapture(JSON.stringify({ uri, useCurrentSettings, currentFrameOnly, frame: this.getTimeline().currentFrame }));
      if (process.env.FAKE_EXPORT_FALSE) return false;
      if (Number(process.env.FAKE_EXPORT_FAIL_FRAME) === this.getTimeline().currentFrame + 1) return false;
      if (!process.env.FAKE_EXPORT_MISSING) writeFileSync(uri, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHqkAAAAASUVORK5CYII=", "base64"));
      return true;
    } };
  let editing = null;
  document.syms = {};
  /**
   * Returns the active library-symbol timeline or the main scene timeline.
   * @returns The currently active timeline
   */
  document.getTimeline = () => editing ? (document.syms[editing] ||= symTimeline(editing, process.env.FAKE_SYM_SCRIPT ?? "// " + editing)) : document.timelines[0];
  /** Returns elements selected on the current frame.
   * @returns Currently selected fake instances
   */
  Object.defineProperty(document, "selection", { get() {
    const timeline = document.getTimeline();
    return timeline.layers.flatMap((candidate) => candidate.frames[timeline.currentFrame]?.elements || []).filter((element) => element.selected);
  } });
  if (process.env.FAKE_INITIAL_SELECTED_ELEMENT) {
    const timeline = document.getTimeline();
    timeline.layers[0].frames[timeline.currentFrame].elements[0].selected = true;
  }
  /** Clears selection on every instance in the active timeline.
   * @returns Nothing
   */
  document.selectNone = () => {
    for (const candidate of document.getTimeline().layers) for (const frame of new Set(candidate.frames)) for (const element of frame.elements || []) element.selected = false;
  };
  /** Simulates native distribution or Animate's unavailable call.
   * @returns Nothing
   */
  document.distributeToLayers = () => {
    if (!process.env.FAKE_NATIVE_DISTRIBUTE) throw new Error("currently unavailable");
    const timeline = document.getTimeline();
    const sourceLayer = timeline.layers[timeline.currentLayer];
    const frame = sourceLayer.frames[timeline.currentFrame];
    const elements = frame.elements.slice();
    if (process.env.FAKE_NATIVE_DISTRIBUTE_PARTIAL_FAILURE) {
      frame.elements.shift();
      const index = timeline.addNewLayer("Native partial", "normal", true);
      timeline.layers[index].frames[frame.startFrame].elements.push(elements[0]);
      throw new Error("fake native distribution failure after partial mutation");
    }
    if (process.env.FAKE_NATIVE_DISTRIBUTE_BAD_COUNT) {
      frame.elements = [];
      const index = timeline.addNewLayer("Native validation", "normal", true);
      timeline.layers[index].frames[frame.startFrame].elements.push(...elements);
      return;
    }
    frame.elements = [];
    for (const element of elements) {
      const index = timeline.addNewLayer("Native", "normal", true);
      timeline.layers[index].frames[frame.startFrame].elements.push(element);
    }
  };
  /** Selects all instances on the current frame.
   * @returns Nothing
   */
  document.selectAll = () => {
    for (const candidate of document.getTimeline().layers) for (const element of candidate.frames[document.getTimeline().currentFrame]?.elements || []) element.selected = true;
  };
  /** Moves selected instances by a delta.
   * @param delta Position offset
   * @returns Nothing
   */
  document.moveSelectionBy = (delta) => { for (const element of document.selection) { element.x += delta.x; element.y += delta.y; } };
  /** Scales selected instances by factors.
   * @param scaleX Horizontal scale factor
   * @param scaleY Vertical scale factor
   * @returns Nothing
   */
  document.scaleSelection = (scaleX, scaleY, whichCorner) => {
    if (whichCorner !== undefined && typeof whichCorner !== "string") throw new Error("invalid scaleSelection reference point");
    for (const element of document.selection) { element.scaleX *= scaleX; element.scaleY *= scaleY; }
  };
  /** Rotates selected instances by degrees.
   * @param angle Rotation delta
   * @returns Nothing
   */
  document.rotateSelection = (angle, rotationPoint) => {
    if (rotationPoint !== undefined && typeof rotationPoint !== "string") throw new Error("invalid rotateSelection reference point");
    for (const element of document.selection) element.rotation += angle;
  };
  /** Sets alpha on selected instances.
   * @param alpha Alpha percentage
   * @returns Nothing
   */
  document.setInstanceAlpha = (alpha) => { for (const element of document.selection) { element.colorMode = "alpha"; element.colorAlphaPercent = alpha; } };
  /** Sets brightness on selected instances.
   * @param brightness Brightness percentage
   * @returns Nothing
   */
  document.setInstanceBrightness = (brightness) => { for (const element of document.selection) {
    element.colorMode = "brightness";
    element.colorBrightnessPercent = brightness;
    if (Object.prototype.hasOwnProperty.call(element, "__fakeBrightness")) element.__fakeBrightness = brightness;
    else element.brightness = brightness;
  } };
  /** Sets tint on selected instances.
   * @param color Hex color
   * @param amount Tint percentage
   * @returns Nothing
   */
  document.setInstanceTint = (color, amount) => { for (const element of document.selection) {
    element.colorMode = "tint";
    element.color = color;
    element.colorTintPercent = amount;
    if (Object.prototype.hasOwnProperty.call(element, "__fakeTintColor")) element.__fakeTintColor = color;
    else element.tintColor = color;
    if (Object.prototype.hasOwnProperty.call(element, "__fakeTintPercent")) element.__fakeTintPercent = amount;
    else element.tintPercent = amount;
  } };
  /** Adds a fake filter to selected instances.
   * @param name Animate filter name
   * @returns Nothing
   */
  document.addFilter = (name) => {
    for (const element of document.selection) {
      if (!element.filters.some((filter) => filter.name === name)) element.filters.push({ name, blurX: 4, blurY: 4, color: name === "glowFilter" ? "#FF0000" : "#000000", quality: "low", inner: false, knockout: false, hideObject: false, strength: 100, distance: 4, angle: 45 });
    }
  };
  /** Exits library-item editing mode. */
  document.exitEditMode = () => { editing = null; };
  /** Provides the scene-editing stub required by the fake Animate API. */
  document.editScene = () => {};
  const libraryItems = [
    { name: "F", itemType: "folder" },
    { name: "dir", itemType: "folder" },
    { name: "dir/Hero", itemType: "movie clip", linkageExportForAS: true, linkageClassName: "com.Hero", linkageBaseClass: "flash.display.MovieClip", linkageExportInFirstFrame: false },
    { name: "dir/Bitmap", itemType: "bitmap" },
    { name: "Bitmap", itemType: "bitmap" },
    { name: "Sound", itemType: "sound" },
    { name: "Font", itemType: "font" },
    ...Array.from({ length: Number(process.env.FAKE_EXTRA ?? 0) }, (_, index) => ({ name: "S" + index, itemType: "graphic" })),
    { name: "Broken", itemType: "button" },
  ];
  const linkageWrites = [];
  for (const item of libraryItems) {
    const values = {};
    for (const property of ["linkageExportForAS", "linkageClassName", "linkageBaseClass", "linkageExportInFirstFrame"]) {
      values[property] = item[property];
      Object.defineProperty(item, property, {
        enumerable: true,
        configurable: true,
        get() { return values[property]; },
        set(value) {
          linkageWrites.push({ item: item.name, property, value });
          if (property === "linkageExportInFirstFrame" && !item.linkageExportForAS) throw new Error("invalid argument");
          values[property] = value;
        },
      });
    }
  }
  let selectedLibraryItems = (process.env.FAKE_SELECTED_LIBRARY_ITEMS ?? "").split(",").filter(Boolean)
    .map((name) => libraryItems.find((item) => item.name === name)).filter(Boolean);
  const logLibrarySelection = () => process.env.FAKE_LOG && appendFileSync(
    process.env.FAKE_LOG + ".library-selection",
    JSON.stringify(selectedLibraryItems.map((item) => item.name)) + "\\n",
  );
  let addedItemCount = 0;
  const library = {
    items: libraryItems,
    linkageWrites,
    /** Returns the selected Library items.
     * @returns Selected items.
     */
    getSelectedItems() { return selectedLibraryItems.slice(); },
    /** Reads a linkage property from the selected Library item.
     * @param property Linkage property name.
     * @returns The selected item's value, or undefined when its AS export is disabled.
     */
    getItemProperty(property) {
      if (selectedLibraryItems.length !== 1) throw new Error("one library item must be selected");
      if (!["linkageExportForAS", "linkageClassName", "linkageBaseClass", "linkageExportInFirstFrame"].includes(property)) {
        throw new Error("invalid argument");
      }
      const item = selectedLibraryItems[0];
      if (property !== "linkageExportForAS" && !item.linkageExportForAS) return undefined;
      return item[property];
    },
    /** Writes the linkage property supported by Animate's Library API.
     * @param property Linkage property name.
     * @param value New value.
     * @returns Nothing.
     */
    setItemProperty(property, value) {
      if (selectedLibraryItems.length !== 1 || property !== "linkageExportForAS") throw new Error("invalid argument");
      const item = selectedLibraryItems[0];
      item[property] = value;
      if (value) item.linkageClassName = item.name;
    },
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
    /** Adds a library item to the current timeline frame.
     * @param path Library item path
     * @param position Initial stage position
     * @returns Nothing
     */
    addItemToDocument(position, path) {
      addedItemCount++;
      if (process.env.FAKE_FAIL_ADD_ITEM_AFTER && addedItemCount > Number(process.env.FAKE_FAIL_ADD_ITEM_AFTER)) {
        throw new Error("fake addItemToDocument failure");
      }
      const item = libraryItems.find((candidate) => candidate.name === path);
      if (!item) throw new Error("library item not found");
      const timeline = document.getTimeline();
      const currentLayer = timeline.layers[timeline.currentLayer];
      const frame = currentLayer.frames[timeline.currentFrame];
      if (!frame || currentLayer.locked) throw new Error("cannot add to layer");
      const offset = Number(process.env.FAKE_ADD_ITEM_OFFSET || 0);
      const instance = makeInstance("", position.x + offset, item);
      instance.y = position.y - offset;
      instance.matrix.tx = instance.x;
      instance.matrix.ty = instance.y;
      if (process.env.FAKE_READONLY_COLOR_PROPERTIES) lockColorEffectProperties(instance);
      frame.elements.push(instance);
    },
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
      selectedLibraryItems = [];
      logLibrarySelection();
    },
    /** Selects the library item at a path.
     * @param path Library item path.
     * @returns Nothing.
     */
    selectItem(path, replaceCurrentSelection = true) {
      const item = libraryItems.find((candidate) => candidate.name === path);
      if (!item) throw new Error("library item not found");
      if (replaceCurrentSelection) selectedLibraryItems = [];
      if (!selectedLibraryItems.includes(item)) selectedLibraryItems.push(item);
      logLibrarySelection();
    },
    /** Renames the selected library item.
     * @param name New basename.
     * @returns Nothing.
     */
    renameItem(name) {
      if (!selectedLibraryItems[0]) {
        throw new Error("nothing selected");
      }
      const oldPath = selectedLibraryItems[0].name;
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
let activeDocument = null;
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
if (process.env.FAKE_LINKAGE_CONFLICT && src.includes("var __newScripts")) {
  const hero = docs[0].library.items.find((item) => item.name === "dir/Hero");
  if (process.env.FAKE_LINKAGE_CONFLICT === "class") hero.linkageClassName = "com.RenamedHero";
  else if (process.env.FAKE_LINKAGE_CONFLICT === "disabled") hero.linkageExportForAS = false;
}
if (!src.includes("HANG")) runInNewContext(src, {
  FLfile: {
    /**
     * Converts a platform path to its fake URI representation.
     * @param path Path to convert
     * @returns The unchanged path
     */
    platformPathToURI: (path) => path,
    createFolder: (path) => { mkdirSync(path, { recursive: true }); return true; },
    exists: (path) => existsSync(path),
    read: (path) => readFileSync(path, "utf8"),
    remove: (path) => { if (existsSync(path)) { unlinkSync(path); if (src.includes("var __readOutputPath")) logReadOutput(path.endsWith("-output.txt") ? "outputPanel.remove" : "compilerErrors.remove"); else logPublish("remove"); } },
    /** Converts the fake document's file URI to its platform path.
     * @param uri Document URI
     * @returns The corresponding platform path
     */
    uriToPlatformPath: (uri) => fileURLToPath(uri),
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
    setActiveWindow: (document) => { logPublish("activate"); activeDocument = document; },
    publishDocument: () => { logPublish("publish"); return !process.env.FAKE_PUBLISH_FALSE; },
    outputPanel: {
      save: (path) => { logReadOutput("outputPanel.save"); writeFileSync(path, process.env.FAKE_OUTPUT_PANEL ?? ""); },
    },
    compilerErrors: {
      save: (path) => {
        if (src.includes("var __readOutputPath")) {
          logReadOutput("compilerErrors.save");
          if (process.env.FAKE_COMPILER_PANEL_ERROR || process.env.FAKE_TYPE === "htmlcanvas") throw new Error("compiler panel unavailable");
          writeFileSync(path, process.env.FAKE_COMPILER_PANEL ?? "");
          return;
        }
        logPublish("compilerErrors.save");
        if (process.env.FAKE_TYPE === "htmlcanvas") throw new Error("not supported on HTML5 Canvas");
        const outputs = process.env.FAKE_COMPILER_OUTPUTS && JSON.parse(process.env.FAKE_COMPILER_OUTPUTS);
        const outputIndex = process.env.FAKE_LOG
          ? readFileSync(process.env.FAKE_LOG + ".publish", "utf8").split("\\n").filter((line) => line === "compilerErrors.save").length - 1
          : 0;
        writeFileSync(path, outputs ? outputs[outputIndex] ?? "" : process.env.FAKE_COMPILER_OUTPUT || "0 個のエラー, 0 個の警告");
      },
    },
    /**
     * Returns the first open fake document, or null when no document is open.
     * @returns The active document or null
     */
      getDocumentDOM: () => activeDocument || docs[0] || null,
  },
});
if (process.env.FAKE_LOG && docs[0] && docs[0].library.linkageWrites.length) {
  appendFileSync(process.env.FAKE_LOG + ".linkage-writes", JSON.stringify(docs[0].library.linkageWrites) + "\\n");
}
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
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".layers", JSON.stringify(docs[0].timelines[0].layers.map((candidate) => ({ name: candidate.name, type: candidate.layerType, parent: candidate.parentLayer?.name, locked: candidate.locked, writeWasUnlocked: candidate.writeWasUnlocked, frames: candidate.frames.map((frame, index) => frame.startFrame === index ? { start: frame.startFrame, duration: frame.duration, script: frame.actionScript, tween: frame.tweenType, tweenEasing: frame.tweenEasing, hasCustomEase: frame.hasCustomEase, useSingleEaseCurve: frame.useSingleEaseCurve, customEases: frame.customEases, label: frame.name, motionXML: frame.motionXML, elements: frame.elements.map((element) => ({ name: element.name, x: element.x, y: element.y, matrix: element.matrix, transformationPoint: element.getTransformationPoint(), scaleX: element.scaleX, scaleY: element.scaleY, rotation: element.rotation, colorMode: element.colorMode, colorAlphaPercent: element.colorAlphaPercent, colorAlphaAmount: element.colorAlphaAmount, brightness: element.brightness, tintColor: element.tintColor, tintPercent: element.tintPercent, colorBrightnessPercent: element.colorBrightnessPercent, color: element.color, colorTintPercent: element.colorTintPercent, colorRedPercent: element.colorRedPercent, colorGreenPercent: element.colorGreenPercent, colorBluePercent: element.colorBluePercent, colorRedAmount: element.colorRedAmount, colorGreenAmount: element.colorGreenAmount, colorBlueAmount: element.colorBlueAmount, blendMode: element.blendMode, visible: element.visible, cacheAsBitmap: element.cacheAsBitmap, loop: element.loop, firstFrame: element.firstFrame, lastFrame: element.lastFrame, trackAsMenu: element.trackAsMenu, filters: element.filters })) } : null).filter(Boolean) }))) + "\\n");
process.env.FAKE_LOG && docs[0] && appendFileSync(process.env.FAKE_LOG + ".state", JSON.stringify({ currentLayer: docs[0].timelines[0].currentLayer, currentFrame: docs[0].timelines[0].currentFrame, selectedFrames: docs[0].timelines[0].selectedFrames, selectedElements: docs[0].timelines[0].layers.flatMap((candidate) => candidate.frames[docs[0].timelines[0].currentFrame]?.elements || []).filter((element) => element.selected).length }) + "\\n");
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
            FAKE_DOCUMENT_DIR: join(tempDir, "document"),
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
/** Reads the fake runtime's final timeline selection state. */
export const stateLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.state"), "utf8"))
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

/**
 * Calls the edit_tween MCP tool with the supplied operations.
 * @param client Connected MCP client
 * @param timeline Timeline index or library item name
 * @param ops Tween operations to apply
 * @returns The MCP tool call promise
 */
export const editTween = (client: Client, timeline: number | string, ops: unknown[]) =>
    client.callTool({ name: "edit_tween", arguments: { timeline, ops } });

export const SCENE_FILE = "scenes/Scene 1/a_b/1.as";
