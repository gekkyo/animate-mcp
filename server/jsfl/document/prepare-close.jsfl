// @requires document/document-target
/** Selects the Arrow tool for one validated document before a separate close Run.
 * @returns Whether Animate accepted the Arrow tool selection.
 */
(function () {
  var document = resolveDocumentTarget(__closeDocumentTarget);
  if (typeof __closeDocumentRequireUnsaved !== "undefined" && __closeDocumentRequireUnsaved && document.pathURI) {
    throw new Error("Expected the exact disposable document to be unsaved before close preparation");
  }
  if (typeof fl.selectTool !== "function") {
    throw new Error("Animate does not provide fl.selectTool; refusing to close the document");
  }
  if (fl.selectTool("arrow") !== true) {
    throw new Error("Animate did not accept Arrow tool selection; refusing to close the document");
  }
  return true;
})();
