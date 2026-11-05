// Shared before other JSFL files: JSON serialization and timeline-to-layer/frame conversion.
/** Serializes a value as JSON without relying on a JSFL JSON implementation. */
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

/** Converts an Animate timeline into layer and keyframe data for export. */
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
