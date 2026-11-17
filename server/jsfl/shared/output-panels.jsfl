// Reads Animate's global Output and Compiler Errors panels through temporary files.
/** Reads Output and Compiler Errors panel contents and removes the temporary files.
 * @returns Panel data.
 */
function readOutputPanels() {
  var outputURI = FLfile.platformPathToURI(__readOutputPath);
  var compilerURI = FLfile.platformPathToURI(__readCompilerPath);
  var output = "";
  var compiler = "";
  var compilerAvailable = true;
  try {
    fl.outputPanel.save(outputURI);
    if (FLfile.exists(outputURI)) output = FLfile.read(outputURI);
    try {
      fl.compilerErrors.save(compilerURI);
      if (FLfile.exists(compilerURI)) compiler = FLfile.read(compilerURI);
    } catch (error) {
      compilerAvailable = false;
    }
    return {
      compilerPanelAvailable: compilerAvailable,
      outputPanel: output,
      compilerErrorsPanel: compiler
    };
  } finally {
    if (FLfile.exists(outputURI)) FLfile.remove(outputURI);
    if (FLfile.exists(compilerURI)) FLfile.remove(compilerURI);
  }
}
