// Captures one frame from the active document's currently edited timeline.
(function () {
  var document = fl.getDocumentDOM();
  if (!document) throw new Error("No document open");
  if (document.type !== "Flash" && document.type !== "htmlcanvas") throw new Error("Unsupported document type: " + document.type);

  var timeline = document.getTimeline();
  var frame = __captureFrame === null ? timeline.currentFrame + 1 : __captureFrame;
  if (frame < 1 || frame > timeline.frameCount) {
    throw new Error("Frame " + frame + " does not exist (timeline has " + timeline.frameCount + " frames)");
  }
  if (Math.max(document.width, document.height) > 2048) {
    throw new Error("Stage size " + document.width + "x" + document.height + " exceeds 2048px; capture is not scaled");
  }

  var originalFrame = timeline.currentFrame;
  var outputDir = __captureDir;
  if (!outputDir) {
    var documentName = document.name.replace(/\.fla$/i, "");
    // Keep the default path safe like export-workspace's safeName without requiring another Run for the document name.
    documentName = documentName.replace(/[\x00-\x1f\\/:*?"<>|]/g, "_").replace(/^\.+$/, "_") || "_";
    outputDir = __captureRoot + "/" + documentName;
  }
  var outputDirURI = FLfile.platformPathToURI(outputDir);
  if (!FLfile.createFolder(outputDirURI) && !FLfile.exists(outputDirURI)) {
    throw new Error("Could not create capture directory: " + outputDir);
  }

  function pad(value, length) {
    var text = String(value);
    while (text.length < length) text = "0" + text;
    return text;
  }
  function timestamp(date) {
    return pad(date.getFullYear(), 4) + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) + "-" +
      pad(date.getHours(), 2) + pad(date.getMinutes(), 2) + pad(date.getSeconds(), 2) + "-" + pad(date.getMilliseconds(), 3);
  }

  try {
    if (__captureFrame !== null) timeline.currentFrame = frame - 1;
    var date = new Date(), outputPath, outputURI;
    do {
      outputPath = outputDir + "/" + frame + "-" + timestamp(date) + ".png";
      outputURI = FLfile.platformPathToURI(outputPath);
      if (FLfile.exists(outputURI)) date.setTime(date.getTime() + 1);
    } while (FLfile.exists(outputURI));

    if (!document.exportPNG(outputURI, true, true) || !FLfile.exists(outputURI)) {
      throw new Error("Capture export failed");
    }
    return serialize({ path: outputPath, frame: frame, timeline: timeline.name, width: document.width, height: document.height });
  } finally {
    timeline.currentFrame = originalFrame;
  }
})()
