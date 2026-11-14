/** Reads document type, ActionScript version, and saved folder defensively.
 * @param document Animate document to inspect
 * @returns Runtime metadata for the document
 */
function documentRuntimeInfo(document) {
  var documentType = null, versionValue = null, pathURI = null, folder = null, platformPath = null;
  try { if (typeof document.type !== "undefined") documentType = String(document.type).toLowerCase(); } catch (typeError) {}
  try { if (typeof document.asVersion !== "undefined") versionValue = String(document.asVersion).toLowerCase(); } catch (versionError) {}
  try { if (typeof document.pathURI !== "undefined") pathURI = document.pathURI; } catch (pathError) {}
  if (pathURI && typeof FLfile !== "undefined" && typeof FLfile.uriToPlatformPath === "function") {
    try { platformPath = FLfile.uriToPlatformPath(pathURI); } catch (conversionError) {}
  }
  if (platformPath) {
    var separator = Math.max(platformPath.lastIndexOf("/"), platformPath.lastIndexOf("\\"));
    if (separator >= 0) folder = separator === 0 ? platformPath.charAt(0) : platformPath.substring(0, separator);
  }
  var kind = "other", asVersion = null;
  if (documentType === "htmlcanvas") kind = "canvas";
  else if (documentType === "flash") {
    if (versionValue && versionValue.indexOf("3") !== -1) { kind = "as3"; asVersion = "AS3"; }
    else if (versionValue && versionValue.indexOf("2") !== -1) { kind = "as2"; asVersion = "AS2"; }
  }
  return { name: document.name, folder: folder, asVersion: asVersion, kind: kind };
}
