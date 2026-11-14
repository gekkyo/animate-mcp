// `var __docName` and `var __properties` are injected before this file.
(function () {
  var document = selectDocument(), properties = __properties || {}, hasProperty = false, key;
  for (key in properties) {
    if (typeof properties[key] === "undefined") continue;
    hasProperty = true;
    if (key === "width" || key === "height") {
      if (typeof properties[key] !== "number" || Math.floor(properties[key]) !== properties[key] ||
        properties[key] < 1 || properties[key] > 3840) throw new Error(key + " must be an integer from 1 to 3840 (conservative tool limit)");
    } else if (key === "frameRate") {
      if (typeof properties[key] !== "number" || properties[key] < 0.01 || properties[key] > 120) {
        throw new Error("frameRate must be from 0.01 to 120");
      }
    } else if (key === "backgroundColor") {
      if (typeof properties[key] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(properties[key])) {
        throw new Error("backgroundColor must be a #RRGGBB color");
      }
    } else {
      throw new Error("Unsupported document property: " + key);
    }
  }
  if (!hasProperty) throw new Error("Set at least one document property");

  if (typeof properties.width !== "undefined") document.width = properties.width;
  if (typeof properties.height !== "undefined") document.height = properties.height;
  if (typeof properties.frameRate !== "undefined") document.frameRate = properties.frameRate;
  if (typeof properties.backgroundColor !== "undefined") document.backgroundColor = properties.backgroundColor;

  var result = {};
  if (typeof properties.width !== "undefined") result.width = document.width;
  if (typeof properties.height !== "undefined") result.height = document.height;
  if (typeof properties.frameRate !== "undefined") result.frameRate = document.frameRate;
  if (typeof properties.backgroundColor !== "undefined") result.backgroundColor = document.backgroundColor;
  return serialize({ document: document.name, properties: result });
})()
