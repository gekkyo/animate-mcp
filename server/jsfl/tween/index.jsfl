// `var __timelineRef` (scene index or library item path) and `var __ops` are injected before this file.
  var document = selectDocument(), restore = saveEditState(document), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
  var originalFrame = originalTimeline.currentFrame, applied = [], failed = null, skipped = [], warnings = [];

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

  /** Converts an ease specification to cubic Bezier handles.
   * @param ease Ease preset, custom handles, or legacy strength
   * @returns Four normalized cubic Bezier values
   */
  function easeCurve(ease) {
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
  function easeFor(keyframe, property) {
    if (keyframe.ease instanceof Object && !(keyframe.ease instanceof Array)) {
      return keyframe.ease[property] !== undefined ? keyframe.ease[property] : keyframe.ease.default;
    }
    return keyframe.ease;
  }

  /** Returns an element matching an instance name on a frame.
   * @param frame Animate frame
   * @param instanceName Instance name
   * @returns The matching element or null
   */
  function findInstance(frame, instanceName) {
    if (!frame || !frame.elements) return null;
    for (var elementIndex = 0; elementIndex < frame.elements.length; elementIndex++) {
      if (frame.elements[elementIndex].name === instanceName) return frame.elements[elementIndex];
    }
    return null;
  }

  /** Reads the starting property values for an instance.
   * @param element Animate instance
   * @returns The normalized starting values
   */
  function readState(element) {
    var state = {
      x: Number(element.x || 0), y: Number(element.y || 0), rotation: Number(element.rotation || 0),
      scaleX: Number(element.scaleX === undefined ? 1 : element.scaleX), scaleY: Number(element.scaleY === undefined ? 1 : element.scaleY),
      alpha: Number(element.colorAlphaPercent === undefined ? 100 : element.colorAlphaPercent),
      brightness: Number(element.colorMode === 'brightness' ? element.brightness || 0 : 0), tint: element.color || '#000000', tintAmount: Number(element.colorTintPercent || 0),
      blurX: 0, blurY: 0, blurQuality: 1, glowBlurX: 0, glowBlurY: 0, glowColor: '#ff0000', glowAlpha: 100,
      glowStrength: 0, glowQuality: 1, glowInner: false, glowKnockout: false,
      shadowBlurX: 0, shadowBlurY: 0, shadowColor: '#000000', shadowAlpha: 100, shadowStrength: 0,
      shadowQuality: 1, shadowDistance: 0, shadowAngle: 45, shadowInner: false, shadowKnockout: false, shadowHideObject: false
    };
    for (var filterIndex = 0; filterIndex < (element.filters || []).length; filterIndex++) {
      var filter = element.filters[filterIndex], quality = filter.quality === 'high' ? 3 : filter.quality === 'medium' ? 2 : Number(filter.quality || 1);
      if (filter.name === 'blurFilter') { state.blurX = Number(filter.blurX || 0); state.blurY = Number(filter.blurY || 0); state.blurQuality = quality; }
      if (filter.name === 'glowFilter') {
        state.glowBlurX = Number(filter.blurX || 0); state.glowBlurY = Number(filter.blurY || 0); state.glowColor = filter.color || state.glowColor;
        state.glowStrength = Number(filter.strength || 0); state.glowQuality = quality; state.glowInner = filter.inner === true; state.glowKnockout = filter.knockout === true;
      }
      if (filter.name === 'dropShadowFilter') {
        state.shadowBlurX = Number(filter.blurX || 0); state.shadowBlurY = Number(filter.blurY || 0); state.shadowColor = filter.color || state.shadowColor;
        state.shadowStrength = Number(filter.strength || 0); state.shadowQuality = quality; state.shadowDistance = Number(filter.distance || 0);
        state.shadowAngle = Number(filter.angle || 0); state.shadowInner = filter.inner === true; state.shadowKnockout = filter.knockout === true; state.shadowHideObject = filter.hideObject === true;
      }
    }
    return state;
  }

  /** Applies keyframe values to one selected Animate instance.
   * @param element Animate instance
   * @param values Resolved property values
   * @param frameIndex Zero-based frame index
   * @returns Nothing
   */
  function writeState(element, values, frameIndex) {
    var properties = values.properties;
    timeline.currentFrame = frameIndex;
    document.selectNone();
    element.selected = true;
    var currentX = Number(element.x || 0), currentY = Number(element.y || 0);
    if (properties.x || properties.y) document.moveSelectionBy({ x: properties.x ? values.x - currentX : 0, y: properties.y ? values.y - currentY : 0 });
    if (properties.scaleX || properties.scaleY) {
      var scaleX = Number(element.scaleX === undefined ? 1 : element.scaleX), scaleY = Number(element.scaleY === undefined ? 1 : element.scaleY);
      document.scaleSelection(properties.scaleX ? values.scaleX / scaleX : 1, properties.scaleY ? values.scaleY / scaleY : 1);
    }
    if (properties.rotation) document.rotateSelection(values.rotation - Number(element.rotation || 0));
    if (properties.alpha) {
      document.setInstanceAlpha(values.alpha);
    }
    if (properties.brightness) {
      document.setInstanceBrightness(values.brightness);
    }
    if (properties.tint) {
      document.setInstanceTint(values.tint, values.tintAmount);
    }
    var filters = element.filters || [];
    /** Adds or replaces one filter on the instance.
     * @param name Animate filter name
     * @param filter Filter properties
     * @returns Nothing
     */
    function putFilter(name, filter) {
      for (var filterIndex = 0; filterIndex < filters.length; filterIndex++) {
        if (filters[filterIndex].name === name) {
          filters[filterIndex].blurX = filter.blurX;
          filters[filterIndex].blurY = filter.blurY;
          if (filter.color !== undefined) filters[filterIndex].color = filter.color;
          if (filter.strength !== undefined) filters[filterIndex].strength = filter.strength;
          if (filter.distance !== undefined) filters[filterIndex].distance = filter.distance;
          if (filter.angle !== undefined) filters[filterIndex].angle = filter.angle;
          if (filter.quality !== undefined) filters[filterIndex].quality = filter.quality <= 1 ? 'low' : filter.quality === 2 ? 'medium' : 'high';
          if (filter.inner !== undefined) filters[filterIndex].inner = filter.inner;
          if (filter.knockout !== undefined) filters[filterIndex].knockout = filter.knockout;
          if (filter.hideObject !== undefined) filters[filterIndex].hideObject = filter.hideObject;
          return;
        }
      }
      document.addFilter(name);
      filters = element.filters || [];
      for (var addedIndex = 0; addedIndex < filters.length; addedIndex++) {
        if (filters[addedIndex].name === name) {
          filters[addedIndex].blurX = filter.blurX;
          filters[addedIndex].blurY = filter.blurY;
          if (filter.color !== undefined) filters[addedIndex].color = filter.color;
          if (filter.strength !== undefined) filters[addedIndex].strength = filter.strength;
          if (filter.distance !== undefined) filters[addedIndex].distance = filter.distance;
          if (filter.angle !== undefined) filters[addedIndex].angle = filter.angle;
          return;
        }
      }
    }
    if (properties.blur) putFilter('blurFilter', { blurX: values.blurX, blurY: values.blurY, quality: values.blurQuality || 1 });
    if (properties.glow) putFilter('glowFilter', { blurX: values.glowBlurX, blurY: values.glowBlurY, color: values.glowColor, alpha: values.glowAlpha, strength: values.glowStrength, quality: values.glowQuality, inner: values.glowInner, knockout: values.glowKnockout });
    if (properties.dropShadow) putFilter('dropShadowFilter', { blurX: values.shadowBlurX, blurY: values.shadowBlurY, color: values.shadowColor, alpha: values.shadowAlpha, strength: values.shadowStrength, quality: values.shadowQuality, distance: values.shadowDistance, angle: values.shadowAngle, inner: values.shadowInner, knockout: values.shadowKnockout, hideObject: values.shadowHideObject });
    if (filters.length) element.filters = filters;
  }

  /** Resolves accumulated values at each requested frame.
   * @param op createTween operation
   * @param startElement Instance at the first keyframe
   * @returns Resolved keyframe states
   */
  function resolveKeyframes(op, startElement) {
    var state = readState(startElement), properties = {}, result = [], previousFrame = 0;
    for (var keyIndex = 0; keyIndex < op.keyframes.length; keyIndex++) {
      var key = op.keyframes[keyIndex];
      if (key.frame <= previousFrame) throw new Error('Keyframes must be in strictly increasing frame order');
      if (key.x !== undefined && key.dx !== undefined) throw new Error('Specify only one of x or dx for a keyframe');
      if (key.y !== undefined && key.dy !== undefined) throw new Error('Specify only one of y or dy for a keyframe');
      if (key.x !== undefined) { state.x = key.x; properties.x = true; }
      if (key.dx !== undefined) { state.x += key.dx; properties.x = true; }
      if (key.y !== undefined) { state.y = key.y; properties.y = true; }
      if (key.dy !== undefined) { state.y += key.dy; properties.y = true; }
      if (key.scaleX !== undefined) { state.scaleX = key.scaleX; properties.scaleX = true; }
      if (key.scaleY !== undefined) { state.scaleY = key.scaleY; properties.scaleY = true; }
      if (key.rotation !== undefined) { state.rotation = key.rotation; properties.rotation = true; }
      if (key.alpha !== undefined) { state.alpha = key.alpha; properties.alpha = true; }
      if (key.brightness !== undefined) { state.brightness = key.brightness; properties.brightness = true; }
      if (key.tint) { state.tint = key.tint.color; state.tintAmount = key.tint.amount; properties.tint = true; }
      if (key.blur) {
        if (key.blur.x !== undefined) state.blurX = key.blur.x;
        if (key.blur.y !== undefined) state.blurY = key.blur.y;
        if (key.blur.quality !== undefined) state.blurQuality = key.blur.quality;
        properties.blur = true;
      }
      if (key.glow) {
        if (key.glow.blurX !== undefined || key.glow.x !== undefined) state.glowBlurX = key.glow.blurX === undefined ? key.glow.x : key.glow.blurX;
        if (key.glow.blurY !== undefined || key.glow.y !== undefined) state.glowBlurY = key.glow.blurY === undefined ? key.glow.y : key.glow.blurY;
        if (key.glow.color !== undefined) state.glowColor = key.glow.color;
        if (key.glow.alpha !== undefined) state.glowAlpha = key.glow.alpha;
        if (key.glow.strength !== undefined) state.glowStrength = key.glow.strength;
        if (key.glow.quality !== undefined) state.glowQuality = key.glow.quality;
        state.glowInner = key.glow.inner === true; state.glowKnockout = key.glow.knockout === true;
        properties.glow = true;
      }
      if (key.dropShadow) {
        if (key.dropShadow.blurX !== undefined || key.dropShadow.x !== undefined) state.shadowBlurX = key.dropShadow.blurX === undefined ? key.dropShadow.x : key.dropShadow.blurX;
        if (key.dropShadow.blurY !== undefined || key.dropShadow.y !== undefined) state.shadowBlurY = key.dropShadow.blurY === undefined ? key.dropShadow.y : key.dropShadow.blurY;
        if (key.dropShadow.color !== undefined) state.shadowColor = key.dropShadow.color;
        if (key.dropShadow.alpha !== undefined) state.shadowAlpha = key.dropShadow.alpha;
        if (key.dropShadow.strength !== undefined) state.shadowStrength = key.dropShadow.strength;
        if (key.dropShadow.quality !== undefined) state.shadowQuality = key.dropShadow.quality;
        if (key.dropShadow.distance !== undefined) state.shadowDistance = key.dropShadow.distance;
        if (key.dropShadow.angle !== undefined) state.shadowAngle = key.dropShadow.angle;
        state.shadowInner = key.dropShadow.inner === true; state.shadowKnockout = key.dropShadow.knockout === true;
        state.shadowHideObject = key.dropShadow.hideObject === true;
        properties.dropShadow = true;
      }
      var propertyState = {};
      for (var propertyName in properties) propertyState[propertyName] = properties[propertyName];
      result.push({ frame: key.frame - 1, ease: key.ease, values: {
        x: state.x, y: state.y, rotation: state.rotation, scaleX: state.scaleX, scaleY: state.scaleY,
        alpha: state.alpha, brightness: state.brightness, tint: state.tint, tintAmount: state.tintAmount,
        blurX: state.blurX, blurY: state.blurY, blurQuality: state.blurQuality,
        glowBlurX: state.glowBlurX, glowBlurY: state.glowBlurY, glowColor: state.glowColor, glowAlpha: state.glowAlpha,
        glowStrength: state.glowStrength, glowQuality: state.glowQuality, glowInner: state.glowInner, glowKnockout: state.glowKnockout,
        shadowBlurX: state.shadowBlurX, shadowBlurY: state.shadowBlurY, shadowColor: state.shadowColor, shadowAlpha: state.shadowAlpha,
        shadowStrength: state.shadowStrength, shadowQuality: state.shadowQuality, shadowDistance: state.shadowDistance,
        shadowAngle: state.shadowAngle, shadowInner: state.shadowInner, shadowKnockout: state.shadowKnockout, shadowHideObject: state.shadowHideObject,
        properties: propertyState
      } });
      previousFrame = key.frame;
    }
    return result;
  }

  /** Formats an XML attribute value.
   * @param value Attribute text
   * @returns XML-escaped attribute text
   */
  function xmlEscape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Checks whether any keyframe specifies a property.
   * @param op createTween operation
   * @param property Property name
   * @returns Whether the operation animates the property
   */
  function propertyUsed(op, property) {
    for (var keyIndex = 0; keyIndex < op.keyframes.length; keyIndex++) {
      var key = op.keyframes[keyIndex];
      if (property === 'x' && (key.x !== undefined || key.dx !== undefined)) return true;
      if (property === 'y' && (key.y !== undefined || key.dy !== undefined)) return true;
      if (key[property] !== undefined) return true;
    }
    return false;
  }

  /** Replaces the keyframes in a Motion Editor property channel.
   * @param xml Original motion XML
   * @param propertyId Motion Editor property id
   * @param values Property values at each keyframe
   * @param easeProperty Easing property name
   * @param startFrame Zero-based first frame
   * @param frameRate Document frame rate
   * @returns Updated motion XML
   */
  function replaceMotionChannel(xml, propertyId, easeProperty, values, startFrame, frameRate) {
    var expression = new RegExp('(<Property[^>]*id="' + propertyId + '"[^>]*>)([\\s\\S]*?)(</Property>)');
    var match = expression.exec(xml);
    if (!match) throw new Error('Motion property not available: ' + propertyId);
    var propertyFrames = [], timeScaleMatch = xml.match(/TimeScale="([0-9]+)"/);
    var timeScale = timeScaleMatch ? Number(timeScaleMatch[1]) : 24000, unitsPerFrame = timeScale / frameRate;
    var track = values;
    for (var keyIndex = 0; keyIndex < track.length; keyIndex++) {
      var current = track[keyIndex], incoming = keyIndex > 0 ? track[keyIndex - 1] : current;
      var outgoing = keyIndex + 1 < track.length ? track[keyIndex + 1] : current;
      var incomingCurve = easeCurve(easeFor(current.source || {}, easeProperty));
      var outgoingCurve = easeCurve(easeFor(outgoing.source || {}, easeProperty));
      var value = current.value, nextX = (outgoing.frame - current.frame) * unitsPerFrame * outgoingCurve[0];
      var nextY = value + (outgoing.value - value) * outgoingCurve[1];
      var previousX = -(current.frame - incoming.frame) * unitsPerFrame * (1 - incomingCurve[2]);
      var previousY = incoming.value + (current.value - incoming.value) * incomingCurve[3];
      var time = (current.frame - startFrame) * unitsPerFrame;
      propertyFrames.push('<Keyframe anchor="0,' + xmlEscape(value) + '" next="' + xmlEscape(nextX) + ',' + xmlEscape(nextY) + '" previous="' + xmlEscape(previousX) + ',' + xmlEscape(previousY) + '" roving="0" timevalue="' + xmlEscape(time) + '"/>');
    }
    return xml.slice(0, match.index) + match[1] + propertyFrames.join('') + match[3] + xml.slice(match.index + match[0].length);
  }

  /** Replaces a color channel's keyframes in Motion Editor XML.
   * @param xml Original motion XML
   * @param propertyId Motion Editor color property id
   * @param values Color values at each keyframe
   * @param startFrame Zero-based first frame
   * @param frameRate Document frame rate
   * @returns Updated motion XML
   */
  function replaceMotionColorChannel(xml, propertyId, values, startFrame, frameRate) {
    var expression = new RegExp('(<Property[^>]*id="' + propertyId + '"[^>]*>)([\\s\\S]*?)(</Property>)');
    var match = expression.exec(xml);
    if (!match) throw new Error('Motion property not available: ' + propertyId);
    var timeScaleMatch = xml.match(/TimeScale="([0-9]+)"/), timeScale = timeScaleMatch ? Number(timeScaleMatch[1]) : 24000;
    var unitsPerFrame = timeScale / frameRate, propertyFrames = [];
    for (var keyIndex = 0; keyIndex < values.length; keyIndex++) {
      var value = values[keyIndex];
      propertyFrames.push('<Keyframe roving="0" timevalue="' + ((value.frame - startFrame) * unitsPerFrame) + '" value="' + xmlEscape(value.value) + '"/>');
    }
    return xml.slice(0, match.index) + match[1] + propertyFrames.join('') + match[3] + xml.slice(match.index + match[0].length);
  }

  /** Converts a CSS-style hex color and opacity to Motion Editor color notation.
   * @param color Hex color string
   * @param alpha Opacity percent
   * @returns Eight-digit Animate color value
   */
  function motionColor(color, alpha) {
    var hex = String(color || '#000000').replace(/^#|^0x/i, '');
    while (hex.length < 6) hex = '0' + hex;
    var opacity = Math.round(Math.max(0, Math.min(100, Number(alpha))) * 255 / 100).toString(16);
    if (opacity.length < 2) opacity = '0' + opacity;
    return '0x' + hex.slice(-6).toLowerCase() + opacity;
  }

  /** Returns a numeric Motion Editor channel value.
   * @param item Resolved keyframe state
   * @param base Initial tween state
   * @param field State property to read
   * @param multiplier Unit conversion factor
   * @param relative Whether the channel is relative to its starting value
   * @returns Channel value
   */
  function motionValue(item, base, field, multiplier, relative) {
    var value = Number(item.values[field]) * multiplier;
    return relative ? value - Number(base[field]) * multiplier : value;
  }

  /** Applies one createTween operation.
   * @param op createTween operation
   * @returns Nothing
   */
  function createTween(op) {
    var layerIndex = findLayerIndex(op.layer, op.index), layer = timeline.layers[layerIndex];
    var first = op.keyframes[0].frame - 1, last = op.keyframes[op.keyframes.length - 1].frame - 1, existingKind = null;
    if (last >= timeline.frameCount || last >= layer.frames.length) throw new Error('Frame beyond timeline length');
    for (var frameIndex = first; frameIndex <= last; frameIndex++) {
      var frame = layer.frames[frameIndex];
      if (!frame || !frame.elements || frame.elements.length !== 1 || !findInstance(frame, op.instance)) {
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
    var startElement = findInstance(layer.frames[first], op.instance), keyframes = resolveKeyframes(op, startElement);
    var kind = op.kind || existingKind || 'motion';
    var colorModes = (propertyUsed(op, 'alpha') ? 1 : 0) + (propertyUsed(op, 'brightness') ? 1 : 0) + (propertyUsed(op, 'tint') ? 1 : 0);
    if (colorModes > 1) throw new Error('Animate supports only one of alpha, brightness, or tint per tween');
    if (kind === 'classic') {
      for (var easeIndex = 1; easeIndex < keyframes.length; easeIndex++) validateClassicEase(keyframes[easeIndex]);
    }
    /** Applies the tween while the target layer is unlocked.
     * @returns Nothing
     */
    withUnlockedLayers([layer], function () {
      timeline.currentLayer = layerIndex;
      if (kind === 'classic') {
        for (var insertIndex = keyframes.length - 1; insertIndex >= 0; insertIndex--) {
          var keyFrameIndex = keyframes[insertIndex].frame;
          if (layer.frames[keyFrameIndex].startFrame !== keyFrameIndex) timeline.convertToKeyframes(keyFrameIndex);
        }
        for (var stateIndex = 0; stateIndex < keyframes.length; stateIndex++) {
          var state = keyframes[stateIndex], currentElement = findInstance(layer.frames[state.frame], op.instance);
          if (!currentElement) throw new Error('Instance not found at frame ' + (state.frame + 1));
          writeState(currentElement, state.values, state.frame);
        }
        for (var segmentIndex = 0; segmentIndex < keyframes.length - 1; segmentIndex++) {
          var from = keyframes[segmentIndex].frame, to = keyframes[segmentIndex + 1].frame;
          timeline.createMotionTween(from, to);
          setClassicEase(layer.frames[from], keyframes[segmentIndex + 1]);
        }
      } else {
        if (layer.frames[first].startFrame !== first) timeline.convertToKeyframes(first);
        timeline.createMotionObject(first, last + 1);
        for (var motionStateIndex = 0; motionStateIndex < keyframes.length; motionStateIndex++) {
          var motionState = keyframes[motionStateIndex];
          writeState(findInstance(layer.frames[motionState.frame], op.instance), motionState.values, motionState.frame);
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
          if (!propertyUsed(op, track[1])) continue;
          var points = [];
          for (var pointIndex = 0; pointIndex < keyframes.length; pointIndex++) {
            points.push({ frame: keyframes[pointIndex].frame, value: motionValue(keyframes[pointIndex], base, track[2], track[3], track[4]), source: keyframes[pointIndex] });
          }
          xml = replaceMotionChannel(xml, track[0], track[1], points, first, document.frameRate || 24);
        }
        var colorTracks = [
          ['Tint_Color', 'tint', 'tint', null], ['Glow_Color', 'glow', 'glowColor', 'glowAlpha'],
          ['DropShadow_Color', 'dropShadow', 'shadowColor', 'shadowAlpha']
        ];
        for (var colorTrackIndex = 0; colorTrackIndex < colorTracks.length; colorTrackIndex++) {
          var colorTrack = colorTracks[colorTrackIndex];
          if (!propertyUsed(op, colorTrack[1])) continue;
          var colorPoints = [];
          for (var colorPointIndex = 0; colorPointIndex < keyframes.length; colorPointIndex++) {
            var colorState = keyframes[colorPointIndex].values;
            colorPoints.push({ frame: keyframes[colorPointIndex].frame, value: motionColor(colorState[colorTrack[2]], colorTrack[3] ? colorState[colorTrack[3]] : 100) });
          }
          xml = replaceMotionColorChannel(xml, colorTrack[0], colorPoints, first, document.frameRate || 24);
        }
        timeline.setSelectedFrames(first, first + 1);
        activeFrame.setMotionObjectXML(xml);
      }
    });
  }

  /** Compares ease specifications for classic tween group validation.
   * @param left First ease specification
   * @param right Second ease specification
   * @returns Whether the specifications are equivalent
   */
  function sameEase(left, right) {
    return serialize(easeCurve(left)) === serialize(easeCurve(right));
  }

  /** Validates that classic tween groups share one easing curve.
   * @param arrival Arriving keyframe descriptor
   * @returns Nothing
   */
  function validateClassicEase(arrival) {
    var groups = [['position', ['x', 'y']], ['rotation', ['rotation']], ['scale', ['scaleX', 'scaleY']], ['color', ['alpha', 'brightness', 'tint']], ['filters', ['blur', 'glow', 'dropShadow']]];
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      var group = groups[groupIndex], ease = easeFor(arrival, group[1][0]);
      for (var propertyIndex = 1; propertyIndex < group[1].length; propertyIndex++) {
        if (!sameEase(ease, easeFor(arrival, group[1][propertyIndex]))) throw new Error('Classic tweens ease x/y together');
      }
    }
  }

  /** Applies classic tween easing to a segment's frame.
   * @param frame Classic tween frame
   * @param arrival Arriving keyframe descriptor
   * @returns Nothing
   */
  function setClassicEase(frame, arrival) {
    var groups = [
      ['position', ['x', 'y']], ['rotation', ['rotation']], ['scale', ['scaleX', 'scaleY']],
      ['color', ['alpha', 'brightness', 'tint']], ['filters', ['blur', 'glow', 'dropShadow']]
    ];
    var hasCustomEase = false;
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      var group = groups[groupIndex], ease = easeFor(arrival, group[1][0]);
      for (var propertyIndex = 1; propertyIndex < group[1].length; propertyIndex++) {
        var otherEase = easeFor(arrival, group[1][propertyIndex]);
        if (!sameEase(ease, otherEase)) throw new Error('Classic tweens ease x/y together');
      }
      if (ease === undefined) continue;
      if (typeof ease === 'number') frame.tweenEasing = ease;
      else {
        frame.hasCustomEase = true;
        frame.useSingleEaseCurve = false;
        hasCustomEase = true;
        var curve = easeCurve(ease), points = [
          { x: 0, y: 0 }, { x: curve[0], y: curve[1] }, { x: curve[2], y: curve[3] }, { x: 1, y: 1 }
        ];
        frame.setCustomEase(group[0], points);
      }
    }
    if (hasCustomEase) frame.hasCustomEase = true;
  }

  /** Applies an ease to an existing tween segment.
   * @param op setEase operation
   * @returns Nothing
   */
  function setEase(op) {
    var layerIndex = findLayerIndex(op.layer, op.index), layer = timeline.layers[layerIndex], frameIndex = op.frame - 1;
    if (frameIndex < 0 || frameIndex >= timeline.frameCount || frameIndex >= layer.frames.length) throw new Error('Frame beyond timeline length');
    var frame = layer.frames[frameIndex], span = layer.frames[frame.startFrame], arrivalFrame = frameIndex;
    if (!span || (span.tweenType !== 'motion' && span.tweenType !== 'motion object')) {
      var priorFrame = frameIndex - 1;
      if (priorFrame >= 0) {
        var prior = layer.frames[priorFrame], priorSpan = layer.frames[prior.startFrame];
        if (priorSpan && (priorSpan.tweenType === 'motion' || priorSpan.tweenType === 'motion object')) span = priorSpan;
      }
    }
    if (!span || (span.tweenType !== 'motion' && span.tweenType !== 'motion object')) throw new Error('Frame is not inside a tween');
    if (arrivalFrame <= span.startFrame) throw new Error('No tween segment arrives at this frame');
    /** Applies the ease while the target layer is unlocked.
     * @returns Nothing
     */
    withUnlockedLayers([layer], function () {
      timeline.currentLayer = layerIndex;
      if (span.tweenType === 'motion') {
        var arrival = { ease: op.ease };
        setClassicEase(span, arrival);
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
                var curve = easeCurve(op.ease), deltaTime = Number((current.match(/timevalue="([^"]+)"/) || [])[1]) - Number((previous.match(/timevalue="([^"]+)"/) || [])[1]);
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
                    /** Replaces one keyframe with the updated version.
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

  try {
    if (typeof __timelineRef === 'number') {
      timeline = document.timelines[__timelineRef];
      if (!timeline || Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0) throw new Error('Scene not found');
      if (document.currentTimeline !== __timelineRef && document.editScene) document.editScene(__timelineRef);
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
        if (op.op === 'createTween') createTween(op);
        else setEase(op);
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
