// Publishes the selected AS3 document and returns the saved compiler output.
(function () {
  var document = selectDocument();
  if (document.type !== "Flash") throw new Error("HTML5 Canvas is not supported yet");
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  if (!fl.publishDocument(document.pathURI)) throw new Error("Publish failed");

  var outputURI = FLfile.platformPathToURI(__publishOutputPath);
  try {
    fl.compilerErrors.save(outputURI);
    return FLfile.exists(outputURI) ? FLfile.read(outputURI) : "";
  } finally {
    if (FLfile.exists(outputURI)) FLfile.remove(outputURI);
  }
})()
