// @requires shared/select-document, shared/export-common, shared/output-panels
// Activates, launches, or snapshots panels for the current in-memory AS3 document.
/** Runs the requested Test Movie step.
 * @returns The serialized result for that step.
 */
(function () {
  if (__testMovieAction === "read") return serialize(readOutputPanels());
  var document = selectDocument();
  if (document.type !== "Flash" || String(document.asVersion).indexOf("3") < 0) {
    throw new Error("test_movie supports AS3 documents only");
  }
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  if (__testMovieAction === "activate") {
    fl.setActiveWindow(document);
    return serialize(true);
  }
  if (__testMovieAction === "launch") {
    var before = readOutputPanels();
    var startedAt = new Date().getTime();
    document.testMovie(true);
    return serialize({ startedAt: startedAt, before: before });
  }
  throw new Error("Unknown test_movie action");
})()
