  var document = selectDocument(), restore = saveEditState(document), timeline = null;
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.currentLayer;
  var originalFrame = originalTimeline.currentFrame, applied = [], failed = null, skipped = [], warnings = [];

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
    if (typeof __timelineRef === 'number') {
      timeline = document.timelines[__timelineRef];
      if (!timeline || Math.floor(__timelineRef) !== __timelineRef || __timelineRef < 0) throw new Error('Scene not found');
    } else {
      var itemFound = false;
      for (var itemIndex = 0; itemIndex < document.library.items.length; itemIndex++) {
        if (document.library.items[itemIndex].name === __timelineRef) itemFound = true;
      }
      if (!itemFound) throw new Error('Library item not found: ' + __timelineRef);
      document.library.editItem(__timelineRef);
      timeline = document.getTimeline();
    }

    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        if (op.op === 'addLayer' || op.op === 'deleteLayer' || op.op === 'moveLayer' || op.op === 'renameLayer' || op.op === 'setLayerType') {
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
  } finally {
    var warning = restore();
    if (warning) warnings.push(warning);
    var restoredTimeline = document.getTimeline();
    if (originalLayer < restoredTimeline.layers.length) restoredTimeline.currentLayer = originalLayer;
    restoredTimeline.currentFrame = originalFrame;
  }

  return serialize({ applied: applied, failed: failed, skipped: skipped, warnings: warnings, layers: listLayers() });
})();
