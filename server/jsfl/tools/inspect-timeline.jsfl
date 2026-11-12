// `var __docName`, `var __timelineRef`, `var __layers`, and `var __frame` are injected before this file.
(function () {
  var document = selectDocument(), restore = saveEditState(document), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
  var originalFrame = originalTimeline.currentFrame, originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var resultLayers = [], restoreWarning = '';

  /** Resolves the requested scene or library-symbol timeline.
   * @returns The selected timeline.
   */
  function resolveTimeline() {
    if (typeof __timelineRef === 'number') {
      var scene = document.timelines[__timelineRef];
      if (!scene || Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0) throw new Error('Scene not found');
      return scene;
    }
    var found = false;
    for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
      if (document.library.items[itemIndex].name === __timelineRef) found = true;
    }
    if (!found) throw new Error('Library item not found: ' + __timelineRef);
    document.library.editItem(__timelineRef);
    return document.getTimeline();
  }

  /** Resolves optional layer names or indexes, defaulting to every layer.
   * @returns Selected layer indexes in request order.
   */
  function requestedLayerIndexes() {
    var indexes = [];
    if (__layers === undefined) {
      for (var allIndex = 0; allIndex < timeline.layers.length; allIndex++) indexes.push(allIndex);
      return indexes;
    }
    for (var requestIndex = 0; requestIndex < __layers.length; requestIndex++) {
      var requested = __layers[requestIndex], found = -1, matches = 0;
      if (typeof requested === 'number') {
        if (Math.floor(requested) !== requested || requested < 0 || requested >= timeline.layers.length) throw new Error('Layer index not found: ' + requested);
        found = requested;
      } else {
        for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
          if (timeline.layers[layerIndex].name === requested) {
            found = layerIndex;
            matches++;
          }
        }
        if (matches === 0) throw new Error('Layer not found: ' + requested);
        if (matches > 1) throw new Error('Layer name is ambiguous: ' + requested);
      }
      indexes.push(found);
    }
    return indexes;
  }

  /** Maps Animate tween type strings to the public inspection values.
   * @param tweenType Animate's native tween type.
   * @returns The normalized tween type.
   */
  function normalizedTweenType(tweenType) {
    if (tweenType === 'motion object') return 'motion';
    if (tweenType === 'motion') return 'classic';
    return 'none';
  }

  /** Copies a filter's main serializable parameters.
   * @param filter Animate filter instance.
   * @returns A plain filter description.
   */
  function readFilter(filter) {
    var result = { name: filter.name, enabled: filter.enabled !== false }, properties = [];
    if (filter.name === 'blurFilter') properties = ['blurX', 'blurY', 'quality'];
    else if (filter.name === 'glowFilter') properties = ['blurX', 'blurY', 'color', 'alpha', 'strength', 'quality', 'inner', 'knockout'];
    else if (filter.name === 'dropShadowFilter') properties = ['blurX', 'blurY', 'color', 'alpha', 'strength', 'quality', 'distance', 'angle', 'inner', 'knockout', 'hideObject'];
    else if (filter.name === 'bevelFilter') properties = ['blurX', 'blurY', 'shadowColor', 'shadowAlpha', 'highlightColor', 'highlightAlpha', 'strength', 'quality', 'distance', 'angle', 'knockout', 'type'];
    else if (filter.name === 'gradientGlowFilter' || filter.name === 'gradientBevelFilter') {
      properties = ['blurX', 'blurY', 'colors', 'alphas', 'ratios', 'strength', 'quality', 'distance', 'angle', 'knockout', 'type'];
    } else if (filter.name === 'adjustColorFilter') properties = ['brightness', 'contrast', 'saturation', 'hue'];
    for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      var property = properties[propertyIndex];
      if (filter[property] !== undefined) result[property] = filter[property];
    }
    return result;
  }

  /** Reads one instance, shape, text, or bitmap element.
   * @param element Animate timeline element.
   * @returns A plain element description.
   */
  function readElement(element) {
    var libraryItem = element.libraryItem || null, transformationPoint = null, filters = [], matrix = null;
    if (element.matrix) matrix = {
      a: element.matrix.a,
      b: element.matrix.b,
      c: element.matrix.c,
      d: element.matrix.d,
      tx: element.matrix.tx,
      ty: element.matrix.ty
    };
    var point = element.getTransformationPoint ? element.getTransformationPoint() : element.transformationPoint;
    var colorMode = element.colorMode || 'none', colorEffect = {
      mode: colorMode,
      alphaPercent: element.colorAlphaPercent,
      alphaAmount: element.colorAlphaAmount
    };
    if (colorMode === 'brightness') colorEffect.brightnessPercent = element.brightness;
    if (colorMode === 'tint') {
      colorEffect.tintColor = element.tintColor;
      colorEffect.tintPercent = element.tintPercent;
    }
    if (colorMode === 'advanced') {
      colorEffect.redPercent = element.colorRedPercent;
      colorEffect.greenPercent = element.colorGreenPercent;
      colorEffect.bluePercent = element.colorBluePercent;
      colorEffect.redAmount = element.colorRedAmount;
      colorEffect.greenAmount = element.colorGreenAmount;
      colorEffect.blueAmount = element.colorBlueAmount;
    }
    if (point) transformationPoint = { x: Number(point.x || 0), y: Number(point.y || 0) };
    for (var filterIndex = 0; filterIndex < (element.filters || []).length; filterIndex++) filters.push(readFilter(element.filters[filterIndex]));
    return {
      type: libraryItem ? libraryItem.itemType : element.elementType,
      name: element.name || '',
      libraryItem: libraryItem ? libraryItem.name : '',
      matrix: matrix,
      x: Number(element.x || 0),
      y: Number(element.y || 0),
      transformationPoint: transformationPoint,
      scaleX: Number(element.scaleX === undefined ? 1 : element.scaleX),
      scaleY: Number(element.scaleY === undefined ? 1 : element.scaleY),
      rotation: Number(element.rotation || 0),
      skewX: Number(element.skewX || 0),
      skewY: Number(element.skewY || 0),
      colorEffect: colorEffect,
      filters: filters,
      blendMode: element.blendMode || 'normal'
    };
  }

  /** Reads keyframe property values stored in a motion-object XML channel.
   * @param frame Animate motion-tween keyframe.
   * @param startFrame Zero-based start of the motion span.
   * @returns Motion keyframes with 1-based frame positions and property values.
   */
  function readMotionKeyframes(frame, startFrame) {
    timeline.setSelectedFrames(startFrame, startFrame + 1);
    var xml = String(frame.getMotionObjectXML()), timeScaleMatch = xml.match(/TimeScale="([0-9]+)"/);
    var timeScale = timeScaleMatch ? Number(timeScaleMatch[1]) : 24000;
    var channels = {}, propertyExpression = /<Property\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/Property>/g, propertyMatch;
    while ((propertyMatch = propertyExpression.exec(xml))) {
      var propertyId = propertyMatch[1], keyframeExpression = /<Keyframe\b([^>]*)\/>/g, keyframeMatch;
      while ((keyframeMatch = keyframeExpression.exec(propertyMatch[2]))) {
        var timeMatch = keyframeMatch[1].match(/timevalue="([^"]+)"/), anchorMatch = keyframeMatch[1].match(/anchor="[^,]*,([^"]+)"/);
        var valueMatch = keyframeMatch[1].match(/value="([^"]+)"/);
        var time = timeMatch ? Number(timeMatch[1]) : 0;
        var frameNumber = startFrame + Math.round(time * (document.frameRate || 24) / timeScale) + 1;
        var value = anchorMatch ? anchorMatch[1] : valueMatch ? valueMatch[1] : '';
        if (!channels[frameNumber]) channels[frameNumber] = { frame: frameNumber, values: {} };
        channels[frameNumber].values[propertyId] = value;
      }
    }
    var result = [];
    for (var frameKey in channels) result.push(channels[frameKey]);
    result.sort(
      /** Sorts motion keyframes into frame order.
       * @param left Earlier keyframe candidate.
       * @param right Later keyframe candidate.
       * @returns Relative frame order.
       */
      function (left, right) { return left.frame - right.frame; }
    );
    return result;
  }

  /** Inspects one timeline layer and the requested frame's elements.
   * @param layerIndex Zero-based layer index.
   * @param requestedFrame Zero-based requested frame.
   * @returns Layer metadata, spans, and frame elements.
   */
  function inspectLayer(layerIndex, requestedFrame) {
    var layer = timeline.layers[layerIndex], spans = [], motionKeyframes = [], frameElements = [];
    for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) {
      var frame = layer.frames[frameIndex];
      if (!frame || frame.startFrame !== frameIndex) continue;
      var tweenType = normalizedTweenType(frame.tweenType), span = {
        start: frame.startFrame + 1,
        end: frame.startFrame + frame.duration,
        keyframe: true,
        tweenType: tweenType
      };
      if (frame.name) span.label = frame.name;
      spans.push(span);
      if (tweenType === 'motion') {
        timeline.currentLayer = layerIndex;
        var motionValues = readMotionKeyframes(frame, frame.startFrame);
        for (var motionIndex = 0; motionIndex < motionValues.length; motionIndex++) motionKeyframes.push(motionValues[motionIndex]);
      }
    }
    if (requestedFrame < layer.frames.length) {
      var currentFrame = layer.frames[requestedFrame], currentSpan = currentFrame && layer.frames[currentFrame.startFrame];
      var elementFrame = currentSpan && currentSpan.tweenType && currentSpan.tweenType !== 'none' ? currentSpan : currentFrame;
      for (var elementIndex = 0; elementIndex < ((elementFrame && elementFrame.elements) || []).length; elementIndex++) {
        frameElements.push(readElement(elementFrame.elements[elementIndex]));
      }
    }
    var result = {
      name: layer.name,
      index: layerIndex,
      type: layer.layerType,
      parent: layer.parentLayer ? layer.parentLayer.name : null,
      locked: layer.locked === true,
      visible: layer.visible !== false,
      frameCount: layer.frames.length,
      spans: spans,
      elements: frameElements
    };
    if (motionKeyframes.length) result.motionKeyframes = motionKeyframes;
    return result;
  }

  try {
    timeline = resolveTimeline();
    var indexes = requestedLayerIndexes(), frameIndex = __frame - 1;
    for (var requestIndex = 0; requestIndex < indexes.length; requestIndex++) resultLayers.push(inspectLayer(indexes[requestIndex], frameIndex));
  } finally {
    restoreWarning = restore();
    var restoredTimeline = document.getTimeline();
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    if (originalSelectedFrames && restoredTimeline.setSelectedFrames) restoredTimeline.setSelectedFrames(originalSelectedFrames);
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    restoredTimeline.currentFrame = originalFrame;
  }
  var result = { timeline: __timelineRef, frame: __frame, layers: resultLayers };
  if (restoreWarning) result.warning = restoreWarning;
  return serialize(result);
})();
