// @requires shared/select-document, shared/edit-state, shared/export-common, timeline/layers, timeline/frames
(function () {
  var document = selectDocument(), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayerIndex = originalTimeline.currentLayer;
  var originalLayer = originalTimeline.layers[originalLayerIndex];
  var originalFrame = originalTimeline.currentFrame, applied = [], failed = null, skipped = [], warnings = [];
  var targetSelectedFramesAfter = null;

  /** Returns the final layer list.
   * @returns The current layers and their parent relationships.
   */
  function listLayers() {
    var result = [];
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      var layer = timeline.layers[layerIndex], entry = {
        name: layer.name,
        type: layer.layerType,
        locked: layer.locked === true
      };
      if (layer.parentLayer) entry.parent = layer.parentLayer.name;
      result.push(entry);
    }
    return result;
  }

  try {
    var session = withTimelineEdit(document, __timelineRef, /** Applies requested layer and frame operations.
     * @param targetTimeline Timeline selected for editing.
     * @returns Nothing.
     */
    function (targetTimeline) {
      timeline = targetTimeline;
      var ctx = { document: document, timeline: timeline, warnings: warnings };

    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        if (op.op === 'addLayer' || op.op === 'deleteLayer' || op.op === 'moveLayer' || op.op === 'renameLayer' || op.op === 'setLayerType' || op.op === 'distributeToLayers') {
          applyLayerOp(ctx, op);
        } else {
          applyFrameOp(ctx, op);
        }
        applied.push(op);
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
        warnings.push('Operation ' + (opIndex + 1) + ' (' + op.op + ') failed and may have been partially applied; check the timeline or use Undo.');
        for (var skippedIndex = opIndex + 1; skippedIndex < __ops.length; skippedIndex++) skipped.push(__ops[skippedIndex]);
        break;
      }
    }
      targetSelectedFramesAfter = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null;
    });
    warnings = warnings.concat(session.warnings);
    if (targetSelectedFramesAfter && timeline.setSelectedFrames) timeline.setSelectedFrames(targetSelectedFramesAfter);
  } finally {
    var restoredTimeline = document.getTimeline();
    var restoredLayerIndex = editLayerPosition(restoredTimeline, originalLayer);
    if (restoredLayerIndex >= 0) restoredTimeline.currentLayer = restoredLayerIndex;
    else if (restoredTimeline.layers.length) restoredTimeline.currentLayer = Math.max(0, Math.min(originalLayerIndex, restoredTimeline.layers.length - 1));
    restoredTimeline.currentFrame = originalFrame;
  }

  return serialize({ applied: applied, failed: failed, skipped: skipped, warnings: warnings, layers: listLayers() });
})();
