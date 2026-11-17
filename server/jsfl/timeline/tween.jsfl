// @requires shared/select-document, shared/edit-state, shared/export-common, timeline/helpers, timeline/tween-easing, timeline/tween-helpers
(function () {
// `var __timelineRef` (scene index or library item path) and `var __ops` are injected before this file.
  var document = selectDocument(), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayerIndex = originalTimeline.currentLayer;
  var originalLayer = originalTimeline.layers[originalLayerIndex];
  var originalFrame = originalTimeline.currentFrame, applied = [], failed = null, skipped = [], warnings = [];
  var targetSelectedFramesAfter = null;

  /** Applies one createTween operation.
   * @param op createTween operation
   * @returns Nothing
   */
  function createTween(op) {
    var layerIndex = findLayerIndex(timeline, op.layer, op.index), layer = timeline.layers[layerIndex];
    var first = op.keyframes[0].frame - 1, last = op.keyframes[op.keyframes.length - 1].frame - 1, existingKind = null;
    if (last >= timeline.frameCount || last >= layer.frames.length) throw new Error('Frame beyond timeline length');
    for (var frameIndex = first; frameIndex <= last; frameIndex++) {
      var frame = layer.frames[frameIndex];
      if (!frame || !frame.elements || frame.elements.length !== 1 || !tweenFindInstance(frame, op.instance)) {
        throw new Error('Instance must be the only element on its layer; move it to its own layer');
      }
      var spanStart = frame.startFrame, span = layer.frames[spanStart];
      if (span && span.tweenType && span.tweenType !== 'none') {
        var currentKind = span.tweenType === 'motion' ? 'classic' : span.tweenType === 'motion object' ? 'motion' : null;
        if (currentKind && op.kind && currentKind !== op.kind) throw new Error('Tween kind differs from the existing tween kind');
        if (currentKind) existingKind = existingKind || currentKind;
        throw new Error('Span already has a tween; use setEase');
      }
    }
    var startElement = tweenFindInstance(layer.frames[first], op.instance), keyframes = tweenResolveKeyframes(op, startElement);
    var kind = op.kind || existingKind || 'motion';
    var colorModes = (tweenPropertyUsed(op, 'alpha') ? 1 : 0) + (tweenPropertyUsed(op, 'brightness') ? 1 : 0) + (tweenPropertyUsed(op, 'tint') ? 1 : 0);
    if (colorModes > 1) throw new Error('Animate supports only one of alpha, brightness, or tint per tween');
    if (kind === 'classic') {
      for (var easeIndex = 1; easeIndex < keyframes.length; easeIndex++) tweenValidateClassicEase(keyframes[easeIndex]);
    }
    /** Applies the tween while the target layer is unlocked.
     * @returns Nothing
     */
    withEditUnlockedLayers([layer], function () {
      timeline.currentLayer = layerIndex;
      if (kind === 'classic') {
        for (var insertIndex = keyframes.length - 1; insertIndex >= 0; insertIndex--) {
          var keyFrameIndex = keyframes[insertIndex].frame;
          if (layer.frames[keyFrameIndex].startFrame !== keyFrameIndex) timeline.convertToKeyframes(keyFrameIndex);
        }
        for (var stateIndex = 0; stateIndex < keyframes.length; stateIndex++) {
          var state = keyframes[stateIndex], currentElement = tweenFindInstance(layer.frames[state.frame], op.instance);
          if (!currentElement) throw new Error('Instance not found at frame ' + (state.frame + 1));
          tweenWriteState(timeline, document, currentElement, state.values, state.frame);
        }
        for (var segmentIndex = 0; segmentIndex < keyframes.length - 1; segmentIndex++) {
          var from = keyframes[segmentIndex].frame, to = keyframes[segmentIndex + 1].frame;
          timeline.createMotionTween(from, to);
          tweenSetClassicEase(layer.frames[from], keyframes[segmentIndex + 1]);
        }
      } else {
        if (layer.frames[first].startFrame !== first) timeline.convertToKeyframes(first);
        timeline.createMotionObject(first, last + 1);
        for (var motionStateIndex = 0; motionStateIndex < keyframes.length; motionStateIndex++) {
          var motionState = keyframes[motionStateIndex];
          tweenWriteState(timeline, document, tweenFindInstance(layer.frames[motionState.frame], op.instance), motionState.values, motionState.frame);
        }
        var activeFrame = layer.frames[first];
        timeline.setSelectedFrames(first, first + 1);
        var xml = activeFrame.getMotionObjectXML(), base = keyframes[0].values;
        var tracks = [
          ['Motion_X', 'x', 'x', 1, true], ['Motion_Y', 'y', 'y', 1, true], ['Rotation_Z', 'rotation', 'rotation', 1, true],
          ['Scale_X', 'scaleX', 'scaleX', 100, false], ['Scale_Y', 'scaleY', 'scaleY', 100, false],
          ['Alpha_Amount', 'alpha', 'alpha', 1, false], ['Brightness_Amount', 'brightness', 'brightness', 1, false],
          ['Tint_Amount', 'tint', 'tintAmount', 1, false], ['Blur_BlurX', 'blur', 'blurX', 1, false], ['Blur_BlurY', 'blur', 'blurY', 1, false],
          ['Glow_BlurX', 'glow', 'glowBlurX', 1, false], ['Glow_BlurY', 'glow', 'glowBlurY', 1, false], ['Glow_Strength', 'glow', 'glowStrength', 1, false],
          ['DropShadow_BlurX', 'dropShadow', 'shadowBlurX', 1, false], ['DropShadow_BlurY', 'dropShadow', 'shadowBlurY', 1, false],
          ['DropShadow_Strength', 'dropShadow', 'shadowStrength', 1, false], ['DropShadow_Distance', 'dropShadow', 'shadowDistance', 1, false],
          ['DropShadow_Angle', 'dropShadow', 'shadowAngle', 1, false]
        ];
        for (var trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
          var track = tracks[trackIndex];
          if (!tweenPropertyUsed(op, track[1])) continue;
          var points = [];
          for (var pointIndex = 0; pointIndex < keyframes.length; pointIndex++) {
            points.push({ frame: keyframes[pointIndex].frame, value: tweenMotionValue(keyframes[pointIndex], base, track[2], track[3], track[4]), source: keyframes[pointIndex] });
          }
          xml = tweenReplaceMotionChannel(xml, track[0], track[1], points, first, document.frameRate || 24);
        }
        var colorTracks = [
          ['Tint_Color', 'tint', 'tint', null], ['Glow_Color', 'glow', 'glowColor', 'glowAlpha'],
          ['DropShadow_Color', 'dropShadow', 'shadowColor', 'shadowAlpha']
        ];
        for (var colorTrackIndex = 0; colorTrackIndex < colorTracks.length; colorTrackIndex++) {
          var colorTrack = colorTracks[colorTrackIndex];
          if (!tweenPropertyUsed(op, colorTrack[1])) continue;
          var colorPoints = [];
          for (var colorPointIndex = 0; colorPointIndex < keyframes.length; colorPointIndex++) {
            var colorState = keyframes[colorPointIndex].values;
            colorPoints.push({ frame: keyframes[colorPointIndex].frame, value: tweenMotionColor(colorState[colorTrack[2]], colorTrack[3] ? colorState[colorTrack[3]] : 100) });
          }
          xml = tweenReplaceMotionColorChannel(xml, colorTrack[0], colorPoints, first, document.frameRate || 24);
        }
        timeline.setSelectedFrames(first, first + 1);
        activeFrame.setMotionObjectXML(xml);
      }
    });
  }

  /** Creates a shape tween between existing raw-shape keyframes.
   * @param op createShapeTween operation
   * @returns Nothing
   */
  function createShapeTween(op) {
    var layerIndex = findLayerIndex(timeline, op.layer, op.index), layer = timeline.layers[layerIndex];
    var first = op.from - 1, last = op.to - 1;
    var ease = op.ease === undefined ? 0 : op.ease, blend = op.blend === undefined ? 'distributive' : op.blend;
    if (first < 0 || last >= timeline.frameCount || last >= layer.frames.length) throw new Error('Frame beyond timeline length');
    if (first >= last) throw new Error('from must be less than to');
    if (!tweenIsShapeTweenEase(ease)) throw new Error('ease must be a number from -100 to 100');
    if (blend !== 'distributive' && blend !== 'angular') throw new Error('blend must be distributive or angular');
    for (var frameIndex = first; frameIndex < last; frameIndex++) {
      var frame = layer.frames[frameIndex];
      if (frame && frame.tweenType !== 'none') throw new Error('Span already has a tween; shape tweens do not replace existing spans');
    }
    var keyframes = [first, last];
    for (var keyIndex = 0; keyIndex < keyframes.length; keyIndex++) {
      var keyframeIndex = keyframes[keyIndex], keyframe = layer.frames[keyframeIndex];
      if (!keyframe || keyframe.startFrame !== keyframeIndex) {
        throw new Error('Frame ' + (keyframeIndex + 1) + ' must be an existing keyframe');
      }
      if (!keyframe.elements || keyframe.elements.length === 0) throw new Error('Frame ' + (keyframeIndex + 1) + ' must contain raw shapes');
      for (var elementIndex = 0; elementIndex < keyframe.elements.length; elementIndex++) {
        var element = keyframe.elements[elementIndex];
        if (element.elementType !== 'shape' || element.isGroup === true || element.isDrawingObject === true) {
          // unverified: true isGroup/isDrawingObject cases have not been verified in real Animate.
          throw new Error('Frame ' + (keyframeIndex + 1) + ' must contain only raw shapes (no groups, drawing objects, instances, or text)');
        }
      }
    }
    if (layer.frames[first].duration !== last - first) {
      throw new Error('Shape tween span cannot contain intermediate keyframes');
    }
    withEditUnlockedLayers([layer], function () {
      timeline.currentLayer = layerIndex;
      var startFrame = layer.frames[first];
      startFrame.tweenType = 'shape';
      startFrame.tweenEasing = ease;
      startFrame.shapeTweenBlend = blend;
    });
  }

  try {
    var session = withTimelineEdit(document, __timelineRef, /** Applies requested tween and easing operations.
     * @param targetTimeline Timeline selected for editing.
     * @returns Nothing.
     */
    function (targetTimeline) {
      timeline = targetTimeline;
    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        if (op.op === 'createTween') createTween(op);
        else if (op.op === 'createShapeTween') createShapeTween(op);
        else tweenSetEase(timeline, document, op);
        applied.push(op);
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
        warnings.push('Operation ' + (opIndex + 1) + ' (' + op.op + ') failed and may have been partially applied; check the timeline or use Undo.');
        for (var skippedIndex = opIndex + 1; skippedIndex < __ops.length; skippedIndex++) skipped.push(__ops[skippedIndex]);
        break;
      }
    }
      targetSelectedFramesAfter = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null;
    });
    warnings = warnings.concat(session.warnings);
    if (targetSelectedFramesAfter && timeline.setSelectedFrames) timeline.setSelectedFrames(targetSelectedFramesAfter);
  } finally {
    var restoredTimeline = document.getTimeline();
    // Restore by layer object identity because operations may reorder or remove layers.
    var restoredLayerIndex = editLayerPosition(restoredTimeline, originalLayer);
    if (restoredLayerIndex >= 0) restoredTimeline.currentLayer = restoredLayerIndex;
    else if (restoredTimeline.layers.length) restoredTimeline.currentLayer = Math.max(0, Math.min(originalLayerIndex, restoredTimeline.layers.length - 1));
    restoredTimeline.currentFrame = originalFrame;
  }
  return serialize({ applied: applied, failed: failed, skipped: skipped, warnings: warnings, layers: tweenListLayers(timeline) });
})();
