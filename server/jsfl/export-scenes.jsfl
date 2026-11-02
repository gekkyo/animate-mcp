// Run file ラッパーが評価する。直前に `var __docName = "..."` (空文字なら未指定) が差し込まれる。
// 結果は JSON 文字列（JSFL に JSON が無いため手組み）。
(function () {
  function ser(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return isFinite(v) ? String(v) : "null";
    if (typeof v === "boolean") return String(v);
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
      return "[" + a.join(",") + "]";
    }
    if (typeof v === "object") {
      var o = [];
      for (var k in v) o.push(ser(k) + ":" + ser(v[k]));
      return "{" + o.join(",") + "}";
    }
    var s = String(v), r = '"';
    for (var j = 0; j < s.length; j++) {
      var c = s.charAt(j), n = s.charCodeAt(j);
      if (c === '"') r += '\\"';
      else if (c === "\\") r += "\\\\";
      else if (n < 32) r += "\\u" + ("0000" + n.toString(16)).slice(-4);
      else r += c;
    }
    return r + '"';
  }

  var d = selectDocument(), i;

  function exportTimeline(tl) {
    var layers = [];
    for (var li = 0; li < tl.layers.length; li++) {
      var layer = tl.layers[li];
      if (layer.layerType === "folder") continue;
      var frames = [];
      for (var fi = 0; fi < layer.frames.length; fi++) {
        var f = layer.frames[fi];
        if (f.startFrame !== fi) continue;
        var els = [];
        for (var ei = 0; ei < f.elements.length; ei++) {
          var e = f.elements[ei];
          var item = e.libraryItem;
          els.push({
            name: e.name || "",
            item: item ? item.name : "",
            type: item ? item.itemType : e.elementType,
          });
        }
        frames.push({
          start: f.startFrame,
          duration: f.duration,
          label: f.name || "",
          tween: f.tweenType || "none",
          script: f.actionScript || "",
          elements: els,
        });
      }
      layers.push({ index: li, name: layer.name, frames: frames });
    }
    return layers;
  }

  var scenes = [];
  for (i = 0; i < d.timelines.length; i++) {
    var name = d.timelines[i].name;
    try {
      scenes.push({ name: name, layers: exportTimeline(d.timelines[i]) });
    } catch (e) {
      scenes.push({ name: name, error: String(e && e.message ? e.message : e) });
    }
  }
  return ser({ document: d.name, type: d.type, scenes: scenes });
})()
