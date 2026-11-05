// Concatenated and evaluated after export-common. `var __docName = "..."` (empty string = unspecified) is injected before it.
// The result is a JSON string (hand-built, since JSFL has no JSON).
/** Exports scene timelines and structure fingerprints as JSON text.
 * @returns The serialized scene export.
 */
(function () {
  var document = selectDocument(), timelineIndex;

  var scenes = [];
  for (timelineIndex = 0; timelineIndex < document.timelines.length; timelineIndex++) {
    var timelineName = document.timelines[timelineIndex].name;
    try {
      var timeline = document.timelines[timelineIndex];
      scenes.push({ name: timelineName, layers: exportTimeline(timeline), structureFingerprint: structureFingerprint(timeline) });
    } catch (error) {
      scenes.push({ name: timelineName, error: String(error && error.message ? error.message : error) });
    }
  }
  return serialize({ document: document.name, type: document.type, scenes: scenes });
})()
