// @requires document/document-target, shared/export-common
/** Closes the targeted document without saving and verifies it is no longer open.
 * @returns The serialized closed document name and path.
 */
(function () {
  var document = resolveDocumentTarget(__closeDocumentTarget);
  var result = { name: document.name, path: document.pathURI || null };
  document.close(false);
  var documents = fl.documents || [];
  for (var i = 0; i < documents.length; i++) {
    if (documents[i] === document) throw new Error("Animate did not close the targeted document");
  }
  return serialize(result);
})();
