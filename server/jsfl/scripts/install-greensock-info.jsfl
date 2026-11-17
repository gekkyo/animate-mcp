// @requires shared/select-document, shared/export-common, document/document-runtime-info
// `var __docName` is injected before this file.
(function () {
  return serialize(documentRuntimeInfo(selectDocument()));
})()
