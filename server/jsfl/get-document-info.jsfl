// Concatenated and evaluated after export-common. The last expression returns JSON text via serialize.
/** Returns the open document's metadata as JSON text.
 * @returns The serialized document metadata.
 */
(function () {
  var document = fl.getDocumentDOM();
  if (!document) throw new Error("No document open");
  var timelineNames = [];
  for (var timelineIndex = 0; timelineIndex < document.timelines.length; timelineIndex++) {
    timelineNames.push(document.timelines[timelineIndex].name);
  }
  return serialize({
    name: document.name,
    width: document.width,
    height: document.height,
    frameRate: document.frameRate,
    timelines: timelineNames
  });
})()
