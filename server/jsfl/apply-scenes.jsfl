// Concatenated and evaluated after export-common and edit-state. `var __docName`, `var __edits`
// ([{file, scene, layer, start, expected, script, item?}]) and `var __newScripts`
// ([{file, scene, layer, start, script, item?, layerDir, asLayer}]) and `var __fingerprints`
// ([{scene, item?, structureFingerprint}]) are injected before it.
// A frame changed in Animate since Export is not written and goes to failed (if it already equals script it counts as applied).
// An empty script deletes the frame script. New scripts are applied after existing-file edits.
// Symbols are edited in edit mode, so the original edit state is restored at the end (warning if it cannot be).
/** Applies exported script edits and returns the results as JSON text.
 * @returns The serialized edit results.
 */
(function () {
  var document = selectDocument(), applied = [], failed = [], warnings = [], newApplied = [], editingItemName = "";
  var createdAsTimelines = {}, fingerprintMismatch = {}, restore = saveEditState(document);

  /** Returns the requested scene or library-item timeline.
   * @param edit The edit identifying the target timeline.
   * @returns The target timeline.
   */
  function getTimeline(edit) {
    if (edit.item !== undefined) {
      if (editingItemName !== edit.item) {
        document.library.editItem(edit.item);
        editingItemName = edit.item;
      }
      return document.getTimeline();
    }
    return document.timelines[edit.scene];
  }

  /** Identifies a timeline for per-Run layer-index tracking.
   * @param edit The edit identifying the target timeline.
   * @returns The timeline key.
   */
  function timelineKey(edit) {
    return edit.item !== undefined ? "item:" + edit.item : "scene:" + edit.scene;
  }

  /** Returns the timeline's frame count, using its longest layer on older Animate versions.
   * @param timeline The timeline to measure.
   * @returns The timeline frame count.
   */
  function timelineLength(timeline) {
    if (typeof timeline.frameCount === "number") {
      return timeline.frameCount;
    }
    var length = 0;
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      if (timeline.layers[layerIndex].frames.length > length) {
        length = timeline.layers[layerIndex].frames.length;
      }
    }
    return length;
  }

  /** Finds the exported fingerprint for a scene or library timeline.
   * @param edit The edit identifying the target timeline.
   * @returns The exported structure fingerprint, or an empty string when none exists.
   */
  function expectedFingerprint(edit) {
    for (var fingerprintIndex = 0; fingerprintIndex < __fingerprints.length; fingerprintIndex++) {
      var fingerprint = __fingerprints[fingerprintIndex];
      if (fingerprint.scene === edit.scene && fingerprint.item === edit.item) return fingerprint.structureFingerprint;
    }
    return "";
  }

  /** Refuses edits when the timeline structure no longer matches Export.
   * @param edit The edit identifying the target timeline.
   * @returns Whether the timeline structure differs from the exported structure.
   */
  function structureChanged(edit) {
    var key = timelineKey(edit), expected = expectedFingerprint(edit);
    if (!expected) return false;
    if (fingerprintMismatch[key] !== undefined) return fingerprintMismatch[key];
    fingerprintMismatch[key] = structureFingerprint(getTimeline(edit)) !== expected;
    return fingerprintMismatch[key];
  }

  for (var editIndex = 0; editIndex < __edits.length; editIndex++) {
    var edit = __edits[editIndex];
    try {
      if (structureChanged(edit)) throw new Error("Structure changed since Export; export again");
      var timeline = getTimeline(edit);
      var frame = timeline && timeline.layers[edit.layer] && timeline.layers[edit.layer].frames[edit.start];
      if (!frame || frame.startFrame !== edit.start) {
        throw new Error("Frame no longer exists");
      }
      var currentScript = frame.actionScript || "";
      if (currentScript !== edit.expected && currentScript !== edit.script) {
        throw new Error("Changed in Animate since Export");
      }
      frame.actionScript = edit.script;
      applied.push(edit.file);
    } catch (error) {
      failed.push({ file: edit.file, error: String(error && error.message ? error.message : error) });
    }
  }

  for (var newIndex = 0; newIndex < __newScripts.length; newIndex++) {
    var newScript = __newScripts[newIndex];
    var originalLayerLock = false, targetLayer = null;
    try {
      var newTimeline = getTimeline(newScript), key = timelineKey(newScript), targetLayerIndex = -1;
      if (structureChanged(newScript)) throw new Error("Structure changed since Export; export again");
      if (newScript.start >= timelineLength(newTimeline)) {
        throw new Error("Frame beyond timeline length");
      }
      if (newScript.asLayer) {
        for (var asIndex = 0; asIndex < newTimeline.layers.length; asIndex++) {
          if (String(newTimeline.layers[asIndex].name || "").toLowerCase() === "as") {
            targetLayerIndex = asIndex;
            break;
          }
        }
        if (targetLayerIndex < 0) {
          newTimeline.currentLayer = 0;
          newTimeline.addNewLayer("as", "normal", true);
          for (var createdIndex = 0; createdIndex < newTimeline.layers.length; createdIndex++) {
            if (String(newTimeline.layers[createdIndex].name || "").toLowerCase() === "as") {
              targetLayerIndex = createdIndex;
              break;
            }
          }
          if (targetLayerIndex < 0) {
            throw new Error("Could not create the as layer");
          }
          createdAsTimelines[key] = true;
          warnings.push('Created layer "as" in ' + (newTimeline.name || newScript.item || "timeline"));
        }
      } else {
        targetLayerIndex = newScript.layer + (createdAsTimelines[key] ? 1 : 0);
      }
      targetLayer = newTimeline.layers[targetLayerIndex];
      if (!targetLayer) {
        throw new Error("Layer no longer exists");
      }
      originalLayerLock = targetLayer.locked;
      if (originalLayerLock) {
        targetLayer.locked = false;
      }
      var insertedKeyframe = false, targetFrame;
      try {
        targetFrame = targetLayer.frames[newScript.start];
        if (!targetFrame) {
          newTimeline.currentLayer = targetLayerIndex;
          newTimeline.currentFrame = newScript.start;
          newTimeline.insertKeyframe(newScript.start);
          targetFrame = targetLayer.frames[newScript.start];
          if (!targetFrame || targetFrame.startFrame !== newScript.start) {
            throw new Error("Frame no longer exists");
          }
          insertedKeyframe = true;
        } else if (targetFrame.startFrame === newScript.start) {
          if ((targetFrame.actionScript || "") !== "") {
            throw new Error("Changed in Animate since Export");
          }
        } else {
          var spanStart = targetFrame.startFrame, span = targetLayer.frames[spanStart];
          if (!span || (span.tweenType || "none") !== "none") {
            throw new Error("Frame is inside a tween");
          }
          newTimeline.currentLayer = targetLayerIndex;
          newTimeline.currentFrame = newScript.start;
          newTimeline.insertKeyframe(newScript.start);
          targetFrame = targetLayer.frames[newScript.start];
          if (!targetFrame || targetFrame.startFrame !== newScript.start) {
            throw new Error("Frame no longer exists");
          }
          insertedKeyframe = true;
        }
        targetFrame.actionScript = newScript.script;
      } finally {
        if (originalLayerLock) {
          targetLayer.locked = true;
        }
      }
      applied.push(newScript.file);
      var appliedNewScript = {
        file: newScript.file,
        scene: newScript.scene,
        layer: targetLayerIndex,
        start: newScript.start,
        script: newScript.script,
        layerDir: newScript.layerDir,
        layerName: targetLayer.name,
        asLayer: newScript.asLayer
      };
      if (newScript.item !== undefined) {
        appliedNewScript.item = newScript.item;
      }
      newApplied.push(appliedNewScript);
      if (insertedKeyframe) {
        warnings.push(
          "Inserted keyframe at frame " +
            (newScript.start + 1) +
            " in " +
            targetLayer.name +
            " of " +
            (newTimeline.name || newScript.item || "timeline")
        );
      }
    } catch (error) {
      failed.push({ file: newScript.file, error: String(error && error.message ? error.message : error) });
    }
  }

  var updatedFingerprints = [], fingerprintedTimelines = {};
  for (var appliedIndex = 0; appliedIndex < newApplied.length; appliedIndex++) {
    var appliedScript = newApplied[appliedIndex], appliedKey = timelineKey(appliedScript);
    if (fingerprintedTimelines[appliedKey]) continue;
    var appliedTimeline = getTimeline(appliedScript), updatedFingerprint = {
      scene: appliedScript.scene,
      structureFingerprint: structureFingerprint(appliedTimeline)
    };
    if (appliedScript.item !== undefined) updatedFingerprint.item = appliedScript.item;
    updatedFingerprints.push(updatedFingerprint);
    fingerprintedTimelines[appliedKey] = true;
  }
  var warning = editingItemName ? restore() : "";
  return serialize({ applied: applied, failed: failed, warning: warning, warnings: warnings, newApplied: newApplied, fingerprints: updatedFingerprints });
})();
