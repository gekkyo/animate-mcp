// Concatenated and evaluated after export-common. `var __docName = "..."` (empty string = unspecified) is injected before it.
// The result is a JSON string (hand-built, since JSFL has no JSON).
(function () {
  var d = selectDocument(), i;

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
