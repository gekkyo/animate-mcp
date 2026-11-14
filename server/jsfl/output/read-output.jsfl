// Reads Animate's global Output and Compiler Errors panels through temporary files.
(function () {
  var outputURI = FLfile.platformPathToURI(__readOutputPath);
  var compilerURI = FLfile.platformPathToURI(__readCompilerPath);
  var output = "";
  var compiler = "";
  var compilerAvailable = true;
  function encode(text) {
    return String(text).length + ":" + String(text);
  }
  try {
    fl.outputPanel.save(outputURI);
    if (FLfile.exists(outputURI)) output = FLfile.read(outputURI);
    try {
      fl.compilerErrors.save(compilerURI);
      if (FLfile.exists(compilerURI)) compiler = FLfile.read(compilerURI);
    } catch (error) {
      compilerAvailable = false;
    }
    return (compilerAvailable ? "1" : "0") + encode(output) + encode(compiler);
  } finally {
    if (FLfile.exists(outputURI)) FLfile.remove(outputURI);
    if (FLfile.exists(compilerURI)) FLfile.remove(compilerURI);
  }
})()
