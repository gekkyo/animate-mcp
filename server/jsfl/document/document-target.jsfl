/** Converts a document path or file URI to Animate's canonical file URI. */
function normalizeDocumentTargetPath(path) {
  if (typeof path !== "string" || !path) throw new Error("A document path is required");
  var platformPath = /^file:\/\//i.test(path) ? FLfile.uriToPlatformPath(path) : path;
  var uri = FLfile.platformPathToURI(platformPath);
  if (typeof uri !== "string" || !uri) throw new Error("Could not normalize document path: " + path);
  return uri;
}

/** Resolves an exact document name or path and refuses zero or ambiguous matches. */
function resolveDocumentTarget(target) {
  if (typeof target !== "string" || !target) throw new Error("A document name or path is required");
  var pathURI = null, matches = [], documents = fl.documents || [], i, document, matchesDocument;
  try { pathURI = normalizeDocumentTargetPath(target); } catch (pathError) {}
  for (i = 0; i < documents.length; i++) {
    document = documents[i];
    matchesDocument = document.name === target;
    if (pathURI && document.pathURI) {
      try {
        if (normalizeDocumentTargetPath(document.pathURI) === pathURI) matchesDocument = true;
      } catch (documentPathError) {}
    }
    if (matchesDocument) matches.push(document);
  }
  if (matches.length !== 1) {
    throw new Error("Document target " + target + " matched " + matches.length + " open documents; expected exactly one");
  }
  return matches[0];
}
