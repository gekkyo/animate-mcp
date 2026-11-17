// @requires shared/export-common
// Reads document facts and checks only explicitly supplied candidate output URIs.
/** Returns active document facts needed by Preflight.
 * @returns Serialized document metadata and profile XML.
 */
(function () {
  var document = selectPreflightDocument(), profile = "", playerTarget = "", sameDocument = true, outputFiles = [];
  if (typeof __expectedName !== "undefined" && typeof __expectedPath !== "undefined") {
    sameDocument = document.name === __expectedName && String(document.pathURI || "") === __expectedPath;
  }
  try {
    profile = document.exportPublishProfileString();
  } catch (profileError) {
    profile = "";
  }
  try {
    playerTarget = document.playerTarget || "";
  } catch (playerTargetError) {
    playerTarget = "";
  }
  if (sameDocument && typeof __outputFiles !== "undefined") {
    for (var outputIndex = 0; outputIndex < __outputFiles.length; outputIndex++) {
      outputFiles.push({
        name: __outputFiles[outputIndex].name,
        exists: FLfile.exists(__outputFiles[outputIndex].uri)
      });
    }
  }
  var info = {
    name: document.name || "",
    pathURI: document.pathURI || "",
    type: document.type || "",
    profile: profile,
    sameDocument: sameDocument,
    outputFiles: outputFiles
  };
  if (document.type === "Flash" && playerTarget.indexOf("AIR ") === 0) {
    info.playerTarget = playerTarget;
    // macOS pathURI includes the volume name (file:///Macintosh%20HD/...), so Node cannot convert it.
    info.platformPath = document.pathURI ? FLfile.uriToPlatformPath(document.pathURI) : "";
  }
  return serialize(info);
})()

/** Selects the requested open document without filtering unsupported document types.
 * @returns The selected document.
 */
function selectPreflightDocument() {
  var documents = fl.documents, document = null, documentNames = [];
  if (!documents || documents.length === 0) throw new Error("No document open");
  if (__docName) {
    for (var documentIndex = 0; documentIndex < documents.length; documentIndex++) {
      if (documents[documentIndex].name === __docName) document = documents[documentIndex];
    }
    if (!document) throw new Error("Document not open: " + __docName);
  } else {
    if (documents.length > 1) {
      for (var nameIndex = 0; nameIndex < documents.length; nameIndex++) documentNames.push(documents[nameIndex].name);
      throw new Error("Multiple documents open; specify `document`: " + documentNames.join(", "));
    }
    document = documents[0];
  }
  return document;
}
