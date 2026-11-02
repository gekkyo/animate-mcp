// Shared part concatenated before other JSFL. `var __docName = "..."` (empty string = unspecified) is injected before it.
// Returns the target document. If several are open and none is specified, throws an error listing the document names.
function selectDocument() {
  var docs = fl.documents, d = null, i;
  if (!docs || docs.length === 0) throw new Error("No document open");
  if (__docName) {
    for (i = 0; i < docs.length; i++) if (docs[i].name === __docName) d = docs[i];
    if (!d) throw new Error("Document not open: " + __docName);
  } else if (docs.length > 1) {
    var names = [];
    for (i = 0; i < docs.length; i++) names.push(docs[i].name);
    throw new Error("Multiple documents open; specify `document`: " + names.join(", "));
  } else {
    d = docs[0];
  }
  if (d.type !== "Flash" && d.type !== "htmlcanvas") throw new Error("Unsupported document type: " + d.type);
  return d;
}
