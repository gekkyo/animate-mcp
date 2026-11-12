// Publishes the selected AS3 or HTML5 Canvas document and returns the saved compiler output for AS3.
(function () {
  var document = selectDocument();
  if (document.type !== "Flash" && document.type !== "htmlcanvas") throw new Error("Unsupported document type");
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  if (!fl.publishDocument(document.pathURI)) throw new Error("Publish failed");
  if (document.type === "htmlcanvas") return true;

  var outputURI = FLfile.platformPathToURI(__publishOutputPath);
  try {
    fl.compilerErrors.save(outputURI);
    return FLfile.exists(outputURI) ? FLfile.read(outputURI) : "";
  } finally {
    if (FLfile.exists(outputURI)) FLfile.remove(outputURI);
  }
})()
