  /** Moves a layer's full frame sequence while preserving its original keyframe spans.
   * @param layerIndex The layer's zero-based index.
   * @param layer The layer whose frames to move.
   * @param offset The number of frames to shift the layer forward.
   * @returns Nothing.
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
    /** Cuts and pastes the layer's frames at the requested offset.
     * @returns Nothing.
     */
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
  /** Applies a frame operation.
   * @param op The frame operation to apply.
   * @returns Nothing.
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
      /** Inserts or removes frames on the affected layers.
       * @returns Nothing.
       */
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
      /** Converts the selected frame to a keyframe.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () {
        timeline.currentLayer = layerIndex;
        timeline.convertToKeyframes(frameIndex);
      });
      return;
    }
    if (op.op === 'clearKeyframe') {
      rejectTween(layer, frameIndex);
      if (layer.frames[frameIndex].startFrame !== frameIndex) throw new Error('Frame is not a keyframe');
      /** Clears the selected keyframe.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () {
        timeline.currentLayer = layerIndex;
        timeline.clearKeyframes(frameIndex);
      });
      return;
    }
    if (op.op === 'setLabel') {
      /** Sets the selected frame's label.
       * @returns Nothing.
       */
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
        /** Resizes the selected frame span.
         * @returns Nothing.
         */
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
