// @requires shared/select-document, shared/export-common
// Activates a saved document before Publish runs in a separate Run.
(function () {
  var document = selectDocument();
  if (!document.pathURI) throw new Error("Document is not saved; save first");
  fl.setActiveWindow(document);
  return serialize(document.type);
})()
