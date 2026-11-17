// @requires shared/select-document, shared/export-common
// Selects and activates a saved HTML5 Canvas document and returns its platform path.
(function () {
  var document = selectDocument();
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  if (document.type !== "htmlcanvas") throw new Error("verify_canvas_output supports HTML5 Canvas documents only");
  fl.setActiveWindow(document);
  return serialize(FLfile.uriToPlatformPath(document.pathURI));
})()
