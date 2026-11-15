// Shared part concatenated before other JSFL.
// Records the current edit state and returns a restore function. It returns a warning string on failure (empty string on success).
/** Captures a document's edit state and returns a function that restores it.
 * @param doc The document whose edit state to capture.
 * @returns A function that restores the saved edit state.
 */
function saveEditState(doc) {
  var priorLibraryItem = doc.getTimeline().libraryItem;
  var priorItemName = priorLibraryItem ? priorLibraryItem.name : "";
  var priorTimeline = doc.currentTimeline;
  /** Restores the saved edit state and returns an empty string or warning.
   * @returns An empty string on success, or a warning when restoration fails.
   */
  return function () {
    try {
      if (priorItemName) doc.library.editItem(priorItemName);
      else {
        doc.exitEditMode();
        // editScene is unavailable on Canvas, so call it only when the scene changed
        if (doc.currentTimeline !== priorTimeline) doc.editScene(priorTimeline);
      }
      var currentLibraryItem = doc.getTimeline().libraryItem;
      return (currentLibraryItem ? currentLibraryItem.name : "") !== priorItemName ? "Edit state was not restored" : "";
    } catch (error) {
      return "Edit state was not restored: " + String(error && error.message ? error.message : error);
    }
  };
}

/** Finds a layer's current index by object identity.
 * @param targetTimeline Timeline containing the layer.
 * @param targetLayer Layer object to locate.
 * @returns The current layer index, or -1 when the layer is absent.
 */
function editLayerPosition(targetTimeline, targetLayer) {
  for (var index = 0; index < targetTimeline.layers.length; index++) {
    if (targetTimeline.layers[index] === targetLayer) return index;
  }
  return -1;
}

/** Captures layer object references at the layer-index slots in selected-frame data.
 * @param targetTimeline Timeline whose selected frames are captured.
 * @param frames Selected-frame array returned by Animate, or null.
 * @returns Layer references paired with their selected-frame array offsets.
 */
function editSelectedFrameLayers(targetTimeline, frames) {
  var result = [];
  if (!frames) return result;
  for (var index = 0; index < frames.length; index += 3) {
    result.push({ offset: index, layer: targetTimeline.layers[frames[index]] });
  }
  return result;
}

/** Restores selected frames while updating layer indices after layer reordering.
 * @param targetTimeline Timeline receiving the selection.
 * @param frames Original selected-frame array, or null.
 * @param layerRefs Layer references captured from the original selection.
 * @returns Nothing.
 */
function restoreEditSelectedFrames(targetTimeline, frames, layerRefs) {
  if (!frames || !targetTimeline.setSelectedFrames) return;
  var restoredFrames = frames.slice();
  for (var refIndex = 0; refIndex < layerRefs.length; refIndex++) {
    if (!layerRefs[refIndex].layer) continue;
    for (var layerIndex = 0; layerIndex < targetTimeline.layers.length; layerIndex++) {
      if (targetTimeline.layers[layerIndex] === layerRefs[refIndex].layer) {
        restoredFrames[layerRefs[refIndex].offset] = layerIndex;
      }
    }
  }
  targetTimeline.setSelectedFrames(restoredFrames);
}

/** Enters a requested scene or Library item timeline.
 * @param document Animate document to edit.
 * @param timelineRef Scene index or Library item name.
 * @returns The resolved timeline.
 */
function resolveEditTimeline(document, timelineRef) {
  if (typeof timelineRef === 'number') {
    if (Math.floor(timelineRef) !== timelineRef || timelineRef < 0 || timelineRef >= document.timelines.length) {
      throw new Error('Scene not found');
    }
    if (document.getTimeline().libraryItem && document.exitEditMode) document.exitEditMode();
    if (document.currentTimeline !== timelineRef && document.editScene) document.editScene(timelineRef);
    return document.timelines[timelineRef];
  }
  var found = false;
  for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
    if (document.library.items[itemIndex].name === timelineRef) found = true;
  }
  if (!found) throw new Error('Library item not found: ' + timelineRef);
  document.library.editItem(timelineRef);
  return document.getTimeline();
}

/** Runs a callback in a target timeline and restores timeline, selection, and edit state.
 * @param document Animate document to edit.
 * @param timelineRef Scene index or Library item name.
 * @param fn Operation to run with the target timeline.
 * @returns The callback result and any state-restoration warnings.
 */
