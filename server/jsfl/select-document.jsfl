// Shared part concatenated before other JSFL. `var __docName = "..."` (empty string = unspecified) is injected before it.
// Returns the target document. If several are open and none is specified, throws an error listing the document names.
/** Selects the requested open document, or the only open document. */
function selectDocument() {
  var documents = fl.documents, document = null, documentIndex;
  if (!documents || documents.length === 0) throw new Error("No document open");
  if (__docName) {
    for (documentIndex = 0; documentIndex < documents.length; documentIndex++) {
      if (documents[documentIndex].name === __docName) document = documents[documentIndex];
    }
    if (!document) throw new Error("Document not open: " + __docName);
  } else if (documents.length > 1) {
    var documentNames = [];
    for (documentIndex = 0; documentIndex < documents.length; documentIndex++) {
      documentNames.push(documents[documentIndex].name);
    }
    throw new Error("Multiple documents open; specify `document`: " + documentNames.join(", "));
  } else {
    document = documents[0];
  }
  if (document.type !== "Flash" && document.type !== "htmlcanvas") {
    throw new Error("Unsupported document type: " + document.type);
  }
  return document;
}
