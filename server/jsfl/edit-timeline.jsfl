// `var __timelineRef` (scene index or library item path) and `var __ops` are injected before this file.
/** Applies timeline operations and returns their results as JSON text.
 * @returns The serialized operation results.
 */
(function () {
  var document = selectDocument(), restore = saveEditState(document), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
  var originalFrame = originalTimeline.currentFrame, applied = [], failed = null, skipped = [], warnings = [];

  /** Finds a uniquely named layer and optionally verifies its index.
   * @param name The layer name to find.
   * @param requestedIndex The expected zero-based layer index, when specified.
   * @returns The matching zero-based layer index.
   */
  function findLayerIndex(name, requestedIndex) {
    var found = -1, matches = 0;
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      if (timeline.layers[layerIndex].name === name) {
        found = layerIndex;
        matches++;
      }
    }
    if (requestedIndex !== undefined) {
      if (requestedIndex < 0 || requestedIndex >= timeline.layers.length || timeline.layers[requestedIndex].name !== name) {
        throw new Error('Layer not found: ' + name);
      }
      return requestedIndex;
    }
    if (matches === 0) throw new Error('Layer not found: ' + name);
    if (matches > 1) throw new Error('Layer name is ambiguous: ' + name);
    return found;
  }

  /** Finds a uniquely named layer used as a parent or placement reference.
   * @param name The referenced layer name.
   * @returns The matching zero-based layer index.
   */
  function findReference(name) {
    return findLayerIndex(name, undefined);
  }

  /** Finds a layer's current zero-based position by object identity.
   * @param targetLayer The layer object to locate.
   * @returns The layer's zero-based index, or -1 when it is not present.
   */
  function layerPosition(targetLayer) {
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      if (timeline.layers[layerIndex] === targetLayer) return layerIndex;
    }
    return -1;
  }

  /** Temporarily unlocks target layers and restores their original lock states.
   * @param layers The layers to unlock while the operation runs.
   * @param callback The operation to run while the layers are unlocked.
   * @returns The callback's result.
   */
  function withUnlockedLayers(layers, callback) {
    var states = [];
    for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      states.push({ layer: layers[layerIndex], locked: layers[layerIndex].locked });
      if (layers[layerIndex].locked) layers[layerIndex].locked = false;
    }
    try {
      return callback();
    } finally {
      for (var stateIndex = 0; stateIndex < states.length; stateIndex++) {
        states[stateIndex].layer.locked = states[stateIndex].locked;
      }
    }
  }

  /** Verifies that the selected parent layer can contain the requested layer type.
   * @param name The parent layer name, when specified.
   * @param layerType The type of layer that will use the parent.
   * @returns The matching parent layer, or null when no parent is specified.
   */
  function parentFor(name, layerType) {
    if (name === undefined) return null;
    var parentIndex = findReference(name), parent = timeline.layers[parentIndex];
    var expectedType = layerType === 'masked' ? 'mask' : 'folder';
    if (parent.layerType !== expectedType) throw new Error('Parent must be a ' + expectedType + ' layer');
    return parent;
  }

  /** Verifies that relative placement does not put a child before its parent.
   * @param layerIndex The child's zero-based layer index.
   * @param parentLayer The parent layer to validate.
   */
  function validateParentPosition(layerIndex, parentLayer) {
    if (!parentLayer) return;
    var parentIndex = -1;
    for (var candidateIndex = 0; candidateIndex < timeline.layers.length; candidateIndex++) {
      if (timeline.layers[candidateIndex] === parentLayer) parentIndex = candidateIndex;
    }
    if (parentIndex < 0 || parentIndex >= layerIndex) throw new Error('Parent must appear above the layer');
  }

  /** Returns the layers affected by a frame operation.
   * @param layerIndex The target layer's zero-based index.
   * @param ripple Whether the operation affects all non-folder layers.
   * @returns The layers affected by the operation.
   */
  function affectedLayers(layerIndex, ripple) {
    var layers = [];
    if (ripple) {
      for (var index = 0; index < timeline.layers.length; index++) {
        if (timeline.layers[index].layerType !== 'folder') layers.push(timeline.layers[index]);
      }
    } else {
      layers.push(timeline.layers[layerIndex]);
    }
    return layers;
  }

  /** Rejects a frame position inside a tween span.
   * @param layer The layer containing the frame.
   * @param frameIndex The zero-based frame position to validate.
   */
  function rejectTween(layer, frameIndex) {
    if (frameIndex >= layer.frames.length) return;
    var frame = layer.frames[frameIndex], spanStart = frame.startFrame;
    var span = layer.frames[spanStart];
    if (frameIndex !== spanStart && span && (span.tweenType || 'none') !== 'none') {
      throw new Error('Frame is inside a tween');
    }
  }

  /** Rejects any tween interiors affected by removing a range.
   * @param layers The layers affected by the removal.
   * @param frameIndex The zero-based start of the range.
   * @param count The number of frames in the range.
   */
  function rejectTweenRange(layers, frameIndex, count) {
    for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      for (var offset = 0; offset < count; offset++) rejectTween(layers[layerIndex], frameIndex + offset);
    }
  }

  /** Moves a layer's full frame sequence while preserving its original keyframe spans.
   * @param layerIndex The layer's zero-based index.
   * @param layer The layer whose frames to move.
   * @param offset The number of frames to shift the layer forward.
   */
  function shiftLayerFrames(layerIndex, layer, offset) {
    if (offset < 1) throw new Error('offset must be at least 1');
    if (!layer.frames || layer.frames.length === 0) throw new Error('Layer has no frames');
    var originalLength = layer.frames.length, keyframes = [], frame, keyframeIndex;
    for (var frameIndex = 0; frameIndex < originalLength; frameIndex++) {
      frame = layer.frames[frameIndex];
      if (frame && frame.startFrame === frameIndex) {
        keyframes.push({ startFrame: frameIndex, duration: frame.duration });
      }
    }
    if (keyframes.length === 0) throw new Error('Layer has no frames');
    /** Cuts and pastes the layer's frames at the requested offset. */
    withUnlockedLayers([layer], function () {
      timeline.setSelectedLayers(layerIndex);
      timeline.setSelectedFrames(0, originalLength, true);
      timeline.cutFrames();
      timeline.setSelectedLayers(layerIndex);
      timeline.setSelectedFrames(offset, offset, true);
      timeline.pasteFrames(offset);
      // pasteFrames may extend the last span to the timeline-wide length.
      for (keyframeIndex = keyframes.length - 1; keyframeIndex >= 0; keyframeIndex--) {
        var keyframe = keyframes[keyframeIndex], shiftedStart = keyframe.startFrame + offset;
        frame = layer.frames[shiftedStart];
        if (!frame || frame.startFrame !== shiftedStart) throw new Error('Shifted keyframe no longer exists');
        if (frame.duration > keyframe.duration) {
          timeline.currentLayer = layerIndex;
          timeline.removeFrames(shiftedStart + keyframe.duration, shiftedStart + frame.duration);
        }
      }
    });
    var contentKeyframeCount = 0;
    for (frameIndex = offset; frameIndex < layer.frames.length; frameIndex++) {
      if (layer.frames[frameIndex].startFrame === frameIndex) contentKeyframeCount++;
    }
    if (contentKeyframeCount !== keyframes.length) throw new Error('Shifted keyframe count does not match its original');
    if (layer.frames.length !== originalLength + offset) throw new Error('Shifted layer has an unexpected length');
    for (keyframeIndex = 0; keyframeIndex < keyframes.length; keyframeIndex++) {
      var expected = keyframes[keyframeIndex], expectedStart = expected.startFrame + offset;
      frame = layer.frames[expectedStart];
      if (!frame || frame.startFrame !== expectedStart || frame.duration !== expected.duration) {
        throw new Error('Shifted keyframe span does not match its original duration');
      }
    }
    warnings.push('Only layer ' + layer.name + ' shifted; other layers were not shifted.');
  }

  /** Applies a layer operation.
   * @param op The layer operation to apply.
   */
  function applyLayerOp(op) {
    var layerIndex, layer, parent, placementIndex, addAbove, returnedIndex, desiredIndex, currentParent;
    if (op.op === 'addLayer') {
      if (op.above !== undefined && op.below !== undefined) throw new Error('Specify only one of above or below');
      parent = parentFor(op.parent, op.type || 'normal');
      if (op.above !== undefined) {
        placementIndex = findReference(op.above);
        addAbove = true;
      } else if (op.below !== undefined) {
        placementIndex = findReference(op.below);
        addAbove = false;
      } else if (parent) {
        placementIndex = findLayerIndex(parent.name, undefined);
        addAbove = false;
      } else {
        placementIndex = timeline.layers.length ? 0 : -1;
        addAbove = true;
      }
      if ((op.type || 'normal') === 'masked' && !parent) throw new Error('Parent layer is required for a masked layer');
      desiredIndex = placementIndex < 0 ? 0 : placementIndex + (addAbove ? 0 : 1);
      if (parent) {
        var parentIndexBefore = findReference(parent.name);
        var parentIndexAfter = parentIndexBefore + (desiredIndex <= parentIndexBefore ? 1 : 0);
        if (desiredIndex <= parentIndexAfter) throw new Error('Parent must appear above the layer');
      }
      timeline.currentLayer = placementIndex < 0 ? 0 : placementIndex;
      returnedIndex = timeline.addNewLayer(op.name, op.type || 'normal', addAbove);
      layer = timeline.layers[returnedIndex];
      layer.parentLayer = parent;
      if (parent) validateParentPosition(returnedIndex, parent);
      return;
    }

    layerIndex = findLayerIndex(op.layer, op.index);
    layer = timeline.layers[layerIndex];
    if (op.op === 'deleteLayer') {
      if (op.confirm !== true) throw new Error('confirm required');
      /** Deletes the selected layer. */
      withUnlockedLayers([layer], function () { timeline.deleteLayer(layerIndex); });
      return;
    }
    if (op.op === 'renameLayer') {
      /** Renames the selected layer. */
      withUnlockedLayers([layer], function () { layer.name = op.name; });
      return;
    }
    if (op.op === 'setLayerType') {
      parent = parentFor(op.parent, op.type);
      currentParent = layer.parentLayer || null;
      if (!parent && currentParent && op.parent === undefined) {
        if (op.type === 'masked' && currentParent.layerType === 'mask') parent = currentParent;
        if (op.type !== 'masked' && currentParent.layerType === 'folder') parent = currentParent;
      }
      if (op.type === 'masked' && !parent) throw new Error('Parent layer is required for a masked layer');
      if (parent) validateParentPosition(layerIndex, parent);
      /** Updates the selected layer's type and parent. */
      withUnlockedLayers([layer], function () {
        layer.layerType = op.type;
        layer.parentLayer = parent;
      });
      return;
    }
    if (op.op === 'moveLayer') {
      if (op.above !== undefined && op.below !== undefined) throw new Error('Specify only one of above or below');
      currentParent = layer.parentLayer || null;
      parent = op.parent === undefined ? currentParent : parentFor(op.parent, layer.layerType);
      if (op.above !== undefined) {
        placementIndex = findReference(op.above);
        if (placementIndex === layerIndex) throw new Error('Cannot place a layer relative to itself');
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0);
        addAbove = true;
      } else if (op.below !== undefined) {
        placementIndex = findReference(op.below);
        if (placementIndex === layerIndex) throw new Error('Cannot place a layer relative to itself');
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0) + 1;
        addAbove = false;
      } else if (parent) {
        placementIndex = findReference(parent.name);
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0) + 1;
        addAbove = false;
      } else {
        placementIndex = 0;
        desiredIndex = 0;
        addAbove = true;
      }
      if (parent) {
        var moveParentIndex = findReference(parent.name);
        var moveParentAfter = moveParentIndex - (layerIndex < moveParentIndex ? 1 : 0);
        if (desiredIndex <= moveParentAfter) throw new Error('Parent must appear above the layer');
      }
      /** Reorders the selected layer and optionally changes its parent. */
      withUnlockedLayers([layer], function () {
        if (placementIndex !== layerIndex) timeline.reorderLayer(layerIndex, placementIndex, addAbove);
        if (op.parent !== undefined) layer.parentLayer = parent;
      });
      return;
    }
  }

  /** Applies a frame operation.
   * @param op The frame operation to apply.
   */
  function applyFrameOp(op) {
    var layerIndex = findLayerIndex(op.layer, op.index), layer = timeline.layers[layerIndex];
    var frameIndex = op.frame - 1, count, layers, layerIndexToEdit, spanStart, spanLength, spanEnd, delta;
    if (op.op === 'shiftLayerFrames') {
      shiftLayerFrames(layerIndex, layer, op.offset);
      return;
    }
    if (op.op === 'insertFrames' || op.op === 'removeFrames') {
      if (op.op === 'removeFrames' && op.confirm !== true) throw new Error('confirm required');
      count = op.count;
      layers = affectedLayers(layerIndex, op.ripple === true);
      if (frameIndex < 0 || frameIndex > layer.frames.length || (op.op === 'removeFrames' && frameIndex + count > layer.frames.length)) {
        throw new Error('Frame beyond timeline length');
      }
      for (var affectedIndex = 0; affectedIndex < layers.length; affectedIndex++) {
        if (frameIndex > layers[affectedIndex].frames.length || (op.op === 'removeFrames' && frameIndex + count > layers[affectedIndex].frames.length)) {
          throw new Error('Frame beyond timeline length');
        }
      }
      if (op.op === 'insertFrames') {
        for (var insertLayerIndex = 0; insertLayerIndex < layers.length; insertLayerIndex++) rejectTween(layers[insertLayerIndex], frameIndex);
      } else {
        rejectTweenRange(layers, frameIndex, count);
      }
      /** Inserts or removes frames on the affected layers. */
      withUnlockedLayers(layers, function () {
        if (op.op === 'insertFrames') {
          timeline.currentLayer = layerIndex;
          timeline.insertFrames(count, op.ripple === true, frameIndex);
        } else {
          for (layerIndexToEdit = 0; layerIndexToEdit < layers.length; layerIndexToEdit++) {
            timeline.currentLayer = op.ripple === true ? layerPosition(layers[layerIndexToEdit]) : layerIndex;
            timeline.removeFrames(frameIndex, frameIndex + count);
          }
        }
      });
      if (op.ripple !== true) warnings.push('Only layer ' + layer.name + ' shifted; other layers were not shifted.');
      return;
    }
    if (frameIndex < 0 || frameIndex >= layer.frames.length) throw new Error('Frame beyond timeline length');
    if (op.op === 'insertKeyframe') {
      rejectTween(layer, frameIndex);
      if (layer.frames[frameIndex].startFrame === frameIndex) return;
      /** Converts the selected frame to a keyframe. */
      withUnlockedLayers([layer], function () {
        timeline.currentLayer = layerIndex;
        timeline.convertToKeyframes(frameIndex);
      });
      return;
    }
    if (op.op === 'clearKeyframe') {
      rejectTween(layer, frameIndex);
      if (layer.frames[frameIndex].startFrame !== frameIndex) throw new Error('Frame is not a keyframe');
      /** Clears the selected keyframe. */
      withUnlockedLayers([layer], function () {
        timeline.currentLayer = layerIndex;
        timeline.clearKeyframes(frameIndex);
      });
      return;
    }
    if (op.op === 'setLabel') {
      /** Sets the selected frame's label. */
      withUnlockedLayers([layer], function () {
        timeline.currentLayer = layerIndex;
        timeline.setFrameProperty('name', op.label, frameIndex, frameIndex + 1);
      });
      return;
    }
    if (op.op === 'setSpanLength') {
      spanStart = layer.frames[frameIndex].startFrame;
      spanLength = layer.frames[spanStart].duration;
      spanEnd = spanStart + spanLength;
      for (var keyframeIndex = spanStart + 1; keyframeIndex < spanEnd; keyframeIndex++) {
        if (layer.frames[keyframeIndex].startFrame === keyframeIndex) throw new Error('Another keyframe lies inside the span');
      }
      if (spanLength !== op.length) {
        count = Math.abs(op.length - spanLength);
        delta = spanStart + spanLength;
        layers = affectedLayers(layerIndex, op.ripple === true);
        for (var resizeLayerIndex = 0; resizeLayerIndex < layers.length; resizeLayerIndex++) {
          if (layers[resizeLayerIndex].frames.length < spanEnd) throw new Error('Frame beyond timeline length');
        }
        /** Resizes the selected frame span. */
        withUnlockedLayers(layers, function () {
          if (op.length > spanLength) {
            timeline.currentLayer = layerIndex;
            timeline.insertFrames(count, op.ripple === true, Math.max(spanStart, delta - 1));
          } else {
            for (layerIndexToEdit = 0; layerIndexToEdit < layers.length; layerIndexToEdit++) {
              timeline.currentLayer = op.ripple === true ? layerPosition(layers[layerIndexToEdit]) : layerIndex;
              timeline.removeFrames(spanStart + op.length, spanEnd);
            }
          }
        });
        if (op.ripple !== true) warnings.push('Only layer ' + layer.name + ' shifted; other layers were not shifted.');
      }
    }
  }

  /** Returns the final layer list.
   * @returns The current layers and their parent relationships.
   */
  function listLayers() {
    var result = [];
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      var layer = timeline.layers[layerIndex], entry = {
        name: layer.name,
        type: layer.layerType,
        locked: layer.locked === true
      };
      if (layer.parentLayer) entry.parent = layer.parentLayer.name;
      result.push(entry);
    }
    return result;
  }

  try {
    if (typeof __timelineRef === 'number') {
      timeline = document.timelines[__timelineRef];
      if (!timeline || Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0) throw new Error('Scene not found');
    } else {
      var itemFound = false;
      for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
        if (document.library.items[itemIndex].name === __timelineRef) itemFound = true;
      }
      if (!itemFound) throw new Error('Library item not found: ' + __timelineRef);
      document.library.editItem(__timelineRef);
      timeline = document.getTimeline();
    }

    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        if (op.op === 'addLayer' || op.op === 'deleteLayer' || op.op === 'moveLayer' || op.op === 'renameLayer' || op.op === 'setLayerType') {
          applyLayerOp(op);
        } else {
          applyFrameOp(op);
        }
        applied.push(op);
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
        for (var skippedIndex = opIndex + 1; skippedIndex < __ops.length; skippedIndex++) skipped.push(__ops[skippedIndex]);
        break;
      }
    }
  } finally {
    var warning = restore();
    if (warning) warnings.push(warning);
    var restoredTimeline = document.getTimeline();
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    restoredTimeline.currentFrame = originalFrame;
  }

  return serialize({ applied: applied, failed: failed, skipped: skipped, warnings: warnings, layers: listLayers() });
})();
