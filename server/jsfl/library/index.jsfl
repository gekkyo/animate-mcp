(function () {
  var document = selectDocument(), restore = saveEditState(document), originalTimeline = document.getTimeline();
  var originalLayer = originalTimeline.layers[originalTimeline.currentLayer], originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelection = document.selection ? document.selection.slice() : [];
  var originalLibrarySelection = document.library.getSelectedItems();
  var applied = [], results = [], failed = null, skipped = [], warnings = [];
  var ctx = { document: document, warnings: warnings, libraryChanged: false };

  /** Checks whether an element reference still belongs to a timeline.
   * @param timeline Timeline to scan.
   * @param target Element object to locate.
   * @returns Whether the timeline contains the exact element object.
   */
  function containsElement(timeline, target) {
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      var frames = timeline.layers[layerIndex].frames;
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        var elements = frames[frameIndex] && frames[frameIndex].elements || [];
        for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
          if (elements[elementIndex] === target) return true;
        }
      }
    }
    return false;
  }

  /** Restores selected frames, current layer and frame, and surviving stage selections.
   * @param timeline Timeline whose state is restored.
   * @returns Nothing.
   */
  function restoreTimelineState(timeline) {
    if (originalSelectedFrames && originalSelectedFrames.length && timeline.setSelectedFrames) {
      timeline.setSelectedFrames(originalSelectedFrames);
    }
    // Resolve the saved layer by object identity because preceding operations may reorder layers.
    var layerIndex = -1;
    for (var index = 0; index < timeline.layers.length; index++) {
      if (timeline.layers[index] === originalLayer) layerIndex = index;
    }
    if (layerIndex >= 0) timeline.currentLayer = layerIndex;
    timeline.currentFrame = originalFrame;
    document.selectNone();
    for (var selectionIndex = 0; selectionIndex < originalSelection.length; selectionIndex++) {
      if (containsElement(timeline, originalSelection[selectionIndex])) originalSelection[selectionIndex].selected = true;
    }
  }

  /** Restores the original Library selection, excluding items that no longer exist.
   * @returns Nothing.
   */
  function restoreLibrarySelection() {
    document.library.selectNone();
    for (var index = 0; index < originalLibrarySelection.length; index++) {
      var selected = originalLibrarySelection[index], exists = false;
      for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
        if (document.library.items[itemIndex] === selected) exists = true;
      }
      if (exists) document.library.selectItem(selected.name, false);
    }
  }

  try {
    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        var result = applyLibraryOp(ctx, op);
        applied.push(op);
        results.push({ op: op, result: result });
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
        for (var skippedIndex = opIndex + 1; skippedIndex < __ops.length; skippedIndex++) skipped.push(__ops[skippedIndex]);
        break;
      }
    }
  } finally {
    if (ctx.libraryChanged) {
      var warning = restore();
      if (warning) warnings.push(warning);
      try {
        restoreTimelineState(document.getTimeline());
      } catch (stateError) {
        warnings.push("Timeline state was not restored: " + String(stateError && stateError.message ? stateError.message : stateError));
      }
      try {
        restoreLibrarySelection();
      } catch (selectionError) {
        warnings.push("Library selection was not restored: " + String(selectionError && selectionError.message ? selectionError.message : selectionError));
      }
    }
  }

  return serialize({ applied: applied, results: results, failed: failed, skipped: skipped, warnings: warnings });
  })();
