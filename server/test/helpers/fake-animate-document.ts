import { libraryRuntime } from "./fake-animate-library.js";

export const documentRuntime = `/**
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
  if (process.env.FAKE_AUDIT_FIXTURES) {
    sceneFrames[0].soundLibraryItem = { name: "Sound", itemType: "sound" };
    sceneFrames[0].elements.push(makeInstance("nested-symbol", 1, { name: "Folder/Symbol 3", itemType: "graphic" }));
  }
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
    ...(process.env.FAKE_AUDIT_FIXTURES ? [layer("Layer 1", expand([makeKeyframe(0, 5)]))] : []),
    ...(process.env.FAKE_AUDIT_FIXTURES ? [layer("レイヤー 2", expand([makeKeyframe(0, 5, { elements: [makeInstance("occupied", 1)] })]))] : []),
    layer("dir", [], "folder")];
  if (process.env.FAKE_AUDIT_FIXTURES) {
    const audioOnlyLayer = layer("Audio only", expand([makeKeyframe(0, 1)]));
    audioOnlyLayer.frames[0].soundLibraryItem = { name: "Sound", itemType: "sound" };
    sceneLayers.push(audioOnlyLayer);
  }
  if (process.env.FAKE_INNER_KEYFRAME) sceneLayers[0].frames[3] = makeKeyframe(3, 1);
  if (process.env.FAKE_AS_LAYER) {
    sceneLayers.unshift(layer(process.env.FAKE_AS_LAYER, expand([makeKeyframe(0, 5)]), "normal", Boolean(process.env.FAKE_LOCK_AS)));
  }
  const sceneTimeline = makeTimeline("Scene 1", Math.max(5, ...sceneLayers.map((candidate) => candidate.frames.length)), sceneLayers);
  if (process.env.FAKE_INITIAL_CURRENT_LAYER !== undefined) sceneTimeline.currentLayer = Number(process.env.FAKE_INITIAL_CURRENT_LAYER);
  if (process.env.FAKE_INITIAL_CURRENT_FRAME !== undefined) sceneTimeline.currentFrame = Number(process.env.FAKE_INITIAL_CURRENT_FRAME);
  if (process.env.FAKE_INITIAL_SELECTED_FRAMES) sceneTimeline.selectedFrames = JSON.parse(process.env.FAKE_INITIAL_SELECTED_FRAMES);
  const document = { name: process.env.FAKE_DOCUMENT_NAME || documentName, type: documentType, asVersion: process.env.FAKE_AS_VERSION || "AS3", pathURI: process.env.FAKE_UNSAVED ? undefined : (process.env.FAKE_VOLUME_URI ? pathToFileURL(join(process.env.FAKE_DOCUMENT_DIR, documentName)).href.replace("file:///", "file:///Macintosh%20HD/") : pathToFileURL(join(process.env.FAKE_DOCUMENT_DIR, documentName)).href), width: Number(process.env.FAKE_WIDTH || 550), height: Number(process.env.FAKE_HEIGHT || 400), frameRate: 24, backgroundColor: "#FFFFFF", currentTimeline: 0, timelines: [sceneTimeline],
    /**
     * Simulates Test Movie while preserving the Output panel for the next Run.
     * @param abortOnErrors Whether compilation errors should prevent launching the player
     * @returns Nothing
     */
    testMovie(abortOnErrors) {
      if (abortOnErrors !== true) throw new Error("Test Movie must abort on compiler errors");
      const compileError = Boolean(process.env.FAKE_TEST_MOVIE_COMPILE_ERROR);
      logTestMovie(JSON.stringify({ document: this.name, abortOnErrors, playerOpened: !compileError }));
      const outputPath = process.env.FAKE_LOG + ".output-panel";
      const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : process.env.FAKE_OUTPUT_PANEL ?? "";
      const runtimeOutput = compileError ? "" : process.env.FAKE_TEST_MOVIE_OUTPUT ?? "";
      writeFileSync(outputPath, output + (output && runtimeOutput ? "\\n" : "") + runtimeOutput);
    },
    /**
     * Writes a small PNG fixture for capture_frame tests.
     * @param uri Destination file URI
     * @param useCurrentSettings Whether to use current export settings
     * @param currentFrameOnly Whether to capture only the current frame
     * @returns Whether the fake export succeeded
     */
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
${libraryRuntime}const docs = process.env.FAKE_NO_DOC ? [] : [doc("a.fla", process.env.FAKE_TYPE || "Flash")].concat(process.env.FAKE_TWO ? [doc("b.fla", "Flash")] : []);
const activeDocumentPath = process.env.FAKE_LOG + ".active-document";
let activeDocument = existsSync(activeDocumentPath)
  ? docs.find((document) => document.name === readFileSync(activeDocumentPath, "utf8")) || null
  : null;
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
     uriToPlatformPath: (uri) => fileURLToPath(process.env.FAKE_VOLUME_URI ? uri.replace("file:///Macintosh%20HD/", "file:///") : uri),
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
    setActiveWindow: (document) => {
      logPublish("activate");
      writeFileSync(activeDocumentPath, document.name);
    },
    publishDocument: () => { logPublish("publish"); return !process.env.FAKE_PUBLISH_FALSE; },
    outputPanel: {
      save: (path) => { logReadOutput("outputPanel.save"); const outputPath = process.env.FAKE_LOG + ".output-panel"; writeFileSync(path, existsSync(outputPath) ? readFileSync(outputPath, "utf8") : process.env.FAKE_OUTPUT_PANEL ?? ""); },
    },
    compilerErrors: {
      save: (path) => {
        if (src.includes("var __readOutputPath")) {
          logReadOutput("compilerErrors.save");
          if (process.env.FAKE_COMPILER_PANEL_ERROR || process.env.FAKE_TYPE === "htmlcanvas") throw new Error("compiler panel unavailable");
          const panels = process.env.FAKE_COMPILER_PANELS && JSON.parse(process.env.FAKE_COMPILER_PANELS);
          writeFileSync(path, panels ? panels[(activeDocument || docs[0])?.name] ?? "" : process.env.FAKE_COMPILER_PANEL ?? "");
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
