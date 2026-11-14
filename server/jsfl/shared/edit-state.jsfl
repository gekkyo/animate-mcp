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

function editLayerPosition(targetTimeline, targetLayer) {
  for (var index = 0; index < targetTimeline.layers.length; index++) {
    if (targetTimeline.layers[index] === targetLayer) return index;
  }
  return -1;
}

function editSelectedFrameLayers(targetTimeline, frames) {
  var result = [];
  if (!frames) return result;
  for (var index = 0; index < frames.length; index += 3) {
    result.push({ offset: index, layer: targetTimeline.layers[frames[index]] });
  }
  return result;
}

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

function plannedEditLayer(plannedLayers, name) {
  for (var index = 0; index < plannedLayers.length; index++) {
    if (plannedLayers[index].name === name) return plannedLayers[index];
  }
  var plan = { name: name, layer: null };
  plannedLayers.push(plan);
  return plan;
}

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
