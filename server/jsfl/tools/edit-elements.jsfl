// `var __docName`, `var __timelineRef`, and `var __ops` are injected before this file.
  var document = selectDocument(), restore = saveEditState(document), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
  var originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelection = document.selection ? document.selection.slice() : [];
  var targetLayerState = null, targetFrameState = null, targetSelectedFrames = null, targetSelection = [];
  var resolved = [], resultElements = [], layersToUnlock = [];

  function resolveTimeline() {
    if (typeof __timelineRef === 'number') {
      if (Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0 || __timelineRef >= document.timelines.length) {
        throw new Error('Scene not found');
      }
      if (document.getTimeline().libraryItem && document.exitEditMode) document.exitEditMode();
      if (document.currentTimeline !== __timelineRef && document.editScene) document.editScene(__timelineRef);
      return document.timelines[__timelineRef];
    }
    var found = false;
    for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
      if (document.library.items[itemIndex].name === __timelineRef) found = true;
    }
    if (!found) throw new Error('Library item not found: ' + __timelineRef);
    document.library.editItem(__timelineRef);
    return document.getTimeline();
  }

  function resolveLayer(reference) {
    if (typeof reference === 'number') {
      if (Math.floor(reference) !== reference || reference < 0 || reference >= timeline.layers.length) {
        throw new Error('Layer index not found: ' + reference);
      }
      return reference;
    }
    return findLayerIndex(reference, undefined);
  }

  function resolveElement(elements, reference) {
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

  function numberInRange(value, name, minimum, maximum) {
    if (typeof value !== 'number' || !isFinite(value) || value < minimum || value > maximum) {
      throw new Error(name + ' must be between ' + minimum + ' and ' + maximum);
    }
  }

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

  function validateSet(set) {
    var numeric = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY'];
    for (var index = 0; index < numeric.length; index++) {
      if (set[numeric[index]] !== undefined && (typeof set[numeric[index]] !== 'number' || !isFinite(set[numeric[index]]))) {
        throw new Error(numeric[index] + ' must be a finite number');
      }
    }
    if (set.colorEffect) validateColorEffect(set.colorEffect);
    if (set.filters) validateFilters(set.filters);
    if (set.rotation !== undefined && (set.skewX !== undefined || set.skewY !== undefined)) {
      throw new Error('rotation and skew cannot be set together in one operation');
    }
  }

  function applySet(element, set) {
    var properties = ['x', 'y', 'scaleX', 'scaleY', 'skewX', 'skewY', 'rotation', 'name', 'blendMode', 'visible'];
    for (var index = 0; index < properties.length; index++) {
      var property = properties[index];
      if (set[property] !== undefined) element[property] = set[property];
    }
    if (set.filters !== undefined) element.filters = set.filters;
    if (set.colorEffect) {
      var effect = set.colorEffect;
      if (effect.mode === 'none') element.colorMode = 'none';
      else if (effect.mode === 'alpha') {
        document.selectNone();
        element.selected = true;
        document.setInstanceAlpha(effect.alphaPercent);
      } else if (effect.mode === 'brightness') {
        document.selectNone();
        element.selected = true;
        document.setInstanceBrightness(effect.brightnessPercent);
      } else if (effect.mode === 'tint') {
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

  try {
    timeline = resolveTimeline();
    targetLayerState = timeline.currentLayer;
    targetFrameState = timeline.currentFrame;
    targetSelectedFrames = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null;
    targetSelection = document.selection ? document.selection.slice() : [];

    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex], layerIndex = resolveLayer(op.layer), layer = timeline.layers[layerIndex];
      var frameIndex = op.frame - 1;
      if (frameIndex >= layer.frames.length || !layer.frames[frameIndex]) throw new Error('Frame not found: ' + op.frame);
      var frame = layer.frames[frameIndex];
      if (frame.startFrame !== frameIndex) {
        var span = layer.frames[frame.startFrame];
        if (span && (span.tweenType || 'none') !== 'none') throw new Error('Frame is inside a tween; only keyframes can be edited');
        throw new Error('Frame is not a keyframe; only keyframes can be edited');
      }
      var elements = frame.elements || [], elementIndex = resolveElement(elements, op.element);
      if (elements[elementIndex].elementType !== 'instance') throw new Error('Only symbol instances can be edited');
      validateSet(op.set);
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

    withUnlockedLayers(layersToUnlock, function () {
      for (var resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex++) {
        var entry = resolved[resolvedIndex];
        timeline.currentLayer = entry.layerIndex;
        timeline.currentFrame = entry.frame.startFrame;
        applySet(entry.element, entry.op.set);
        var resultElement = readElement(entry.element);
        resultElement.layer = entry.op.layerName;
        resultElement.frame = entry.op.frame;
        resultElement.element = entry.op.elementIndex;
        resultElements.push(resultElement);
      }
    });
  } finally {
    if (timeline && targetLayerState !== null) {
      if (document.selectNone) document.selectNone();
      if (targetSelectedFrames && timeline.setSelectedFrames) timeline.setSelectedFrames(targetSelectedFrames);
      if (targetLayerState < timeline.layers.length) timeline.currentLayer = targetLayerState;
      timeline.currentFrame = targetFrameState;
      for (var selectionIndex = 0; selectionIndex < targetSelection.length; selectionIndex++) targetSelection[selectionIndex].selected = true;
    }
    var restoreWarning = restore();
    var restoredTimeline = document.getTimeline();
    if (originalSelectedFrames && restoredTimeline.setSelectedFrames) restoredTimeline.setSelectedFrames(originalSelectedFrames);
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    restoredTimeline.currentFrame = originalFrame;
    if (document.selectNone) document.selectNone();
    for (var originalSelectionIndex = 0; originalSelectionIndex < originalSelection.length; originalSelectionIndex++) {
      originalSelection[originalSelectionIndex].selected = true;
    }
    if (restoreWarning) fl.trace(restoreWarning);
  }

  return serialize({ applied: resultElements.length, elements: resultElements });
})();
