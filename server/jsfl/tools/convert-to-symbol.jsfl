// `var __docName`, `var __timelineRef`, and `var __request` are injected before this file.
(function () {
  var document = selectDocument(), restoreEditState = saveEditState(document);
  var originalTimeline = document.getTimeline();
  var originalLayer = originalTimeline.layers[originalTimeline.currentLayer];
  var originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelection = document.selection ? document.selection.slice() : [];
  var timeline = null, targetLayer = null, targetFrame = null, targetSelectedFrames = null;
  var targetSelection = [], resolved = [], lockedLayers = [], lockStates = [];
  var frameIndex = __request.frame - 1;
  var allowedTypes = ["movie clip", "button", "graphic"];
  var registrationPoints = ["top left", "top center", "top right", "center left", "center", "center right", "bottom left", "bottom center", "bottom right"];

  function resolveTimeline() {
    if (typeof __timelineRef === "number") {
      if (Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0 || __timelineRef >= document.timelines.length) {
        throw new Error("Scene not found");
      }
      if (document.getTimeline().libraryItem && document.exitEditMode) document.exitEditMode();
      if (document.currentTimeline !== __timelineRef && document.editScene) document.editScene(__timelineRef);
      return document.timelines[__timelineRef];
    }
    var found = false;
    for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
      if (document.library.items[itemIndex].name === __timelineRef) found = true;
    }
    if (!found) throw new Error("Library item not found: " + __timelineRef);
    document.library.editItem(__timelineRef);
    return document.getTimeline();
  }

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

  function restoreSelection(targetTimeline, selection) {
    if (document.selectNone) document.selectNone();
    for (var index = 0; index < selection.length; index++) {
      if (containsElement(targetTimeline, selection[index])) selection[index].selected = true;
    }
  }

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

    timeline = resolveTimeline();
    targetLayer = timeline.layers[timeline.currentLayer];
    targetFrame = timeline.currentFrame;
    targetSelectedFrames = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null;
    targetSelection = document.selection ? document.selection.slice() : [];

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
    for (unlockIndex = 0; unlockIndex < lockStates.length; unlockIndex++) {
      if (lockStates[unlockIndex].locked) lockStates[unlockIndex].layer.locked = false;
    }

    timeline.currentFrame = frameIndex;
    timeline.currentLayer = resolved[0].layerIndex;
    if (document.selectNone) document.selectNone();
    for (var selectIndex = 0; selectIndex < resolved.length; selectIndex++) resolved[selectIndex].element.selected = true;
    var created = document.convertToSymbol(__request.type, __request.name, __request.registrationPoint);
    if (!created) throw new Error("Animate could not convert the selection to a symbol");
    return serialize({ name: __request.name, type: __request.type, registrationPoint: __request.registrationPoint });
  } finally {
    for (var restoreLockIndex = 0; restoreLockIndex < lockStates.length; restoreLockIndex++) {
      try {
        lockStates[restoreLockIndex].layer.locked = lockStates[restoreLockIndex].locked;
      } catch (lockError) {
        traceRestoreError("Layer lock was not restored", lockError);
      }
    }
    if (timeline) {
      try {
        restoreTimelineState(timeline, targetLayer, targetFrame, targetSelectedFrames, targetSelection);
      } catch (targetRestoreError) {
        traceRestoreError("Target timeline state was not restored", targetRestoreError);
      }
    }
    try {
      var restoreWarning = restoreEditState();
      if (restoreWarning) fl.trace(restoreWarning);
      var restoredTimeline = document.getTimeline();
      restoreTimelineState(restoredTimeline, originalLayer, originalFrame, originalSelectedFrames, originalSelection);
    } catch (originalRestoreError) {
      traceRestoreError("Original timeline state was not restored", originalRestoreError);
    }
  }
})();
