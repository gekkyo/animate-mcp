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
