// `var __timelineRef` (scene index or library item path) and `var __ops` are injected before this file.
/** Applies timeline operations and returns their results as JSON text.
 * @returns The serialized operation results.
 */
(function () {
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
    var parentIndex = findLayerIndex(name, undefined), parent = timeline.layers[parentIndex];
    var expectedType = layerType === 'masked' ? 'mask' : 'folder';
    if (parent.layerType !== expectedType) throw new Error('Parent must be a ' + expectedType + ' layer');
    return parent;
  }

  /** Verifies that relative placement does not put a child before its parent.
   * @param layerIndex The child's zero-based layer index.
   * @param parentLayer The parent layer to validate.
   * @returns Nothing.
   */
  function validateParentPosition(layerIndex, parentLayer) {
    if (!parentLayer) return;
    var parentIndex = layerPosition(parentLayer);
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
   * @returns Nothing.
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
   * @returns Nothing.
   */
  function rejectTweenRange(layers, frameIndex, count) {
    for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      for (var offset = 0; offset < count; offset++) rejectTween(layers[layerIndex], frameIndex + offset);
    }
  }
