// @requires shared/edit-state, shared/export-common, timeline/helpers
/** Converts an ease specification to cubic Bezier handles.
 * @param ease Ease preset, custom handles, or legacy strength
 * @returns Four normalized cubic Bezier values
 */
function tweenEaseCurve(ease) {
  var curves = {
    linear: [0.25, 0.25, 0.75, 0.75],
    quadIn: [0.55, 0.085, 0.68, 0.53], quadOut: [0.25, 0.46, 0.45, 0.94], quadInOut: [0.455, 0.03, 0.515, 0.955],
    cubicIn: [0.55, 0.055, 0.675, 0.19], cubicOut: [0.215, 0.61, 0.355, 1], cubicInOut: [0.645, 0.045, 0.355, 1],
    quartIn: [0.895, 0.03, 0.685, 0.22], quartOut: [0.165, 0.84, 0.44, 1], quartInOut: [0.77, 0, 0.175, 1],
    quintIn: [0.755, 0.05, 0.855, 0.06], quintOut: [0.23, 1, 0.32, 1], quintInOut: [0.86, 0, 0.07, 1],
    sineIn: [0.47, 0, 0.745, 0.715], sineOut: [0.39, 0.575, 0.565, 1], sineInOut: [0.445, 0.05, 0.55, 0.95],
    expoIn: [0.95, 0.05, 0.795, 0.035], expoOut: [0.19, 1, 0.22, 1], expoInOut: [1, 0, 0, 1],
    circIn: [0.6, 0.04, 0.98, 0.335], circOut: [0.075, 0.82, 0.165, 1], circInOut: [0.785, 0.135, 0.15, 0.86],
    backIn: [0.6, -0.28, 0.735, 0.045], backOut: [0.175, 0.885, 0.32, 1.275], backInOut: [0.68, -0.55, 0.265, 1.55]
  };
  if (ease instanceof Array) return ease;
  if (typeof ease === 'number') {
    var strength = Math.abs(ease) / 100;
    if (ease > 0) return [0.333, 0.333 + strength * 0.667, 0.667, 1];
    if (ease < 0) return [0.333, 0, 0.667, 0.667 - strength * 0.667];
    return curves.linear;
  }
  return curves[ease] || curves.linear;
}

/** Resolves the ease for one keyframe property.
 * @param keyframe Keyframe descriptor
 * @param property Property name, or default
 * @returns Ease specification or undefined
 */
function tweenEaseFor(keyframe, property) {
  if (keyframe.ease instanceof Object && !(keyframe.ease instanceof Array)) {
    return keyframe.ease[property] !== undefined ? keyframe.ease[property] : keyframe.ease.default;
  }
  return keyframe.ease;
}

/** Checks whether an ease value is valid for a shape tween.
 * @param ease Ease value to check
 * @returns Whether the value is a finite number from -100 to 100
 */
function tweenIsShapeTweenEase(ease) {
  return typeof ease === 'number' && isFinite(ease) && ease >= -100 && ease <= 100;
}

/** Checks whether a frame belongs to a supported tween type.
 * @param tweenType Frame tween type
 * @returns Whether the tween type supports easing
 */
function tweenIsEaseableTweenType(tweenType) {
  return tweenType === 'motion' || tweenType === 'motion object' || tweenType === 'shape';
}

/** Compares ease specifications for classic tween group validation.
 * @param left First ease specification
 * @param right Second ease specification
 * @returns Whether the specifications are equivalent
 */
function tweenSameEase(left, right) {
  return serialize(tweenEaseCurve(left)) === serialize(tweenEaseCurve(right));
}

/** Validates that classic tween groups share one easing curve.
 * @param arrival Arriving keyframe descriptor
 * @returns Nothing
 */
function tweenValidateClassicEase(arrival) {
  var groups = [['position', ['x', 'y']], ['rotation', ['rotation']], ['scale', ['scaleX', 'scaleY']], ['color', ['alpha', 'brightness', 'tint']], ['filters', ['blur', 'glow', 'dropShadow']]];
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    var group = groups[groupIndex], ease = tweenEaseFor(arrival, group[1][0]);
    for (var propertyIndex = 1; propertyIndex < group[1].length; propertyIndex++) {
      if (!tweenSameEase(ease, tweenEaseFor(arrival, group[1][propertyIndex]))) throw new Error('Classic tweens ease x/y together');
    }
  }
}

/** Applies classic tween easing to a segment's frame.
 * @param frame Classic tween frame
 * @param arrival Arriving keyframe descriptor
 * @returns Nothing
 */
function tweenSetClassicEase(frame, arrival) {
  var groups = [
    ['position', ['x', 'y']], ['rotation', ['rotation']], ['scale', ['scaleX', 'scaleY']],
    ['color', ['alpha', 'brightness', 'tint']], ['filters', ['blur', 'glow', 'dropShadow']]
  ];
  var hasCustomEase = false;
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    var group = groups[groupIndex], ease = tweenEaseFor(arrival, group[1][0]);
    for (var propertyIndex = 1; propertyIndex < group[1].length; propertyIndex++) {
      var otherEase = tweenEaseFor(arrival, group[1][propertyIndex]);
      if (!tweenSameEase(ease, otherEase)) throw new Error('Classic tweens ease x/y together');
    }
    if (ease === undefined) continue;
    if (typeof ease === 'number') frame.tweenEasing = ease;
    else {
      frame.hasCustomEase = true;
      frame.useSingleEaseCurve = false;
      hasCustomEase = true;
      var curve = tweenEaseCurve(ease), points = [
        { x: 0, y: 0 }, { x: curve[0], y: curve[1] }, { x: curve[2], y: curve[3] }, { x: 1, y: 1 }
      ];
      frame.setCustomEase(group[0], points);
    }
  }
  if (hasCustomEase) frame.hasCustomEase = true;
}

