  /** Applies a layer operation.
   * @param op The layer operation to apply.
   * @returns Nothing.
   */
  function applyLayerOp(op) {
    var layerIndex, layer, parent, placementIndex, addAbove, returnedIndex, desiredIndex, currentParent;
    if (op.op === 'distributeToLayers') {
      distributeToLayers(op);
      return;
    }
    if (op.op === 'addLayer') {
      if (op.above !== undefined && op.below !== undefined) throw new Error('Specify only one of above or below');
      parent = parentFor(op.parent, op.type || 'normal');
      if (op.above !== undefined) {
        placementIndex = findLayerIndex(op.above, undefined);
        addAbove = true;
      } else if (op.below !== undefined) {
        placementIndex = findLayerIndex(op.below, undefined);
        addAbove = false;
      } else if (parent) {
        placementIndex = findLayerIndex(parent.name, undefined);
        addAbove = false;
      } else {
        placementIndex = timeline.layers.length ? 0 : -1;
        addAbove = true;
      }
      if ((op.type || 'normal') === 'masked' && !parent) throw new Error('Parent layer is required for a masked layer');
      desiredIndex = placementIndex < 0 ? 0 : placementIndex + (addAbove ? 0 : 1);
      if (parent) {
        var parentIndexBefore = findLayerIndex(parent.name, undefined);
        var parentIndexAfter = parentIndexBefore + (desiredIndex <= parentIndexBefore ? 1 : 0);
        if (desiredIndex <= parentIndexAfter) throw new Error('Parent must appear above the layer');
      }
      timeline.currentLayer = placementIndex < 0 ? 0 : placementIndex;
      returnedIndex = timeline.addNewLayer(op.name, op.type || 'normal', addAbove);
      layer = timeline.layers[returnedIndex];
      layer.parentLayer = parent;
      if (parent) validateParentPosition(returnedIndex, parent);
      return;
    }

    layerIndex = findLayerIndex(op.layer, op.index);
    layer = timeline.layers[layerIndex];
    if (op.op === 'deleteLayer') {
      if (op.confirm !== true) throw new Error('confirm required');
      /** Deletes the selected layer.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () { timeline.deleteLayer(layerIndex); });
      return;
    }
    if (op.op === 'renameLayer') {
      /** Renames the selected layer.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () { layer.name = op.name; });
      return;
    }
    if (op.op === 'setLayerType') {
      parent = parentFor(op.parent, op.type);
      currentParent = layer.parentLayer || null;
      if (!parent && currentParent && op.parent === undefined) {
        if (op.type === 'masked' && currentParent.layerType === 'mask') parent = currentParent;
        if (op.type !== 'masked' && currentParent.layerType === 'folder') parent = currentParent;
      }
      if (op.type === 'masked' && !parent) throw new Error('Parent layer is required for a masked layer');
      if (parent) validateParentPosition(layerIndex, parent);
      /** Updates the selected layer's type and parent.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () {
        layer.layerType = op.type;
        layer.parentLayer = parent;
      });
      return;
    }
    if (op.op === 'moveLayer') {
      if (op.above !== undefined && op.below !== undefined) throw new Error('Specify only one of above or below');
      currentParent = layer.parentLayer || null;
      parent = op.parent === undefined ? currentParent : parentFor(op.parent, layer.layerType);
      if (op.above !== undefined) {
        placementIndex = findLayerIndex(op.above, undefined);
        if (placementIndex === layerIndex) throw new Error('Cannot place a layer relative to itself');
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0);
        addAbove = true;
      } else if (op.below !== undefined) {
        placementIndex = findLayerIndex(op.below, undefined);
        if (placementIndex === layerIndex) throw new Error('Cannot place a layer relative to itself');
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0) + 1;
        addAbove = false;
      } else if (parent) {
        placementIndex = findLayerIndex(parent.name, undefined);
        desiredIndex = placementIndex - (layerIndex < placementIndex ? 1 : 0) + 1;
        addAbove = false;
      } else {
        placementIndex = 0;
        desiredIndex = 0;
        addAbove = true;
      }
      if (parent) {
        var moveParentIndex = findLayerIndex(parent.name, undefined);
        var moveParentAfter = moveParentIndex - (layerIndex < moveParentIndex ? 1 : 0);
        if (desiredIndex <= moveParentAfter) throw new Error('Parent must appear above the layer');
      }
      /** Reorders the selected layer and optionally changes its parent.
       * @returns Nothing.
       */
      withUnlockedLayers([layer], function () {
        if (placementIndex !== layerIndex) timeline.reorderLayer(layerIndex, placementIndex, addAbove);
        if (op.parent !== undefined) layer.parentLayer = parent;
      });
      return;
    }
  }

  /** Splits a single-span layer of symbol instances into one normal layer per instance.
   * @param op The distributeToLayers operation.
   * @returns Nothing.
   */
  function distributeToLayers(op) {
    var layerIndex = findLayerIndex(op.layer, op.index), sourceLayer = timeline.layers[layerIndex];
    var keyframes = [], sourceFrame, elements, names, usedNames = {}, created = [], nativeDistribution = false, wasLocked = sourceLayer.locked === true;
    var parent = sourceLayer.parentLayer || null, spanLength, originalElements = [], oldCurrentFrame = timeline.currentFrame;
    var oldCurrentLayer = timeline.currentLayer, oldCurrentLayerObject = timeline.layers[oldCurrentLayer];
    for (var frameIndex = 0; frameIndex < sourceLayer.frames.length; frameIndex++) {
      if (sourceLayer.frames[frameIndex] && sourceLayer.frames[frameIndex].startFrame === frameIndex) keyframes.push(sourceLayer.frames[frameIndex]);
    }
    if (keyframes.length !== 1) throw new Error('Source layer must have exactly one keyframe span');
    sourceFrame = keyframes[0];
    if (sourceFrame.tweenType && sourceFrame.tweenType !== 'none') throw new Error('Source layer cannot contain a tween');
    if (sourceFrame.actionScript || sourceFrame.name) throw new Error('Source layer cannot contain frame ActionScript or a label');
    elements = sourceFrame.elements || [];
    for (var existingIndex = 0; existingIndex < timeline.layers.length; existingIndex++) {
      if (timeline.layers[existingIndex] !== sourceLayer) usedNames[timeline.layers[existingIndex].name] = true;
    }
    names = [];
    for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
      var element = elements[elementIndex], item = element.libraryItem;
      if (element.elementType !== 'instance' || !item || (item.itemType !== 'movie clip' && item.itemType !== 'graphic' && item.itemType !== 'button')) {
        throw new Error('Source layer must contain only movie clip, graphic, or button symbol instances');
      }
      var baseName = element.name || String(item.name).split('/').pop(), name = baseName, suffix = 2;
      while (usedNames[name]) name = baseName + '_' + suffix++;
      usedNames[name] = true;
      names.push(name);
      originalElements.push(element);
    }
    spanLength = sourceFrame.duration;
    sourceLayer.locked = false;
    try {
      var nativeLayers = originalElements.length ? distributeWithNative(sourceLayer, sourceFrame, originalElements, names, parent, wasLocked) : null;
      if (nativeLayers) { created = nativeLayers; nativeDistribution = true; }
      else if (originalElements.length) distributeWithCopies(sourceLayer, sourceFrame, originalElements, names, parent, wasLocked, spanLength, created);
      var sourceIndex = layerPosition(sourceLayer);
      if (sourceIndex < 0) throw new Error('Source layer disappeared before copies were complete');
      timeline.currentLayer = sourceIndex;
      timeline.deleteLayer(sourceIndex);
      sourceLayer = null;
      op.createdLayers = names.slice().reverse();
    } catch (error) {
      if (!nativeDistribution) removeCreatedLayers(created);
      throw error;
    } finally {
      if (sourceLayer && layerPosition(sourceLayer) >= 0) sourceLayer.locked = wasLocked;
      document.selectNone();
      var restoreLayer = layerPosition(oldCurrentLayerObject);
      timeline.currentLayer = restoreLayer >= 0 ? restoreLayer : Math.max(0, Math.min(oldCurrentLayer, timeline.layers.length - 1));
      timeline.currentFrame = oldCurrentFrame;
    }
  }

  /** Attempts Animate's native distribution and returns its ordered new layers, or null on failure.
   * @param sourceLayer Layer being split.
   * @param sourceFrame The layer's single keyframe.
   * @param elements Original instances to distribute.
   * @param names Layer names to apply.
   * @param parent Parent folder, if any.
   * @param locked Whether the new layers should be locked.
   * @returns New layers in source-element order, or null when native distribution is unavailable.
   */
  function distributeWithNative(sourceLayer, sourceFrame, elements, names, parent, locked) {
    if (typeof document.distributeToLayers !== 'function') return null;
    var originalLayers = timeline.layers.slice(), originalElements = [], added = [], ordered = [], nativeReturned = false;
    var originalSourceIndex = layerPosition(sourceLayer);
    for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) originalElements.push(elements[elementIndex]);
    try {
      timeline.currentLayer = layerPosition(sourceLayer);
      timeline.currentFrame = sourceFrame.startFrame;
      document.selectNone();
      for (elementIndex = 0; elementIndex < elements.length; elementIndex++) elements[elementIndex].selected = true;
      document.distributeToLayers();
      nativeReturned = true;
      for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
        var isOriginal = false;
        for (var oldIndex = 0; oldIndex < originalLayers.length; oldIndex++) {
          if (timeline.layers[layerIndex] === originalLayers[oldIndex]) isOriginal = true;
        }
        if (!isOriginal) added.push(timeline.layers[layerIndex]);
      }
      if (added.length !== elements.length) throw new Error('Native distribution created an unexpected number of layers');
      for (elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        var match = null;
        for (var addedIndex = 0; addedIndex < added.length; addedIndex++) {
          if (layerContainsElement(added[addedIndex], sourceFrame.startFrame, elements[elementIndex])) match = added[addedIndex];
        }
        if (!match) match = added[elementIndex];
        ordered.push(match);
      }
      finishDistributedLayers(ordered, names, parent, sourceLayer, locked, sourceFrame.startFrame, elements);
      return ordered;
    } catch (error) {
      var currentElements = sourceFrame.elements || [];
      var changed = nativeReturned || timeline.layers.length !== originalLayers.length || currentElements.length !== originalElements.length;
      for (var compareIndex = 0; !changed && compareIndex < originalLayers.length; compareIndex++) {
        if (timeline.layers[compareIndex] !== originalLayers[compareIndex]) changed = true;
      }
      for (compareIndex = 0; !changed && compareIndex < originalElements.length; compareIndex++) {
        if (currentElements[compareIndex] !== originalElements[compareIndex]) changed = true;
      }
      if (!changed) return null;
      var currentSourceIndex = layerPosition(sourceLayer);
      try {
        if (currentSourceIndex >= 0 && currentSourceIndex !== originalSourceIndex) timeline.reorderLayer(currentSourceIndex, originalSourceIndex, true);
      } catch (restoreError) {
        // Preserve the native failure if restoring layer order also fails.
      }
      throw new Error('Native distribution failed after modifying the timeline: ' + String(error && error.message ? error.message : error) + '. Existing layers and instances were kept; use Undo in Animate to restore the prior state.');
    }
  }

  /** Creates copies of each source instance on newly inserted layers.
   * @param sourceLayer Layer being split.
   * @param sourceFrame The layer's single keyframe.
   * @param elements Original instances to copy.
   * @param names Layer names to apply.
   * @param parent Parent folder, if any.
   * @param locked Whether the new layers should be locked.
   * @param spanLength Source keyframe duration.
   * @param createdLayers Output list that tracks layers for rollback.
   * @returns The created layers in source-element order.
   */
  function distributeWithCopies(sourceLayer, sourceFrame, elements, names, parent, locked, spanLength, createdLayers) {
    for (var elementIndex = elements.length - 1; elementIndex >= 0; elementIndex--) {
      var sourceElement = elements[elementIndex], sourceIndex = layerPosition(sourceLayer);
      timeline.currentLayer = sourceIndex;
      var newIndex = timeline.addNewLayer(names[elementIndex], 'normal', true), newLayer = timeline.layers[newIndex];
      createdLayers.push(newLayer);
      newLayer.parentLayer = parent;
      copyLayerAppearance(sourceLayer, newLayer);
      timeline.currentLayer = newIndex;
      timeline.currentFrame = sourceFrame.startFrame;
      if (document.library.addItemToDocument) {
        document.library.addItemToDocument({ x: sourceElement.x, y: sourceElement.y }, sourceElement.libraryItem.name);
      } else if (document.addItem) {
        document.library.selectItem(sourceElement.libraryItem.name);
        document.addItem({ x: sourceElement.x, y: sourceElement.y }, sourceElement.libraryItem);
      } else {
        throw new Error('Animate cannot add a library item to the timeline');
      }
      var targetFrame = newLayer.frames[sourceFrame.startFrame], targetElements = targetFrame && targetFrame.elements;
      if (!targetElements || targetElements.length !== 1) throw new Error('Could not add one symbol instance to layer ' + names[elementIndex]);
      copyInstanceProperties(sourceElement, targetElements[0]);
      ensureSpanLength(newLayer, spanLength);
      if (targetElements[0].name !== sourceElement.name || !sameMatrix(sourceElement.matrix, targetElements[0].matrix)) {
        throw new Error('Copied instance verification failed on layer ' + names[elementIndex]);
      }
      newLayer.locked = locked;
    }
    return createdLayers;
  }

  /** Applies names, hierarchy, appearance, and lock state to distributed layers and verifies their elements.
   * @param layers New layers to finalize.
   * @param names Desired names.
   * @param parent Parent folder, if any.
   * @param sourceLayer Original layer used for appearance settings.
   * @param locked Whether new layers should be locked.
   * @param frameIndex Zero-based source keyframe index.
   * @param elements Original instances.
   * @returns Nothing.
   */
  function finishDistributedLayers(layers, names, parent, sourceLayer, locked, frameIndex, elements) {
    for (var layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
      var targetLayer = layers[layerIndex], targetIndex = layerPosition(targetLayer), sourceIndex = layerPosition(sourceLayer);
      if (targetIndex < 0) throw new Error('Native distribution layer disappeared');
      if (targetIndex !== sourceIndex - 1) timeline.reorderLayer(targetIndex, sourceIndex, true);
      targetLayer.name = names[layerIndex];
      targetLayer.layerType = 'normal';
      targetLayer.parentLayer = parent;
      copyLayerAppearance(sourceLayer, targetLayer);
      var frame = targetLayer.frames[frameIndex], frameElements = frame && frame.elements;
      if (!frameElements || frameElements.length !== 1 || frameElements[0].name !== elements[layerIndex].name || !sameMatrix(elements[layerIndex].matrix, frameElements[0].matrix)) {
        throw new Error('Native distribution instance verification failed on layer ' + names[layerIndex]);
      }
    }
    for (layerIndex = 0; layerIndex < layers.length; layerIndex++) layers[layerIndex].locked = locked;
  }

  /** Copies appearance settings from the source layer.
   * @param sourceLayer Original layer.
   * @param targetLayer New layer.
   * @returns Nothing.
   */
  function copyLayerAppearance(sourceLayer, targetLayer) {
    var properties = ['visible', 'outline', 'outlineColor', 'color'];
    for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      var property = properties[propertyIndex];
      if (sourceLayer[property] !== undefined) targetLayer[property] = sourceLayer[property];
    }
  }

  /** Copies Animate instance attributes from an original to its library-item copy.
   * @param source Original symbol instance.
   * @param target Newly inserted symbol instance.
   * @returns Nothing.
   */
  function copyInstanceProperties(source, target) {
    var properties = [
      'name', 'colorMode', 'blendMode',
      'visible', 'cacheAsBitmap', 'loop', 'firstFrame', 'lastFrame', 'trackAsMenu'
    ];
    for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      var property = properties[propertyIndex];
      if (source[property] !== undefined) target[property] = source[property];
    }
    if (source.colorMode === 'alpha') {
      target.colorAlphaPercent = source.colorAlphaPercent;
      target.colorAlphaAmount = source.colorAlphaAmount;
    } else if (source.colorMode === 'brightness') {
      document.selectNone();
      target.selected = true;
      document.setInstanceBrightness(source.brightness);
    } else if (source.colorMode === 'tint') {
      document.selectNone();
      target.selected = true;
      document.setInstanceTint(source.tintColor, source.tintPercent);
    } else if (source.colorMode === 'advanced') {
      target.colorRedPercent = source.colorRedPercent;
      target.colorGreenPercent = source.colorGreenPercent;
      target.colorBluePercent = source.colorBluePercent;
      target.colorRedAmount = source.colorRedAmount;
      target.colorGreenAmount = source.colorGreenAmount;
      target.colorBlueAmount = source.colorBlueAmount;
    }
    var sourcePoint = source.getTransformationPoint ? source.getTransformationPoint() : source.transformationPoint;
    var filters = [], sourceFilters = source.filters || [];
    for (var filterIndex = 0; filterIndex < sourceFilters.length; filterIndex++) {
      var filter = {}, sourceFilter = sourceFilters[filterIndex];
      for (var filterProperty in sourceFilter) filter[filterProperty] = sourceFilter[filterProperty];
      filters.push(filter);
    }
    if (source.filters !== undefined) target.filters = filters;
    if (source.matrix !== undefined) target.matrix = source.matrix;
    if (sourcePoint && target.setTransformationPoint) {
      var expectedPoint = { x: sourcePoint.x, y: sourcePoint.y };
      target.setTransformationPoint(expectedPoint);
      var actualPoint = target.getTransformationPoint();
      for (var attempt = 0; attempt < 3 && !samePoint(expectedPoint, actualPoint); attempt++) {
        target.setTransformationPoint({
          x: expectedPoint.x + expectedPoint.x - actualPoint.x,
          y: expectedPoint.y + expectedPoint.y - actualPoint.y
        });
        actualPoint = target.getTransformationPoint();
      }
      if (!samePoint(expectedPoint, actualPoint)) throw new Error('Could not copy the instance transformation point');
    } else if (sourcePoint !== undefined) target.transformationPoint = sourcePoint;
  }

  /** Ensures a new layer's single keyframe has exactly the requested duration.
   * @param layer Layer to resize.
   * @param length Desired keyframe duration.
   * @returns Nothing.
   */
  function ensureSpanLength(layer, length) {
    var layerIndex = layerPosition(layer), currentLength = layer.frames.length;
    if (currentLength === length) return;
    timeline.currentLayer = layerIndex;
    if (currentLength > length) timeline.removeFrames(length, currentLength);
    else timeline.insertFrames(length - currentLength, false, currentLength - 1);
  }

  /** Verifies whether a layer contains a specific instance at a frame.
   * @param layer Candidate layer.
   * @param frameIndex Zero-based frame index.
   * @param element Instance to find.
   * @returns Whether the instance is present.
   */
  function layerContainsElement(layer, frameIndex, element) {
    var frame = layer.frames[frameIndex];
    if (!frame || !frame.elements) return false;
    for (var elementIndex = 0; elementIndex < frame.elements.length; elementIndex++) {
      if (frame.elements[elementIndex] === element) return true;
    }
    return false;
  }

  /** Compares the six values that define an Animate transformation matrix.
   * @param left First matrix.
   * @param right Second matrix.
   * @returns Whether the matrix values match.
   */
  function sameMatrix(left, right) {
    if (!left || !right) return false;
    var properties = ['a', 'b', 'c', 'd', 'tx', 'ty'];
    for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      if (left[properties[propertyIndex]] !== right[properties[propertyIndex]]) return false;
    }
    return true;
  }

  /** Compares transformation-point coordinates.
   * @param left First transformation point.
   * @param right Second transformation point.
   * @returns Whether both coordinates match.
   */
  function samePoint(left, right) {
    return left && right && left.x === right.x && left.y === right.y;
  }

  /** Removes operation-created layers without touching the source layer.
   * @param layers Layers created by the current operation.
   * @returns Nothing.
   */
  function removeCreatedLayers(layers) {
    for (var layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
      var index = layerPosition(layers[layerIndex]);
      if (index >= 0) {
        layers[layerIndex].locked = false;
        timeline.deleteLayer(index);
      }
    }
  }
