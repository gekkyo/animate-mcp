// @requires shared/export-common
// Captures one frame or an inclusive range from the active document's currently edited timeline.
/** Exports one or more timeline frames as PNG files and restores the current frame.
 * @returns Serialized capture metadata.
 */
(function () {
  var document = fl.getDocumentDOM();
  if (!document) throw new Error("No document open");
  if (document.type !== "Flash" && document.type !== "htmlcanvas") throw new Error("Unsupported document type: " + document.type);

  var timeline = document.getTimeline(), frames = [], frame;
  if (__captureRange !== null) {
    var range = __captureRange, step = range.step === undefined ? 1 : range.step;
    if (range.start < 1 || range.end < range.start || step < 1 || Math.floor(range.start) !== range.start ||
      Math.floor(range.end) !== range.end || Math.floor(step) !== step) {
      throw new Error("Invalid capture range");
    }
    if (Math.floor((range.end - range.start) / step) + 1 > 24) throw new Error("Capture range cannot exceed 24 frames");
    if (range.end > timeline.frameCount) {
      throw new Error("Frame " + range.end + " does not exist (timeline has " + timeline.frameCount + " frames)");
    }
    for (frame = range.start; frame <= range.end; frame += step) frames.push(frame);
  } else {
    frame = __captureFrame === null ? timeline.currentFrame + 1 : __captureFrame;
    if (frame < 1 || frame > timeline.frameCount) {
      throw new Error("Frame " + frame + " does not exist (timeline has " + timeline.frameCount + " frames)");
    }
    frames.push(frame);
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

  /** Left-pads a value with zeroes to the requested width.
   * @param value Value to format.
   * @param length Minimum output width.
   * @returns The zero-padded text.
   */
  function pad(value, length) {
    var text = String(value);
    while (text.length < length) text = "0" + text;
    return text;
  }
  /** Formats a date with millisecond precision for a capture filename.
   * @param date Date to format.
   * @returns A compact sortable timestamp.
   */
  function timestamp(date) {
    return pad(date.getFullYear(), 4) + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2) + "-" +
      pad(date.getHours(), 2) + pad(date.getMinutes(), 2) + pad(date.getSeconds(), 2) + "-" + pad(date.getMilliseconds(), 3);
  }

  var outputURIs = [];
  try {
    var captures = [];
    for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      frame = frames[frameIndex];
      if (__captureRange !== null || __captureFrame !== null) timeline.currentFrame = frame - 1;
      var date = new Date(), outputPath, outputURI;
      // Bump the timestamp by 1 ms on collision so an existing capture is never overwritten.
      do {
        outputPath = outputDir + "/" + frame + "-" + timestamp(date) + ".png";
        outputURI = FLfile.platformPathToURI(outputPath);
        if (FLfile.exists(outputURI)) date.setTime(date.getTime() + 1);
      } while (FLfile.exists(outputURI));

      outputURIs.push(outputURI);
      if (!document.exportPNG(outputURI, true, true) || !FLfile.exists(outputURI)) {
        throw new Error("Capture export failed");
      }
      var capture = { path: outputPath, frame: frame, timeline: timeline.name, width: document.width, height: document.height };
      if (typeof __captureIncludeDocumentURI !== "undefined" && __captureIncludeDocumentURI) {
        capture.pathURI = document.pathURI;
      }
      captures.push(capture);
    }
    return serialize(__captureRange === null ? captures[0] : { captures: captures });
  } catch (error) {
    var cleanupError = null;
    for (var outputIndex = 0; outputIndex < outputURIs.length; outputIndex++) {
      try {
        if (FLfile.exists(outputURIs[outputIndex])) FLfile.remove(outputURIs[outputIndex]);
        if (FLfile.exists(outputURIs[outputIndex])) cleanupError = new Error("Could not remove failed capture " + outputURIs[outputIndex]);
      } catch (removeError) {
        cleanupError = removeError;
      }
    }
    if (cleanupError) {
      throw new Error(String(error && error.message ? error.message : error) + "; capture cleanup failed: " +
        String(cleanupError && cleanupError.message ? cleanupError.message : cleanupError));
    }
    throw error;
  } finally {
    timeline.currentFrame = originalFrame;
  }
})()
