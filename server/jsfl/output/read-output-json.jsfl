// @requires shared/export-common, shared/output-panels
// Reads Animate's global Output and Compiler Errors panels through temporary files.
/** Reads Output and Compiler Errors panel contents and removes the temporary files.
 * @returns Serialized panel data.
 */
(function () {
  return serialize(readOutputPanels());
})()
