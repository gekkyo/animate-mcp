  /** Applies a layer operation.
   * @param op The layer operation to apply.
   * @returns Nothing.
   */
  function applyLayerOp(op) {
    var layerIndex, layer, parent, placementIndex, addAbove, returnedIndex, desiredIndex, currentParent;
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
