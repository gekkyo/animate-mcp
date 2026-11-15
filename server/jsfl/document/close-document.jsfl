/** Closes the targeted document without saving and verifies it is no longer open.
 * @returns The closed document name and path separated by a newline.
 */
(function () {
  var document = resolveDocumentTarget(__closeDocumentTarget);
  var result = document.name + "\n" + (document.pathURI || "");
  document.close(false);
  var documents = fl.documents || [];
  for (var i = 0; i < documents.length; i++) {
    if (documents[i] === document) throw new Error("Animate did not close the targeted document");
  }
  return result;
})();
