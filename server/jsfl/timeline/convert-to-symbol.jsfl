// `var __docName`, `var __timelineRef`, and `var __request` are injected before this file.
/** Converts selected timeline elements into a Library symbol.
 * @returns The serialized conversion result.
 */
(function () {
  var document = selectDocument();
  var originalTimeline = document.getTimeline();
  var originalLayer = originalTimeline.layers[originalTimeline.currentLayer];
  var originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelection = document.selection ? document.selection.slice() : [];
  var timeline = null, targetLayer = null, targetFrame = null;
  var targetSelection = [], resolved = [], lockedLayers = [], lockStates = [];
  var frameIndex = __request.frame - 1;
  var allowedTypes = ["movie clip", "button", "graphic"];
  var registrationPoints = ["top left", "top center", "top right", "center left", "center", "center right", "bottom left", "bottom center", "bottom right"];

  /** Resolves a layer by its zero-based index or unique name.
   * @param reference Layer index or name.
   * @returns The matching zero-based layer index.
   */
  function resolveLayer(reference) {
    if (typeof reference === "number") {
      if (Math.floor(reference) !== reference || reference < 0 || reference >= timeline.layers.length) {
        throw new Error("Layer index not found: " + reference);
      }
      return reference;
    }
    var found = -1, matches = 0;
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      if (timeline.layers[layerIndex].name === reference) {
        found = layerIndex;
        matches++;
      }
    }
    if (matches === 0) throw new Error("Layer not found: " + reference);
    if (matches > 1) throw new Error("Layer name is ambiguous: " + reference);
    return found;
  }

  /** Resolves an element by its index or unique name.
   * @param elements Elements on the target frame.
   * @param reference Element index or name.
   * @returns The matching element index.
   */
  function resolveElement(elements, reference) {
    if (typeof reference === "number") {
      if (Math.floor(reference) !== reference || reference < 0 || reference >= elements.length) {
        throw new Error("Element index not found: " + reference);
      }
      return reference;
    }
    var found = -1, matches = 0;
    for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
      if (elements[elementIndex].name === reference) {
        found = elementIndex;
        matches++;
      }
    }
    if (matches === 0) throw new Error("Element not found: " + reference);
    if (matches > 1) throw new Error("Element name is ambiguous: " + reference);
    return found;
  }

  /** Checks whether an element still belongs to any frame in a timeline.
   * @param targetTimeline Timeline to search.
   * @param element Element reference to find.
   * @returns Whether the timeline contains the element.
   */
  function containsElement(targetTimeline, element) {
    for (var layerIndex = 0; layerIndex < targetTimeline.layers.length; layerIndex++) {
      var frames = targetTimeline.layers[layerIndex].frames;
      for (var frameNumber = 0; frameNumber < frames.length; frameNumber++) {
        var elements = frames[frameNumber] && frames[frameNumber].elements || [];
        for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
          if (elements[elementIndex] === element) return true;
        }
      }
    }
    return false;
  }

  /** Restores only selected elements that still exist in the timeline.
   * @param targetTimeline Timeline containing the selection.
   * @param selection Element references to restore.
   * @returns Nothing.
   */
  function restoreSelection(targetTimeline, selection) {
    // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
    if (document.selectNone) document.selectNone();
    for (var index = 0; index < selection.length; index++) {
      if (containsElement(targetTimeline, selection[index])) selection[index].selected = true;
    }
  }

  /** Restores the saved layer, frame, selected frames, and surviving elements.
   * @param targetTimeline Timeline whose state is restored.
   * @param layer Original layer object.
   * @param frame Original zero-based current frame.
   * @param selectedFrames Original selected-frame range.
   * @param selection Original selected elements.
   * @returns Nothing.
   */
  function restoreTimelineState(targetTimeline, layer, frame, selectedFrames, selection) {
    if (selectedFrames && targetTimeline.setSelectedFrames) targetTimeline.setSelectedFrames(selectedFrames);
    var layerIndex = -1;
    for (var index = 0; index < targetTimeline.layers.length; index++) {
      if (targetTimeline.layers[index] === layer) layerIndex = index;
    }
    if (layerIndex >= 0) targetTimeline.currentLayer = layerIndex;
    targetTimeline.currentFrame = frame;
    restoreSelection(targetTimeline, selection);
  }

  /** Writes a state-restoration failure to Animate's trace output.
   * @param label Context for the failed restoration.
   * @param error Error thrown while restoring state.
   * @returns Nothing.
   */
  function traceRestoreError(label, error) {
    fl.trace(label + ": " + String(error && error.message ? error.message : error));
  }

  try {
    if (!__request || Math.floor(__request.frame) !== __request.frame || __request.frame < 1) {
      throw new Error("frame must be a positive 1-based integer");
    }
    if (allowedTypes.indexOf(__request.type) < 0) throw new Error("Unsupported symbol type: " + __request.type);
    if (!__request.name || __request.name.indexOf("/") >= 0) throw new Error("name must be a plain Library name without a folder path");
    if (!__request.elements || !__request.elements.length) throw new Error("elements must contain at least one reference");
    if (registrationPoints.indexOf(__request.registrationPoint) < 0) {
      throw new Error("Unsupported registration point: " + __request.registrationPoint);
    }
    for (var libraryIndex = 0; libraryIndex < document.library.items.length; libraryIndex++) {
      if (document.library.items[libraryIndex].name === __request.name) {
        throw new Error("Library item already exists: " + __request.name);
      }
    }

    var session = withTimelineEdit(document, __timelineRef, /** Converts the requested elements in the target timeline.
     * @param targetTimeline Timeline selected for the operation.
     * @returns The serialized conversion result.
     */
    function (targetTimeline) {
    timeline = targetTimeline;
    targetLayer = timeline.layers[timeline.currentLayer];
    targetFrame = timeline.currentFrame;
    targetSelection = document.selection ? document.selection.slice() : [];

    try {
    for (var requestIndex = 0; requestIndex < __request.elements.length; requestIndex++) {
      var reference = __request.elements[requestIndex];
      var layerIndex = resolveLayer(reference.layer), layer = timeline.layers[layerIndex];
      if (layer.layerType === "folder") throw new Error("Cannot convert an element on a folder layer: " + layer.name);
      if (frameIndex >= layer.frames.length || !layer.frames[frameIndex]) throw new Error("Frame not found: " + __request.frame);
      var frame = layer.frames[frameIndex], span = layer.frames[frame.startFrame];
      if (frameIndex !== frame.startFrame && span && (span.tweenType || "none") !== "none") {
        throw new Error("Cannot convert elements inside a tween span");
      }
      var elements = frame.elements || [], elementIndex = resolveElement(elements, reference.element);
      var element = elements[elementIndex];
      if (["shape", "group", "text", "instance"].indexOf(element.elementType) < 0) {
        throw new Error("Unsupported element type: " + element.elementType);
      }
      for (var resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex++) {
        if (resolved[resolvedIndex].element === element) throw new Error("An element may only be referenced once");
      }
      resolved.push({ layer: layer, layerIndex: layerIndex, element: element });
      var alreadyLocked = false;
      for (var lockIndex = 0; lockIndex < lockedLayers.length; lockIndex++) {
        if (lockedLayers[lockIndex] === layer) alreadyLocked = true;
      }
      if (!alreadyLocked) lockedLayers.push(layer);
    }

    for (var unlockIndex = 0; unlockIndex < lockedLayers.length; unlockIndex++) {
      lockStates.push({ layer: lockedLayers[unlockIndex], locked: lockedLayers[unlockIndex].locked });
    }
    try {
      for (unlockIndex = 0; unlockIndex < lockStates.length; unlockIndex++) {
        if (lockStates[unlockIndex].locked) lockStates[unlockIndex].layer.locked = false;
      }
    timeline.currentFrame = frameIndex;
    timeline.currentLayer = resolved[0].layerIndex;
    // Clear before selecting only the elements to convert (see docs/animate-quirks.md).
    if (document.selectNone) document.selectNone();
    for (var selectIndex = 0; selectIndex < resolved.length; selectIndex++) resolved[selectIndex].element.selected = true;
    var created = document.convertToSymbol(__request.type, __request.name, __request.registrationPoint);
    if (!created) throw new Error("Animate could not convert the selection to a symbol");
    } finally {
      for (var restoreLockIndex = 0; restoreLockIndex < lockStates.length; restoreLockIndex++) {
        try {
          lockStates[restoreLockIndex].layer.locked = lockStates[restoreLockIndex].locked;
        } catch (lockError) {
          traceRestoreError("Layer lock was not restored", lockError);
        }
      }
    }
    return serialize({ name: __request.name, type: __request.type, registrationPoint: __request.registrationPoint });
    } finally {
      if (timeline) {
        try {
          restoreTimelineState(timeline, targetLayer, targetFrame, null, targetSelection);
        } catch (targetRestoreError) {
          traceRestoreError("Target timeline state was not restored", targetRestoreError);
        }
      }
    }
    });
    for (var warningIndex = 0; warningIndex < session.warnings.length; warningIndex++) fl.trace(session.warnings[warningIndex]);
    if (timeline) {
      try {
        var targetLayerIndex = -1;
        for (var targetIndex = 0; targetIndex < timeline.layers.length; targetIndex++) {
          if (timeline.layers[targetIndex] === targetLayer) targetLayerIndex = targetIndex;
        }
        if (targetLayerIndex >= 0) timeline.currentLayer = targetLayerIndex;
        timeline.currentFrame = targetFrame;
      } catch (targetRestoreError) {
        traceRestoreError("Target timeline state was not restored", targetRestoreError);
      }
    }
    return session.result;
  } finally {
    try {
      var restoredTimeline = document.getTimeline();
      restoreTimelineState(restoredTimeline, originalLayer, originalFrame, originalSelectedFrames, originalSelection);
    } catch (originalRestoreError) {
      traceRestoreError("Original timeline state was not restored", originalRestoreError);
    }
  }
})();
