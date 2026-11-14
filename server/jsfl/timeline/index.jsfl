  var document = selectDocument(), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
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
    var session = withTimelineEdit(document, __timelineRef, function (targetTimeline) {
      timeline = targetTimeline;

    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        if (op.op === 'addLayer' || op.op === 'deleteLayer' || op.op === 'moveLayer' || op.op === 'renameLayer' || op.op === 'setLayerType' || op.op === 'distributeToLayers') {
          applyLayerOp(op);
        } else {
          applyFrameOp(op);
        }
        applied.push(op);
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
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
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    restoredTimeline.currentFrame = originalFrame;
  }

  return serialize({ applied: applied, failed: failed, skipped: skipped, warnings: warnings, layers: listLayers() });
})();