function withTimelineEdit(document, timelineRef, fn) {
  var restore = saveEditState(document), timeline = null, selectedFrames = null, layerRefs = [], result;
  var warnings = [], operationError, operationFailed = false;
  try {
    timeline = resolveEditTimeline(document, timelineRef);
    selectedFrames = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null;
    layerRefs = editSelectedFrameLayers(timeline, selectedFrames);
    result = fn(timeline);
  } catch (error) {
    operationError = error;
    operationFailed = true;
  } finally {
    if (timeline) {
      try {
        restoreEditSelectedFrames(timeline, selectedFrames, layerRefs);
      } catch (selectionError) {
        warnings.push('Selected frames were not restored: ' + String(selectionError && selectionError.message ? selectionError.message : selectionError));
      }
    }
    var warning = restore();
    if (warning) warnings.push(warning);
  }
  if (operationFailed) {
    if (typeof fl !== 'undefined' && fl.trace) {
      for (var warningIndex = 0; warningIndex < warnings.length; warningIndex++) fl.trace(warnings[warningIndex]);
    }
    throw operationError;
  }
  return { result: result, warnings: warnings };
}

/** Resolves a layer index or unique layer name.
 * @param targetTimeline Timeline containing candidate layers.
 * @param reference Numeric layer index or layer name.
 * @returns The resolved zero-based layer index.
 */
function resolveEditLayerIndex(targetTimeline, reference) {
  if (typeof reference === 'number') {
    if (Math.floor(reference) !== reference || reference < 0 || reference >= targetTimeline.layers.length) {
      throw new Error('Layer index not found: ' + reference);
    }
    return reference;
  }
  var found = -1, matches = 0;
  for (var index = 0; index < targetTimeline.layers.length; index++) {
    if (targetTimeline.layers[index].name === reference) {
      found = index;
      matches++;
    }
  }
  if (!matches) throw new Error('Layer not found: ' + reference);
  if (matches > 1) throw new Error('Layer name is ambiguous: ' + reference);
  return found;
}

/** Finds a uniquely named layer for an add-or-reuse edit.
 * @param targetTimeline Timeline containing candidate layers.
 * @param name Layer name to find.
 * @returns The matching layer, or null when absent.
 */
function resolveEditAddLayer(targetTimeline, name) {
  var found = null, matches = 0;
  for (var index = 0; index < targetTimeline.layers.length; index++) {
    if (targetTimeline.layers[index].name === name) {
      found = targetTimeline.layers[index];
      matches++;
    }
  }
  if (matches > 1) throw new Error('Layer name is ambiguous: ' + name);
  return found;
}

/** Reuses or creates a planned layer record by name.
 * @param plannedLayers Mutable layer-plan records.
 * @param name Planned layer name.
 * @returns The matching or newly created layer-plan record.
 */
function plannedEditLayer(plannedLayers, name) {
  for (var index = 0; index < plannedLayers.length; index++) {
    if (plannedLayers[index].name === name) return plannedLayers[index];
  }
  var plan = { name: name, layer: null };
  plannedLayers.push(plan);
  return plan;
}

/** Resolves an element index or unique element name.
 * @param elements Timeline elements to search.
 * @param reference Numeric element index or element name.
 * @returns The resolved zero-based element index.
 */
function resolveEditElement(elements, reference) {
  if (typeof reference === 'number') {
    if (Math.floor(reference) !== reference || reference < 0 || reference >= elements.length) {
      throw new Error('Element index not found: ' + reference);
    }
    return reference;
  }
  var found = -1, matches = 0;
  for (var index = 0; index < elements.length; index++) {
    if (elements[index].name === reference) {
      found = index;
      matches++;
    }
  }
  if (matches === 0) throw new Error('Element not found: ' + reference);
  if (matches > 1) throw new Error('Element name is ambiguous: ' + reference);
  return found;
}

/** Temporarily unlocks layers while running a callback, then restores their lock states.
 * @param layers Layers whose lock states are temporarily changed.
 * @param callback Operation to run while the layers are unlocked.
 * @returns The callback result.
 */
function withEditUnlockedLayers(layers, callback) {
  var states = [];
  for (var index = 0; index < layers.length; index++) {
    states.push({ layer: layers[index], locked: layers[index].locked });
    if (layers[index].locked) layers[index].locked = false;
  }
  try {
    return callback();
  } finally {
    for (var stateIndex = 0; stateIndex < states.length; stateIndex++) {
      states[stateIndex].layer.locked = states[stateIndex].locked;
    }
  }
}
