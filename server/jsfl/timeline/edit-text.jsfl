// `var __docName`, `var __timelineRef`, and `var __ops` are injected before this file.
(function () {
  var document = selectDocument();
  var originalTimeline = document.getTimeline(), originalLayer = originalTimeline.layers[originalTimeline.currentLayer];
  var originalFrame = originalTimeline.currentFrame;
  var originalSelectedFrames = originalTimeline.getSelectedFrames ? originalTimeline.getSelectedFrames() : null;
  var originalSelection = document.selection ? document.selection.slice() : [];
  var targetLayerState = null, targetFrameState = null, targetSelection = [];
  var originalSelectedFrameLayers = editSelectedFrameLayers(originalTimeline, originalSelectedFrames);
  var resolved = [], resultElements = [], layersToUnlock = [], plannedLayers = [];
  var TEXT_ATTR_FIELDS = ['face', 'size', 'fillColor', 'bold', 'italic'];
  var STYLE_FIELDS = TEXT_ATTR_FIELDS.concat(['alignment', 'textType', 'lineType']);

  function validateRectangle(rectangle) {
    if (!rectangle || typeof rectangle !== 'object' || rectangle instanceof Array) throw new Error('rectangle is required');
    var fields = ['left', 'top', 'right', 'bottom'];
    for (var index = 0; index < fields.length; index++) {
      if (typeof rectangle[fields[index]] !== 'number' || !isFinite(rectangle[fields[index]])) throw new Error('rectangle.' + fields[index] + ' must be finite');
    }
    if (rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top) throw new Error('rectangle must have positive width and height');
  }

  function validateStyle(style) {
    if (style === undefined) return;
    if (!style || typeof style !== 'object' || style instanceof Array) throw new Error('style must be an object');
    var fieldCount = 0;
    for (var property in style) {
      fieldCount++;
      if (STYLE_FIELDS.indexOf(property) < 0) throw new Error('Unsupported text style field: ' + property);
    }
    if (!fieldCount) throw new Error('style requires at least one field');
    if (style.face !== undefined && (typeof style.face !== 'string' || !style.face)) throw new Error('face must be a non-empty string');
    if (style.size !== undefined && (typeof style.size !== 'number' || !isFinite(style.size) || style.size <= 0)) throw new Error('size must be a positive finite number');
    if (style.fillColor !== undefined && (typeof style.fillColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(style.fillColor))) throw new Error('fillColor must be a #RRGGBB color');
    if (style.bold !== undefined && typeof style.bold !== 'boolean') throw new Error('bold must be a boolean');
    if (style.italic !== undefined && typeof style.italic !== 'boolean') throw new Error('italic must be a boolean');
    if (style.alignment !== undefined && ['left', 'center', 'right', 'justify'].indexOf(style.alignment) < 0) throw new Error('Invalid alignment: ' + style.alignment);
    if (style.textType !== undefined && ['static', 'dynamic', 'input'].indexOf(style.textType) < 0) throw new Error('Invalid textType: ' + style.textType);
    if (style.lineType !== undefined && ['single line', 'multiline', 'multiline no wrap'].indexOf(style.lineType) < 0) throw new Error('Invalid lineType: ' + style.lineType);
    if (document.type === 'htmlcanvas' && style.textType === 'input') throw new Error('Canvas does not support textType: input');
    if (document.type === 'htmlcanvas' && style.lineType === 'single line') throw new Error('Canvas does not support lineType: single line');
  }

  function validateLineType(style, existingTextType, isAdd) {
    if (!style || style.lineType === undefined) return;
    var textType = style.textType !== undefined ? style.textType : existingTextType;
    if (textType !== 'dynamic' && textType !== 'input') {
      throw new Error(isAdd ? 'lineType requires textType: dynamic or input' : 'lineType can only be set on dynamic or input text');
    }
  }

  function rejectTween(layer, frameIndex) {
    if (!layer || !layer.frames.length) return;
    var checkedIndex = Math.min(frameIndex, layer.frames.length - 1), frame = layer.frames[checkedIndex];
    var span = frame && layer.frames[frame.startFrame];
    if (span && (span.tweenType || 'none') !== 'none') throw new Error('Cannot edit text in a tween span');
  }

  function addLayerToUnlock(layer) {
    if (!layer) return;
    for (var index = 0; index < layersToUnlock.length; index++) if (layersToUnlock[index] === layer) return;
    layersToUnlock.push(layer);
  }

  function readText(element) {
    return {
      type: 'text',
      name: element.name || '',
      text: element.getTextString ? element.getTextString() : '',
      style: readTextStyle(element)
    };
  }

  function applyText(element, op) {
    if (op.text !== undefined) element.setTextString(op.text);
    var style = op.style || {};
    for (var index = 0; index < TEXT_ATTR_FIELDS.length; index++) {
      var field = TEXT_ATTR_FIELDS[index];
      if (style[field] !== undefined) element.setTextAttr(field, style[field]);
    }
    if (style.alignment !== undefined) element.alignment = style.alignment;
    if (style.textType !== undefined) element.textType = style.textType;
    if (style.lineType !== undefined) element.lineType = style.lineType;
  }

  var session = null;
  try {
    session = withTimelineEdit(document, __timelineRef, function (timeline) {
    targetLayerState = timeline.layers[timeline.currentLayer];
    targetFrameState = timeline.currentFrame;
    targetSelection = document.selection ? document.selection.slice() : [];

    try {
    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex], frameIndex = op.frame - 1;
      if (Math.floor(op.frame) !== op.frame || op.frame < 1) throw new Error('frame must be a positive integer');
      validateStyle(op.style);
      if (op.op === 'add') {
        if (typeof op.layer !== 'string' || !op.layer) throw new Error('layer must be a non-empty name');
        if (typeof op.text !== 'string' || !op.text.length) throw new Error('text must be a non-empty string');
        validateRectangle(op.rectangle);
        validateLineType(op.style, null, true);
        var addLayer = resolveEditAddLayer(timeline, op.layer);
        if (addLayer && addLayer.layerType === 'folder') throw new Error('Cannot add text to a folder layer: ' + op.layer);
        rejectTween(addLayer, frameIndex);
        resolved.push({ kind: 'add', op: op, layer: addLayer, layerPlan: addLayer ? null : plannedEditLayer(plannedLayers, op.layer) });
        addLayerToUnlock(addLayer);
        continue;
      }
      if (op.op !== 'set') throw new Error('Unsupported edit_text operation: ' + op.op);
      var layer = timeline.layers[resolveEditLayerIndex(timeline, op.layer)];
      if (layer.layerType === 'folder') throw new Error('Cannot edit text on a folder layer: ' + layer.name);
      if (frameIndex >= layer.frames.length || !layer.frames[frameIndex]) throw new Error('Frame not found: ' + op.frame);
      var frame = layer.frames[frameIndex];
      if (frame.startFrame !== frameIndex) {
        var span = layer.frames[frame.startFrame];
        if (span && (span.tweenType || 'none') !== 'none') throw new Error('Frame is inside a tween; only keyframes can be edited');
        throw new Error('Frame is not a keyframe; only keyframes can be edited');
      }
      var elements = frame.elements || [], elementIndex = resolveEditElement(elements, op.element), element = elements[elementIndex];
      if (!element || element.elementType !== 'text') throw new Error('Only text elements can be edited');
      if (op.text === undefined && op.style === undefined) throw new Error('set requires text or style');
      validateLineType(op.style, element.textType, false);
      op.layerName = layer.name;
      resolved.push({ kind: 'set', op: op, layer: layer, frame: frame, element: element, layerIndex: editLayerPosition(timeline, layer), elementIndex: elementIndex });
      addLayerToUnlock(layer);
    }

    withEditUnlockedLayers(layersToUnlock, function () {
      for (var resolvedIndex = 0; resolvedIndex < resolved.length; resolvedIndex++) {
        var entry = resolved[resolvedIndex], operation = entry.op, targetLayer = entry.layer;
        if (entry.kind === 'add') {
          if (!targetLayer) {
            var plan = entry.layerPlan;
            if (!plan.layer) {
              timeline.currentLayer = 0;
              var createdIndex = timeline.addNewLayer(plan.name, 'normal', true);
              targetLayer = timeline.layers[createdIndex];
              targetLayer.parentLayer = null;
              plan.layer = targetLayer;
            } else targetLayer = plan.layer;
          }
          var targetLayerIndex = editLayerPosition(timeline, targetLayer), targetFrameIndex = operation.frame - 1;
          if (targetLayerIndex < 0) throw new Error('Layer disappeared: ' + operation.layer);
          timeline.currentLayer = targetLayerIndex;
          if (targetFrameIndex >= targetLayer.frames.length) timeline.insertFrames(targetFrameIndex - targetLayer.frames.length + 1, false, targetLayer.frames.length - 1);
          timeline.currentLayer = targetLayerIndex;
          timeline.currentFrame = targetFrameIndex;
          var targetFrame = targetLayer.frames[targetFrameIndex];
          if (!targetFrame) throw new Error('Could not extend layer to frame: ' + operation.frame);
          if (targetFrame.startFrame !== targetFrameIndex) {
            timeline.insertKeyframe(targetFrameIndex);
            targetFrame = targetLayer.frames[targetFrameIndex];
          }
          if (!targetFrame || targetFrame.startFrame !== targetFrameIndex) throw new Error('Could not create keyframe: ' + operation.frame);
          var previousElements = (targetFrame.elements || []).slice();
          document.addNewText(operation.rectangle);
          var addedElement = null, addedIndex = -1, currentElements = targetFrame.elements || [];
          for (var currentIndex = 0; currentIndex < currentElements.length; currentIndex++) {
            var existed = false;
            for (var previousIndex = 0; previousIndex < previousElements.length; previousIndex++) if (currentElements[currentIndex] === previousElements[previousIndex]) existed = true;
            if (!existed && currentElements[currentIndex].elementType === 'text') {
              if (addedElement) throw new Error('Animate added more than one text element');
              addedElement = currentElements[currentIndex];
              addedIndex = currentIndex;
            }
          }
          if (!addedElement) throw new Error('Animate did not add a text element');
          applyText(addedElement, operation);
          var addedResult = readText(addedElement);
          addedResult.layer = targetLayer.name;
          addedResult.frame = operation.frame;
          addedResult.element = addedIndex;
          resultElements.push(addedResult);
          continue;
        }
        var setLayerIndex = editLayerPosition(timeline, entry.layer);
        if (setLayerIndex < 0) throw new Error('Layer disappeared: ' + operation.layerName);
        timeline.currentLayer = setLayerIndex;
        timeline.currentFrame = entry.frame.startFrame;
        applyText(entry.element, operation);
        var setResult = readText(entry.element);
        setResult.layer = operation.layerName;
        setResult.frame = operation.frame;
        setResult.element = entry.elementIndex;
        resultElements.push(setResult);
      }
    });
    return serialize({ applied: resultElements.length, elements: resultElements });
    } finally {
    if (timeline && targetLayerState) {
      if (document.selectNone) document.selectNone();
      var targetLayerIndex = editLayerPosition(timeline, targetLayerState);
      if (targetLayerIndex >= 0) timeline.currentLayer = targetLayerIndex;
      timeline.currentFrame = targetFrameState;
      for (var targetSelectionIndex = 0; targetSelectionIndex < targetSelection.length; targetSelectionIndex++) targetSelection[targetSelectionIndex].selected = true;
    }
    }
    });
    for (var warningIndex = 0; warningIndex < session.warnings.length; warningIndex++) fl.trace(session.warnings[warningIndex]);
  } finally {
    var restoredTimeline = document.getTimeline();
    restoreEditSelectedFrames(restoredTimeline, originalSelectedFrames, originalSelectedFrameLayers);
    var originalLayerIndex = editLayerPosition(restoredTimeline, originalLayer);
    if (originalLayerIndex >= 0) restoredTimeline.currentLayer = originalLayerIndex;
    restoredTimeline.currentFrame = originalFrame;
    if (document.selectNone) document.selectNone();
    for (var originalSelectionIndex = 0; originalSelectionIndex < originalSelection.length; originalSelectionIndex++) originalSelection[originalSelectionIndex].selected = true;
  }

  return session.result;
})();
