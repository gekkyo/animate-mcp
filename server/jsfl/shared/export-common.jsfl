// Shared before other JSFL files: JSON serialization and timeline-to-layer/frame conversion.
/** Serializes a value as JSON without relying on a JSFL JSON implementation.
 * @param value The value to serialize.
 * @returns The JSON text representation.
 */
function serialize(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return String(value);
  if (value instanceof Array) {
    var serializedItems = [];
    for (var itemIndex = 0; itemIndex < value.length; itemIndex++) serializedItems.push(serialize(value[itemIndex]));
    return "[" + serializedItems.join(",") + "]";
  }
  if (typeof value === "object") {
    var serializedProperties = [];
    for (var propertyName in value) {
      serializedProperties.push(serialize(propertyName) + ":" + serialize(value[propertyName]));
    }
    return "{" + serializedProperties.join(",") + "}";
  }
  var stringValue = String(value), escapedValue = '"';
  for (var characterIndex = 0; characterIndex < stringValue.length; characterIndex++) {
    var character = stringValue.charAt(characterIndex), characterCode = stringValue.charCodeAt(characterIndex);
    if (character === '"') escapedValue += '\\"';
    else if (character === "\\") escapedValue += "\\\\";
    else if (characterCode < 32) escapedValue += "\\u" + ("0000" + characterCode.toString(16)).slice(-4);
    else escapedValue += character;
  }
  return escapedValue + '"';
}

/** Converts an Animate timeline into layer and keyframe data for export.
 * @param timeline The timeline to export.
 * @returns The exported layer and keyframe data.
 */
function exportTimeline(timeline) {
  var layers = [];
  for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
    var layer = timeline.layers[layerIndex];
    if (layer.layerType === "folder") continue;
    var frames = [];
    for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) {
      var frame = layer.frames[frameIndex];
      if (frame.startFrame !== frameIndex) continue;
      var elements = [];
      for (var elementIndex = 0; elementIndex < frame.elements.length; elementIndex++) {
        var element = frame.elements[elementIndex];
        var libraryItem = element.libraryItem;
        elements.push({
          name: element.name || "",
          item: libraryItem ? libraryItem.name : "",
          type: libraryItem ? libraryItem.itemType : element.elementType,
        });
      }
      frames.push({
        start: frame.startFrame,
        duration: frame.duration,
        label: frame.name || "",
        tween: frame.tweenType || "none",
        script: frame.actionScript || "",
        elements: elements,
      });
    }
    layers.push({ index: layerIndex, name: layer.name, frames: frames });
  }
  return layers;
}

/** Hashes text with 32-bit FNV-1a.
 * @param text Text to hash.
 * @returns The hash as "fnv1a32:" plus 8 hex digits.
 */
function fnv1a32(text) {
  var hash = 2166136261;
  for (var characterIndex = 0; characterIndex < text.length; characterIndex++) {
    hash ^= text.charCodeAt(characterIndex);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  var hex = hash.toString(16);
  while (hex.length < 8) hex = "0" + hex;
  return "fnv1a32:" + hex;
}

/** Hashes timeline structure without script contents so edits can detect stale exports.
 * @param timeline The timeline whose structure to hash.
 * @returns The structure fingerprint.
 */
function structureFingerprint(timeline) {
  var structure = [], layerIndex, frameIndex, layer, parentIndex, keyframes, frame;
  for (layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
    layer = timeline.layers[layerIndex];
    parentIndex = -1;
    for (var candidateIndex = 0; candidateIndex < timeline.layers.length; candidateIndex++) {
      if (timeline.layers[candidateIndex] === layer.parentLayer) {
        parentIndex = candidateIndex;
        break;
      }
    }
    keyframes = [];
    for (frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) {
      frame = layer.frames[frameIndex];
      if (frame && frame.startFrame === frameIndex) keyframes.push([frameIndex, frame.duration]);
    }
    structure.push([layer.name || "", layer.layerType || "normal", parentIndex, keyframes]);
  }
  return fnv1a32(serialize(structure));
}

/** Hashes sorted library item types and paths so library edits invalidate old exports.
 * @param library Animate document library.
 * @returns The library fingerprint.
 */
function libraryFingerprint(library) {
  var items = [], libraryItems = library.items;
  for (var itemIndex = 0; itemIndex < libraryItems.length; itemIndex++) {
    items.push(String(libraryItems[itemIndex].itemType || "") + "|" + String(libraryItems[itemIndex].name || ""));
  }
  items.sort();
  return fnv1a32(serialize(items));
}
