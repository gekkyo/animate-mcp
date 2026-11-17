// @requires document/document-target, shared/export-common
/** Closes the targeted document without saving and verifies it is no longer open.
 * @returns The serialized closed document name and path.
 */
(function () {
  var document = resolveDocumentTarget(__closeDocumentTarget);
  if (typeof __closeDocumentRequireUnsaved !== "undefined" && __closeDocumentRequireUnsaved && document.pathURI) {
    throw new Error("Expected the exact disposable document to remain unsaved before close");
  }
  var result = { name: document.name, path: document.pathURI || null };
  document.selectNone();
  document.close(false);
  var documents = fl.documents || [];
  for (var i = 0; i < documents.length; i++) {
    if (documents[i] === document) throw new Error("Animate did not close the targeted document");
  }
  return serialize(result);
})();