/** Applies an ease to an existing tween segment.
 * @param timeline Timeline containing the tween.
 * @param document Current Animate document.
 * @param op tweenSetEase operation
 * @returns Nothing
 */
function tweenSetEase(timeline, document, op) {
  var layerIndex = findLayerIndex(timeline, op.layer, op.index), layer = timeline.layers[layerIndex], frameIndex = op.frame - 1;
  if (frameIndex < 0 || frameIndex >= timeline.frameCount || frameIndex >= layer.frames.length) throw new Error('Frame beyond timeline length');
  var frame = layer.frames[frameIndex], span = layer.frames[frame.startFrame], arrivalFrame = frameIndex;
  if (!span || !tweenIsEaseableTweenType(span.tweenType)) {
    var priorFrame = frameIndex - 1;
    if (priorFrame >= 0) {
      var prior = layer.frames[priorFrame], priorSpan = layer.frames[prior.startFrame];
      if (priorSpan && tweenIsEaseableTweenType(priorSpan.tweenType)) span = priorSpan;
    }
  }
  if (!span || !tweenIsEaseableTweenType(span.tweenType)) throw new Error('Frame is not inside a tween');
  if (span.tweenType === 'shape') {
    if (!tweenIsShapeTweenEase(op.ease)) throw new Error('Shape tween ease must be a number from -100 to 100');
    withEditUnlockedLayers([layer], function () {
      timeline.currentLayer = layerIndex;
      span.tweenEasing = op.ease;
    });
    return;
  }
  if (arrivalFrame <= span.startFrame) throw new Error('No tween segment arrives at this frame');
  /** Applies the ease while the target layer is unlocked.
   * @returns Nothing
   */
  withEditUnlockedLayers([layer], function () {
    timeline.currentLayer = layerIndex;
    if (span.tweenType === 'motion') {
      var arrival = { ease: op.ease };
      tweenSetClassicEase(span, arrival);
    } else {
      timeline.setSelectedFrames(span.startFrame, span.startFrame + 1);
      var xml = span.getMotionObjectXML();
      var updated = 0;
      var ids = [
        'Motion_X', 'Motion_Y', 'Rotation_Z', 'Scale_X', 'Scale_Y', 'Alpha_Amount', 'Brightness_Amount', 'Tint_Amount',
        'Blur_BlurX', 'Blur_BlurY', 'Glow_BlurX', 'Glow_BlurY', 'Glow_Strength', 'DropShadow_BlurX', 'DropShadow_BlurY',
        'DropShadow_Strength', 'DropShadow_Distance', 'DropShadow_Angle'
      ];
      for (var propertyIndex = 0; propertyIndex < ids.length; propertyIndex++) {
        var expression = new RegExp('(<Property[^>]*id="' + ids[propertyIndex] + '"[^>]*>)([\\s\\S]*?)(</Property>)');
        var match = expression.exec(xml);
        if (match) {
          var propertyFrames = match[2].match(/<Keyframe[^>]*\/>/g) || [];
          for (var xmlIndex = 0; xmlIndex < propertyFrames.length; xmlIndex++) {
            var timeScale = Number((xml.match(/TimeScale="([0-9]+)"/) || [])[1] || 24000);
            if (Number((propertyFrames[xmlIndex].match(/timevalue="([^"]+)"/) || [])[1]) === (arrivalFrame - span.startFrame) * timeScale / (document.frameRate || 24)) {
              var previous = propertyFrames[xmlIndex - 1] || propertyFrames[xmlIndex];
              var current = propertyFrames[xmlIndex], prevAnchor = Number((previous.match(/anchor="[^,]+,([^"]+)"/) || [])[1]);
              var currentAnchor = Number((current.match(/anchor="[^,]+,([^"]+)"/) || [])[1]);
              var curve = tweenEaseCurve(op.ease), deltaTime = Number((current.match(/timevalue="([^"]+)"/) || [])[1]) - Number((previous.match(/timevalue="([^"]+)"/) || [])[1]);
              var changedPrevious = previous.replace(/next="[^"]+"/, 'next="' + (deltaTime * curve[0]) + ',' + (prevAnchor + (currentAnchor - prevAnchor) * curve[1]) + '"');
              var changedCurrent = current.replace(/previous="[^"]+"/, 'previous="' + (-deltaTime * (1 - curve[2])) + ',' + (prevAnchor + (currentAnchor - prevAnchor) * curve[3]) + '"');
              propertyFrames[xmlIndex - 1] = changedPrevious;
              propertyFrames[xmlIndex] = changedCurrent;
              updated++;
              var frameCursor = 0;
              /** Rebuilds one property channel with its modified keyframe handles.
               * @param whole Whole property match
               * @param open Opening property tag
               * @param inner Property contents
               * @param close Closing property tag
               * @returns Rebuilt property channel
               */
              xml = xml.replace(expression, function (whole, open, inner, close) {
                var updatedInner = inner.replace(
                  /<Keyframe[^>]*\/>/g,
                  /** Returns the next updated keyframe in channel order.
                   * @returns Updated keyframe XML
                   */
                  function () { return propertyFrames[frameCursor++]; }
                );
                return open + updatedInner + close;
              });
              break;
            }
          }
        }
      }
      if (updated === 0) throw new Error('No tween keyframe at frame ' + op.frame);
      timeline.setSelectedFrames(span.startFrame, span.startFrame + 1);
      span.setMotionObjectXML(xml);
    }
  });
}
