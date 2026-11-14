// `__saveDocumentTarget`, `__saveDocumentPath`, and `__saveDocumentConfirm` are injected before this file.
(function () {
  var document = resolveDocumentTarget(__saveDocumentTarget);
  var currentPath = document.pathURI || "";
  var targetPath = __saveDocumentPath || currentPath;
  if (!targetPath) throw new Error("This document is unsaved; provide a save-as path");
  if (__saveDocumentPath && !/\.fla$/i.test(__saveDocumentPath.replace(/[?#].*$/, ""))) {
    throw new Error("Path must point to a .fla file: " + __saveDocumentPath);
  }

  var targetURI = normalizeDocumentTargetPath(targetPath);
  var currentURI = currentPath ? normalizeDocumentTargetPath(currentPath) : "";
  var samePath = Boolean(currentURI && currentURI === targetURI);
  var documents = fl.documents || [], index, openDocument;
  for (index = 0; index < documents.length; index++) {
    openDocument = documents[index];
    if (openDocument !== document && openDocument.pathURI && normalizeDocumentTargetPath(openDocument.pathURI) === targetURI) {
      throw new Error("Cannot save to another open document's path");
    }
  }

  var targetExists = FLfile.exists(targetURI);
  if ((samePath || targetExists) && !__saveDocumentConfirm) {
    throw new Error("Saving to the document's current path or an existing file requires confirm: true after asking the user");
  }

  // shortcut: JSFL has no atomic no-clobber save, upgrade if Animate adds exclusive-create support.
  var saveStatus = fl.saveDocument(document, targetURI);
  if (saveStatus !== true) throw new Error("Animate did not confirm that the document was saved");

  var savedPath = document.pathURI;
  if (typeof savedPath !== "string" || !savedPath) throw new Error("Animate did not report a saved document path");
  var normalizedSavedPath = normalizeDocumentTargetPath(savedPath);
  if (normalizedSavedPath !== targetURI) throw new Error("Animate's reported path does not match the requested save destination");
  if (!FLfile.exists(savedPath)) throw new Error("Animate reported a saved path, but the file does not exist");
  return savedPath;
})();
