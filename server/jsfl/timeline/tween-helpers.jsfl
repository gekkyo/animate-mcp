// @requires timeline/tween-easing
/** Returns the final layer list.
 * @param timeline Timeline whose layers are listed.
 * @returns The current layers and their parent relationships.
 */
function tweenListLayers(timeline) {
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

/** Returns an element matching an instance name on a frame.
 * @param frame Animate frame
 * @param instanceName Instance name
 * @returns The matching element or null
 */
function tweenFindInstance(frame, instanceName) {
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
function tweenReadState(element) {
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
 * @param timeline Timeline being edited.
 * @param document Current Animate document.
 * @param element Animate instance
 * @param values Resolved property values
 * @param frameIndex Zero-based frame index
 * @returns Nothing
 */
function tweenWriteState(timeline, document, element, values, frameIndex) {
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
function tweenResolveKeyframes(op, startElement) {
  var state = tweenReadState(startElement), properties = {}, result = [], previousFrame = 0;
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
function tweenXmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Checks whether any keyframe specifies a property.
 * @param op createTween operation
 * @param property Property name
 * @returns Whether the operation animates the property
 */
function tweenPropertyUsed(op, property) {
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
 * @param easeProperty Easing property name
 * @param values Property values at each keyframe
 * @param startFrame Zero-based first frame
 * @param frameRate Document frame rate
 * @returns Updated motion XML
 */
function tweenReplaceMotionChannel(xml, propertyId, easeProperty, values, startFrame, frameRate) {
  var expression = new RegExp('(<Property[^>]*id="' + propertyId + '"[^>]*>)([\\s\\S]*?)(</Property>)');
  var match = expression.exec(xml);
  if (!match) throw new Error('Motion property not available: ' + propertyId);
  var propertyFrames = [], timeScaleMatch = xml.match(/TimeScale="([0-9]+)"/);
  var timeScale = timeScaleMatch ? Number(timeScaleMatch[1]) : 24000, unitsPerFrame = timeScale / frameRate;
  var track = values;
  for (var keyIndex = 0; keyIndex < track.length; keyIndex++) {
    var current = track[keyIndex], incoming = keyIndex > 0 ? track[keyIndex - 1] : current;
    var outgoing = keyIndex + 1 < track.length ? track[keyIndex + 1] : current;
    // Bezier handles are expressed relative to each keyframe segment's time and value range.
    var incomingCurve = tweenEaseCurve(tweenEaseFor(current.source || {}, easeProperty));
    var outgoingCurve = tweenEaseCurve(tweenEaseFor(outgoing.source || {}, easeProperty));
    var value = current.value, nextX = (outgoing.frame - current.frame) * unitsPerFrame * outgoingCurve[0];
    var nextY = value + (outgoing.value - value) * outgoingCurve[1];
    var previousX = -(current.frame - incoming.frame) * unitsPerFrame * (1 - incomingCurve[2]);
    var previousY = incoming.value + (current.value - incoming.value) * incomingCurve[3];
    var time = (current.frame - startFrame) * unitsPerFrame;
    propertyFrames.push('<Keyframe anchor="0,' + tweenXmlEscape(value) + '" next="' + tweenXmlEscape(nextX) + ',' + tweenXmlEscape(nextY) + '" previous="' + tweenXmlEscape(previousX) + ',' + tweenXmlEscape(previousY) + '" roving="0" timevalue="' + tweenXmlEscape(time) + '"/>');
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
function tweenReplaceMotionColorChannel(xml, propertyId, values, startFrame, frameRate) {
  var expression = new RegExp('(<Property[^>]*id="' + propertyId + '"[^>]*>)([\\s\\S]*?)(</Property>)');
  var match = expression.exec(xml);
  if (!match) throw new Error('Motion property not available: ' + propertyId);
  var timeScaleMatch = xml.match(/TimeScale="([0-9]+)"/), timeScale = timeScaleMatch ? Number(timeScaleMatch[1]) : 24000;
  var unitsPerFrame = timeScale / frameRate, propertyFrames = [];
  for (var keyIndex = 0; keyIndex < values.length; keyIndex++) {
    var value = values[keyIndex];
    propertyFrames.push('<Keyframe roving="0" timevalue="' + ((value.frame - startFrame) * unitsPerFrame) + '" value="' + tweenXmlEscape(value.value) + '"/>');
  }
  return xml.slice(0, match.index) + match[1] + propertyFrames.join('') + match[3] + xml.slice(match.index + match[0].length);
}

/** Converts a CSS-style hex color and opacity to Motion Editor color notation.
 * @param color Hex color string
 * @param alpha Opacity percent
 * @returns Eight-digit Animate color value
 */
function tweenMotionColor(color, alpha) {
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
function tweenMotionValue(item, base, field, multiplier, relative) {
  var value = Number(item.values[field]) * multiplier;
  return relative ? value - Number(base[field]) * multiplier : value;
}
