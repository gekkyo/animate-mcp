// Concatenated and evaluated after export-common. The last expression returns JSON text via serialize.
/** Returns the open documents and active document as JSON text. */
(function () {
  /** Reads public metadata without changing a document.
   * @param document Open Animate document.
   * @returns Document metadata.
   */
  function metadata(document) {
    return {
      name: document.name,
      path: document.pathURI || null,
      type: document.type || null
    };
  }
  var documents = [];
  for (var index = 0; index < fl.documents.length; index++) {
    documents.push(metadata(fl.documents[index]));
  }
  var active = fl.getDocumentDOM();
  return serialize({
    animate: "responding",
    documents: documents,
    activeDocument: active ? metadata(active) : null
  });
})()
