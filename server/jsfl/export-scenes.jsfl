// Concatenated and evaluated after export-common. `var __docName = "..."` (empty string = unspecified) is injected before it.
// The result is a JSON string (hand-built, since JSFL has no JSON).
(function () {
  var document = selectDocument(), timelineIndex;

  var scenes = [];
  for (timelineIndex = 0; timelineIndex < document.timelines.length; timelineIndex++) {
    var timelineName = document.timelines[timelineIndex].name;
    try {
      scenes.push({ name: timelineName, layers: exportTimeline(document.timelines[timelineIndex]) });
    } catch (error) {
      scenes.push({ name: timelineName, error: String(error && error.message ? error.message : error) });
    }
  }
  return serialize({ document: document.name, type: document.type, scenes: scenes });
})()
