// @requires shared/select-document, shared/edit-state, shared/export-common, timeline/helpers, shared/element-read
(function () {
// `var __docName`, `var __timelineRef`, and `var __ops` are injected before this file.
  var document = selectDocument(), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.layers[originalTimeline.currentLayer];
  var originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelectedFrameLayers = editSelectedFrameLayers(originalTimeline, originalSelectedFrames);
  var originalSelection = document.selection ? document.selection.slice() : [];
  var targetLayerState = null, targetFrameState = null, targetSelection = [];
  var resolved = [], resultElements = [], layersToUnlock = [], plannedLayers = [];

  /** Finds a Library item by its exact name.
   * @param name Library item name.
   * @returns The matching item, or null when absent.
   */
  function findElementLibraryItem(name) {
    for (var index = 0; index < document.library.items.length; index++) {
      if (document.library.items[index].name === name) return document.library.items[index];
    }
    return null;
  }

  /** Requires a finite number within an inclusive range.
   * @param value Number to validate.
   * @param name Field name used in the error.
   * @param minimum Inclusive lower bound.
   * @param maximum Inclusive upper bound.
   * @returns Nothing.
   */
  function numberInRange(value, name, minimum, maximum) {
    if (typeof value !== 'number' || !isFinite(value) || value < minimum || value > maximum) {
      throw new Error(name + ' must be between ' + minimum + ' and ' + maximum);
    }
  }

  /** Validates a color-effect operation and its mode-specific fields.
   * @param effect Requested color effect.
   * @returns Nothing.
   */
  function validateColorEffect(effect) {
    if (effect.mode === 'none') return;
    if (effect.mode === 'alpha') numberInRange(effect.alphaPercent, 'alphaPercent', 0, 100);
    else if (effect.mode === 'brightness') numberInRange(effect.brightnessPercent, 'brightnessPercent', -100, 100);
    else if (effect.mode === 'tint') {
      if (typeof effect.tintColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(effect.tintColor)) {
        throw new Error('tintColor must be a #RRGGBB color');
      }
      numberInRange(effect.tintPercent, 'tintPercent', 0, 100);
    } else if (effect.mode === 'advanced') {
      var percentages = ['redPercent', 'greenPercent', 'bluePercent'];
      var amounts = ['redAmount', 'greenAmount', 'blueAmount'];
      for (var index = 0; index < percentages.length; index++) {
        if (effect[percentages[index]] !== undefined) numberInRange(effect[percentages[index]], percentages[index], 0, 100);
      }
      for (index = 0; index < amounts.length; index++) {
        if (effect[amounts[index]] !== undefined) numberInRange(effect[amounts[index]], amounts[index], -255, 255);
      }
    } else throw new Error('Unsupported colorEffect mode: ' + effect.mode);
  }

  /** Validates supported Animate filter objects and their field values.
   * @param filters Requested filters.
   * @returns Nothing.
   */
  function validateFilters(filters) {
    for (var filterIndex = 0; filterIndex < filters.length; filterIndex++) {
      var filter = filters[filterIndex];
      var fields = filter && ELEMENT_FILTER_FIELDS[filter.name];
      if (!filter || typeof filter !== 'object' || !fields) throw new Error('Unsupported filter: ' + (filter && filter.name));
      for (var property in filter) {
        if (property !== 'name' && property !== 'enabled' && fields.indexOf(property) < 0) {
          throw new Error('Unsupported ' + filter.name + ' field: ' + property);
        }
        var value = filter[property];
        if (property === 'name' || property === 'enabled') {
          if (property === 'enabled' && typeof value !== 'boolean') throw new Error('Filter enabled must be a boolean');
        } else if (property === 'colors' || property === 'alphas' || property === 'ratios') {
          if (!(value instanceof Array)) throw new Error('Filter ' + property + ' must be an array');
          for (var itemIndex = 0; itemIndex < value.length; itemIndex++) {
            if (typeof value[itemIndex] !== 'number' || !isFinite(value[itemIndex])) throw new Error('Filter ' + property + ' values must be numbers');
          }
        } else if (property === 'color' || property === 'shadowColor' || property === 'highlightColor' || property === 'quality' || property === 'type') {
          if (typeof value !== 'string') throw new Error('Filter ' + property + ' must be a string');
        } else if (property === 'inner' || property === 'knockout' || property === 'hideObject') {
          if (typeof value !== 'boolean') throw new Error('Filter ' + property + ' must be a boolean');
        } else if (typeof value !== 'number' || !isFinite(value)) throw new Error('Filter ' + property + ' must be a finite number');
      }
    }
  }

  /** Determines and validates the frame count of a graphic Library item.
   * @param item Graphic Library item.
   * @returns Number of frames in its timeline.
   */
  function graphicFrameCount(item) {
    var symbolTimeline = item.timeline;
    if (symbolTimeline && typeof symbolTimeline.frameCount === 'number') {
      if (!isFinite(symbolTimeline.frameCount) || symbolTimeline.frameCount < 0 || Math.floor(symbolTimeline.frameCount) !== symbolTimeline.frameCount) {
        throw new Error('Could not determine graphic frame count');
      }
      return symbolTimeline.frameCount;
    }
    var layers = symbolTimeline && symbolTimeline.layers;
    if (!layers || typeof layers.length !== 'number' || !isFinite(layers.length) || layers.length < 0 || Math.floor(layers.length) !== layers.length) {
      throw new Error('Could not determine graphic frame count');
    }
    var count = 0;
    for (var index = 0; index < layers.length; index++) {
      var frames = layers[index] && layers[index].frames;
      if (!frames || typeof frames.length !== 'number' || !isFinite(frames.length) || frames.length < 0 || Math.floor(frames.length) !== frames.length) {
        throw new Error('Could not determine graphic frame count');
      }
      if (frames.length > count) count = frames.length;
    }
    // An empty timeline has zero frames, so no nonnegative firstFrame is valid.
    return count;
  }

  /** Validates instance properties against the target symbol type.
   * @param set Requested instance properties.
   * @param reference Target instance or Library item.
   * @returns Nothing.
   */
  function validateSet(set, reference) {
    var numeric = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY'];
    for (var index = 0; index < numeric.length; index++) {
      if (set[numeric[index]] !== undefined && (typeof set[numeric[index]] !== 'number' || !isFinite(set[numeric[index]]))) {
        throw new Error(numeric[index] + ' must be a finite number');
      }
    }
    if (set.colorEffect) validateColorEffect(set.colorEffect);
    if (set.filters) validateFilters(set.filters);
    var item = reference && reference.libraryItem ? reference.libraryItem : reference;
    var symbolType = reference && reference.elementType === 'instance' ? reference.symbolType : reference && reference.itemType;
    if (set.swapSymbol !== undefined) {
      var swapItem = findElementLibraryItem(set.swapSymbol);
      if (!swapItem) throw new Error('Library item not found: ' + set.swapSymbol);
      if (['movie clip', 'graphic', 'button'].indexOf(swapItem.itemType) < 0) {
        throw new Error('Library item is not a symbol: ' + set.swapSymbol);
      }
    }
    if (set.loop !== undefined || set.firstFrame !== undefined) {
      if (symbolType !== 'graphic') throw new Error('loop and firstFrame can only be set on graphic instances');
      if (set.firstFrame !== undefined) {
        var frameCount = graphicFrameCount(item);
        if (set.firstFrame >= frameCount) {
          throw new Error('firstFrame must be less than the graphic frame count (' + frameCount + ')');
        }
      }
    }
    if (set.rotation !== undefined && (set.skewX !== undefined || set.skewY !== undefined)) {
      throw new Error('rotation and skew cannot be set together in one operation');
    }
  }

  /** Applies requested properties, effects, filters, or a symbol swap.
   * @param element Symbol instance to update.
   * @param set Properties to apply.
   * @returns Nothing.
   */
  function applySet(element, set) {
    if (set.swapSymbol !== undefined) {
      // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
      document.selectNone();
      element.selected = true;
      document.swapElement(set.swapSymbol);
    }
    var properties = ['x', 'y', 'scaleX', 'scaleY', 'skewX', 'skewY', 'rotation', 'name', 'blendMode', 'visible'];
    for (var index = 0; index < properties.length; index++) {
      var property = properties[index];
      if (set[property] !== undefined) element[property] = set[property];
    }
    if (set.loop !== undefined) element.loop = set.loop;
    if (set.firstFrame !== undefined) element.firstFrame = set.firstFrame;
    if (set.filters !== undefined) element.filters = set.filters;
    if (set.colorEffect) {
      var effect = set.colorEffect;
      if (effect.mode === 'none') element.colorMode = 'none';
      else if (effect.mode === 'alpha') {
        // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
        document.selectNone();
        element.selected = true;
        document.setInstanceAlpha(effect.alphaPercent);
      } else if (effect.mode === 'brightness') {
        // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
        document.selectNone();
        element.selected = true;
        document.setInstanceBrightness(effect.brightnessPercent);
      } else if (effect.mode === 'tint') {
        // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
        document.selectNone();
        element.selected = true;
        document.setInstanceTint(effect.tintColor, effect.tintPercent);
      } else {
        element.colorMode = 'advanced';
        var fields = ['redPercent', 'greenPercent', 'bluePercent', 'redAmount', 'greenAmount', 'blueAmount'];
        var targets = ['colorRedPercent', 'colorGreenPercent', 'colorBluePercent', 'colorRedAmount', 'colorGreenAmount', 'colorBlueAmount'];
        for (index = 0; index < fields.length; index++) {
          if (effect[fields[index]] !== undefined) element[targets[index]] = effect[fields[index]];
        }
      }
    }
  }

  var session = null;
  try {
    session = withTimelineEdit(document, __timelineRef, /** Applies the requested symbol operations in the target timeline.
     * @param targetTimeline Timeline selected for editing.
     * @returns The serialized edit result.
     */
    function (targetTimeline) {
    timeline = targetTimeline;
    targetLayerState = timeline.layers[timeline.currentLayer];
    targetFrameState = timeline.currentFrame;
    targetSelection = document.selection ? document.selection.slice() : [];

    try {
    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      if (op.op === 'add') {
        var item = findElementLibraryItem(op.item);
        var visualItemTypes = ['movie clip', 'graphic', 'button', 'bitmap', 'component', 'compiled clip'];
        if (!item) throw new Error('Library item not found: ' + op.item);
        if (visualItemTypes.indexOf(item.itemType) < 0) throw new Error('Library item is not a visual item: ' + op.item);
        if (timeline.libraryItem && timeline.libraryItem.name === op.item) throw new Error('Cannot add a Library item to its own symbol timeline: ' + op.item);
        var addLayer = resolveEditAddLayer(timeline, op.layer);
        if (addLayer && addLayer.layerType === 'folder') throw new Error('Cannot add to a folder layer: ' + op.layer);
        var addFrameIndex = op.frame - 1, spanToCheck = null;
        if (addLayer && addLayer.frames.length) {
          var spanFrameIndex = addFrameIndex >= addLayer.frames.length ? addLayer.frames.length - 1 : addFrameIndex;
          var spanFrame = addLayer.frames[spanFrameIndex];
          spanToCheck = spanFrame && addLayer.frames[spanFrame.startFrame];
          if (spanToCheck && (spanToCheck.tweenType || 'none') !== 'none') throw new Error('Cannot add a Library item to a tween span');
        }
        if (op.set && op.set.swapSymbol !== undefined) throw new Error('swapSymbol cannot be used with add operations');
        if (op.set) validateSet(op.set, item);
        resolved.push({ kind: 'add', op: op, layer: addLayer, layerPlan: addLayer ? null : plannedEditLayer(plannedLayers, op.layer) });
        if (addLayer) {
          var addLayerAlreadyUnlocked = false;
          for (var addLockedIndex = 0; addLockedIndex < layersToUnlock.length; addLockedIndex++) {
            if (layersToUnlock[addLockedIndex] === addLayer) addLayerAlreadyUnlocked = true;
          }
          if (!addLayerAlreadyUnlocked) layersToUnlock.push(addLayer);
        }
        continue;
      }
      var layerIndex = resolveEditLayerIndex(timeline, op.layer), layer = timeline.layers[layerIndex];
      var frameIndex = op.frame - 1;
      if (frameIndex >= layer.frames.length || !layer.frames[frameIndex]) throw new Error('Frame not found: ' + op.frame);
      var frame = layer.frames[frameIndex];
      if (frame.startFrame !== frameIndex) {
        var span = layer.frames[frame.startFrame];
        if (span && (span.tweenType || 'none') !== 'none') throw new Error('Frame is inside a tween; only keyframes can be edited');
        throw new Error('Frame is not a keyframe; only keyframes can be edited');
      }
      var elements = frame.elements || [], elementIndex = resolveEditElement(elements, op.element);
      if (elements[elementIndex].elementType !== 'instance') throw new Error('Only symbol instances can be edited');
      validateSet(op.set, elements[elementIndex]);
      op.layerName = layer.name;
      op.frameIndex = frameIndex;
      op.elementIndex = elementIndex;
      resolved.push({ op: op, layer: layer, layerIndex: layerIndex, frame: frame, element: elements[elementIndex] });
      var alreadyAdded = false;
      for (var lockedIndex = 0; lockedIndex < layersToUnlock.length; lockedIndex++) {
        if (layersToUnlock[lockedIndex] === layer) alreadyAdded = true;
      }
      if (!alreadyAdded) layersToUnlock.push(layer);
    }

    for (var swapCheckIndex = 0; swapCheckIndex < resolved.length; swapCheckIndex++) {
      var swapEntry = resolved[swapCheckIndex];
      if (!swapEntry.element || !swapEntry.op.set || swapEntry.op.set.swapSymbol === undefined) continue;
      for (var playbackCheckIndex = 0; playbackCheckIndex < resolved.length; playbackCheckIndex++) {
        var playbackEntry = resolved[playbackCheckIndex], playbackSet = playbackEntry.op.set;
        if (playbackEntry.element === swapEntry.element && playbackSet && (playbackSet.loop !== undefined || playbackSet.firstFrame !== undefined)) {
          throw new Error('Cannot combine swapSymbol with loop or firstFrame because symbolType after swap is unverified');
        }
      }
    }

    withEditUnlockedLayers(layersToUnlock, /** Applies validated symbol operations while target layers are unlocked.
     * @returns Nothing.
     */
    function () {
      for (var resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex++) {
        var entry = resolved[resolvedIndex];
        if (entry.kind === 'add') {
          var targetLayer = entry.layer || entry.layerPlan.layer;
          if (!targetLayer) {
            timeline.currentLayer = 0;
            var newLayerIndex = timeline.addNewLayer(entry.layerPlan.name, 'normal', true);
            targetLayer = timeline.layers[newLayerIndex];
            targetLayer.parentLayer = null;
            entry.layerPlan.layer = targetLayer;
          }
          var targetLayerIndex = layerPosition(timeline, targetLayer), targetFrameIndex = entry.op.frame - 1;
          if (targetLayerIndex < 0) throw new Error('Destination layer disappeared: ' + entry.op.layer);
          timeline.currentLayer = targetLayerIndex;
          if (targetFrameIndex >= targetLayer.frames.length) {
            timeline.insertFrames(targetFrameIndex - targetLayer.frames.length + 1, false, targetLayer.frames.length - 1);
          }
          timeline.currentLayer = targetLayerIndex;
          timeline.currentFrame = targetFrameIndex;
          var targetFrame = targetLayer.frames[targetFrameIndex];
          if (!targetFrame) throw new Error('Could not extend layer to frame: ' + entry.op.frame);
          if (targetFrame.startFrame !== targetFrameIndex) {
            timeline.insertKeyframe(targetFrameIndex);
            targetFrame = targetLayer.frames[targetFrameIndex];
          }
          if (!targetFrame || targetFrame.startFrame !== targetFrameIndex) throw new Error('Could not create keyframe: ' + entry.op.frame);
          var previousElementCount = (targetFrame.elements || []).length;
          var placedX = entry.op.x !== undefined ? entry.op.x : entry.op.set && entry.op.set.x !== undefined ? entry.op.set.x : document.width / 2;
          var placedY = entry.op.y !== undefined ? entry.op.y : entry.op.set && entry.op.set.y !== undefined ? entry.op.set.y : document.height / 2;
          document.library.addItemToDocument({
            x: placedX,
            y: placedY
          }, entry.op.item);
          var targetElements = targetFrame.elements || [], addedIndex = targetElements.length - 1, addedElement = targetElements[addedIndex];
          if (targetElements.length !== previousElementCount + 1 || !addedElement || addedElement.elementType !== 'instance' || !addedElement.libraryItem || addedElement.libraryItem.name !== entry.op.item) {
            throw new Error('Could not add Library item to layer ' + entry.op.layer);
          }
          if (entry.op.set) applySet(addedElement, entry.op.set);
          // addItemToDocument uses center coordinates; set the requested registration-point position explicitly.
          addedElement.x = placedX;
          addedElement.y = placedY;
          // shortcut: Animate rounds x/y, so retry up to 3 times and return the read-back value as is; upgrade if callers need exact coordinates.
          for (var positionAttempt = 0; positionAttempt < 3; positionAttempt++) {
            var actualX = Number(addedElement.x), actualY = Number(addedElement.y);
            if (actualX === placedX && actualY === placedY) break;
            addedElement.x = placedX + placedX - actualX;
            addedElement.y = placedY + placedY - actualY;
          }
          var addedResult = readElement(addedElement);
          addedResult.layer = targetLayer.name;
          addedResult.frame = entry.op.frame;
          addedResult.element = addedIndex;
          resultElements.push(addedResult);
          continue;
        }
        var setLayerIndex = layerPosition(timeline, entry.layer);
        if (setLayerIndex < 0) throw new Error('Layer disappeared: ' + entry.op.layerName);
        timeline.currentLayer = setLayerIndex;
        timeline.currentFrame = entry.frame.startFrame;
        applySet(entry.element, entry.op.set);
        var resultElement = readElement(entry.element);
        resultElement.layer = entry.op.layerName;
        resultElement.frame = entry.op.frame;
        resultElement.element = entry.op.elementIndex;
        resultElements.push(resultElement);
      }
    });
    return serialize({ applied: resultElements.length, elements: resultElements });
    } finally {
    if (timeline && targetLayerState) {
      // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
      if (document.selectNone) document.selectNone();
      var targetLayerIndex = layerPosition(timeline, targetLayerState);
      if (targetLayerIndex >= 0) timeline.currentLayer = targetLayerIndex;
      timeline.currentFrame = targetFrameState;
      for (var selectionIndex = 0; selectionIndex < targetSelection.length; selectionIndex++) targetSelection[selectionIndex].selected = true;
    }
    }
    });
    for (var warningIndex = 0; warningIndex < session.warnings.length; warningIndex++) fl.trace(session.warnings[warningIndex]);
  } finally {
    var restoredTimeline = document.getTimeline();
    restoreEditSelectedFrames(restoredTimeline, originalSelectedFrames, originalSelectedFrameLayers);
    var originalLayerIndex = editLayerPosition(restoredTimeline, originalLayer);
    if (originalLayerIndex >= 0) restoredTimeline.currentLayer = originalLayerIndex;
    restoredTimeline.currentFrame = originalFrame;
    // Clear first because Animate selection assignment adds to the current selection (see docs/animate-quirks.md).
    if (document.selectNone) document.selectNone();
    for (var originalSelectionIndex = 0; originalSelectionIndex < originalSelection.length; originalSelectionIndex++) {
      originalSelection[originalSelectionIndex].selected = true;
    }
  }

  return session.result;
})();
