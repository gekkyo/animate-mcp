// @requires document/document-target, shared/export-common
/** Opens or creates a document, activates it, and returns its name and path.
 * @returns The serialized document name and path.
 */
(function () {
  var path = __openDocumentPath, type = __openDocumentType, documents = fl.documents || [], i, document;
  if (path) {
    if (!/\.fla$/i.test(path.replace(/[?#].*$/, ""))) throw new Error("Path must point to a .fla file: " + path);
    var pathURI = normalizeDocumentTargetPath(path), matches = [];
    for (i = 0; i < documents.length; i++) {
      document = documents[i];
      if (document.pathURI && normalizeDocumentTargetPath(document.pathURI) === pathURI) matches.push(document);
    }
    if (matches.length > 1) throw new Error("Several open documents match path: " + path);
    if (matches.length === 1) {
      // Animate applies setActiveWindow only after this Run returns.
      fl.setActiveWindow(matches[0]);
      return serialize({ name: matches[0].name, path: matches[0].pathURI || null });
    }
    if (!FLfile.exists(pathURI)) throw new Error("Document file does not exist: " + path);
    fl.openDocument(pathURI);
    documents = fl.documents || [];
    matches = [];
    for (i = 0; i < documents.length; i++) {
      document = documents[i];
      if (document.pathURI && normalizeDocumentTargetPath(document.pathURI) === pathURI) matches.push(document);
    }
    if (matches.length !== 1) throw new Error("Animate could not open a valid FLA at path: " + path);
    // Animate applies setActiveWindow only after this Run returns.
    fl.setActiveWindow(matches[0]);
    return serialize({ name: matches[0].name, path: matches[0].pathURI || null });
  }

  var previous = [];
  for (i = 0; i < documents.length; i++) previous.push(documents[i]);
  fl.createDocument(type);
  documents = fl.documents || [];
  matches = [];
  for (i = 0; i < documents.length; i++) {
    var wasOpen = false, j;
    for (j = 0; j < previous.length; j++) if (documents[i] === previous[j]) wasOpen = true;
    if (!wasOpen) matches.push(documents[i]);
  }
  if (matches.length !== 1) throw new Error("Animate did not create exactly one new document");
  document = matches[0];
  if (type === "htmlcanvas" ? document.type !== "htmlcanvas" : document.type !== "Flash" || String(document.asVersion).indexOf("3") < 0) {
    throw new Error("Animate did not create the requested " + (type === "timeline" ? "AS3" : "HTML5 Canvas") + " document");
  }
  // Animate applies setActiveWindow only after this Run returns.
  fl.setActiveWindow(document);
  return serialize({ name: document.name, path: document.pathURI || null });
})()
