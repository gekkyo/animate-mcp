// Runs the current in-memory AS3 document and returns the invocation timestamp.
(function () {
  var document = selectDocument();
  if (document.type !== "Flash" || String(document.asVersion).indexOf("3") < 0) {
    throw new Error("test_movie supports AS3 documents only");
  }
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  var startedAt = new Date().getTime();
  document.testMovie(true);
  return startedAt;
})()
