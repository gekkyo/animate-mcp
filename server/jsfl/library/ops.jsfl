// @requires library/helpers
  /** Lists unused library items and identifies linkage-bearing entries.
   * @param ctx Description.
   * @returns Item names, types, and optional linkage flags.
   */
  function listUnusedItems(ctx) {
    var unusedItems = ctx.document.library.unusedItems || [], results = [];
    for (var itemIndex = 0; itemIndex < unusedItems.length; itemIndex++) {
      var item = unusedItems[itemIndex], result = { name: item.name, itemType: item.itemType };
      if (containsLibraryLinkage(ctx.document, item.name, item)) {
        result.linkage = true;
      }
      results.push(result);
    }
    return results;
  }

  /** Returns direct placements of an item in scene and symbol keyframes.
   * @param ctx Document and operation state.
    * @param path Library item path.
   * @returns Direct placement locations.
   */
  function findLibraryUsages(ctx, path) {
    var item = findLibraryItem(ctx.document, path), usages = [];
    if (!item) throw new Error("Library item not found: " + path);

    /** Collects direct placements of the requested item on one timeline.
     * @param ctx Description.
     * @param timeline Timeline to scan.
     * @param timelineName Name or index used in usage results.
     * @returns Nothing.
     */
    function scanTimeline(timeline, timelineName) {
      for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
        var layer = timeline.layers[layerIndex];
        if (layer.layerType === "folder") continue;
        for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) {
          var frame = layer.frames[frameIndex];
          if (!frame || frame.startFrame !== frameIndex) continue;
          if (frame.soundLibraryItem && frame.soundLibraryItem.name === path) {
            usages.push({ timeline: timelineName, layer: layer.name, frame: frameIndex + 1, element: null });
          }
          var elements = frame.elements || [];
          for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
            var element = elements[elementIndex];
            if (element.libraryItem && element.libraryItem.name === path) {
              usages.push({ timeline: timelineName, layer: layer.name, frame: frameIndex + 1, element: elementIndex });
            }
          }
        }
      }
    }

    for (var sceneIndex = 0; sceneIndex < ctx.document.timelines.length; sceneIndex++) {
      var scene = ctx.document.timelines[sceneIndex];
      scanTimeline(scene, sceneIndex);
    }
    var libraryItems = ctx.document.library.items;
    for (var itemIndex = 0; itemIndex < libraryItems.length; itemIndex++) {
      var symbol = libraryItems[itemIndex];
      if (symbol.itemType !== "movie clip" && symbol.itemType !== "button" && symbol.itemType !== "graphic") continue;
      ctx.libraryChanged = true;
      // Entering each symbol timeline enables direct placement scanning; the caller restores edit state.
      ctx.document.library.editItem(symbol.name);
      scanTimeline(ctx.document.getTimeline(), symbol.name);
    }
    return { item: path, usages: usages };
  }

  /** Creates an empty Library symbol after checking the plain name for collisions.
   * @param ctx Document and operation state.
    * @param op Symbol creation operation.
   * @returns Created symbol details.
   */
  function createLibrarySymbol(ctx, op) {
    var allowedTypes = ["movie clip", "button", "graphic"];
    if (allowedTypes.indexOf(op.type) < 0) throw new Error("Unsupported symbol type: " + op.type);
    if (typeof op.name !== "string" || !op.name || op.name.indexOf("/") >= 0) {
      throw new Error("name must be a required plain Library name without a folder path");
    }
    if (ctx.document.library.itemExists(op.name)) throw new Error("Library item already exists: " + op.name);
    ctx.libraryChanged = true;
    ctx.document.library.selectNone(); // a selected folder would receive the new item
    if (!ctx.document.library.addNewItem(op.type, op.name)) throw new Error("Library symbol creation failed: " + op.name);
    var created = findLibraryItem(ctx.document, op.name);
    if (!created) throw new Error("Library symbol creation failed: " + op.name);
    return { name: created.name, type: created.itemType };
  }

  /** Duplicates a Library item and renames Animate's generated copy.
   * @param ctx Document and operation state.
    * @param op Item duplication operation.
   * @returns The new Library item details.
   */
  function duplicateLibraryItem(ctx, op) {
    var item = findLibraryItem(ctx.document, op.item);
    if (!item) throw new Error("Library item not found: " + op.item);
    if (item.itemType === "folder") throw new Error("Library folders cannot be duplicated: " + op.item);
    if (typeof op.newName !== "string" || !op.newName || op.newName.indexOf("/") >= 0) {
      throw new Error("newName must be a required plain Library name without a folder path");
    }
    var parent = libraryParent(op.item), targetPath = parent ? parent + "/" + op.newName : op.newName;
    if (ctx.document.library.itemExists(targetPath)) throw new Error("Destination item already exists: " + targetPath);

    var originalItems = ctx.document.library.items.slice();
    ctx.libraryChanged = true;
    if (!ctx.document.library.duplicateItem(op.item)) throw new Error("Library item duplication failed: " + op.item);
    var copies = [];
    for (var copyIndex = 0; copyIndex < ctx.document.library.items.length; copyIndex++) {
      var candidate = ctx.document.library.items[copyIndex], existed = false;
      for (var originalIndex = 0; originalIndex < originalItems.length; originalIndex++) {
        if (originalItems[originalIndex] === candidate) existed = true;
      }
      if (!existed && candidate.itemType === item.itemType && libraryParent(candidate.name) === parent) copies.push(candidate);
    }
    if (copies.length !== 1) throw new Error("Could not identify the duplicated Library item: " + op.item);
    try {
      withSelectedLibraryItem(ctx, copies[0], /** Renames the duplicate while it is selected.
       * @returns Nothing.
       */ function () {
        ctx.document.library.renameItem(op.newName, copies[0].name);
      });
      if (!ctx.document.library.itemExists(targetPath)) throw new Error("Library item rename failed: " + targetPath);
    } catch (error) {
      throw new Error(
        "Could not rename duplicated item; generated copy may remain as " +
          copies[0].name +
          ": " +
          String(error && error.message ? error.message : error)
      );
    }
    return { name: targetPath, itemType: item.itemType };
  }

  /** Rejects deletion when an item or any non-folder descendant is in use.
   * @param ctx Document and operation state.
    * @param path Library item path.
   * @param item The item at path.
   * @returns Nothing.
   */
  function ensureLibraryItemUnused(ctx, path, item) {
    if (item.itemType !== "folder") {
      if (!isLibraryItemUnused(ctx.document, path)) {
        throw new Error("Library item is in use: " + path);
      }
      return;
    }
    var prefix = path + "/", items = ctx.document.library.items;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
      var child = items[itemIndex];
      if (child.name.indexOf(prefix) === 0 && child.itemType !== "folder" && !isLibraryItemUnused(ctx.document, child.name)) {
        throw new Error("Library folder contains an item in use: " + child.name);
      }
    }
  }

  /** Selects an item for linkage access and restores the prior Library selection.
   * @param ctx Document and operation state.
    * @param item Library item to select.
   * @param callback Work to run with the item selected.
   * @returns The callback result.
   */
  function withSelectedLibraryItem(ctx, item, callback) {
    var library = ctx.document.library, selectedItems = library.getSelectedItems(), selectedNames = [];
    for (var selectedIndex = 0; selectedIndex < selectedItems.length; selectedIndex++) {
      selectedNames.push(selectedItems[selectedIndex].name);
    }
    library.selectNone();
    try {
      library.selectItem(item.name);
      return callback();
    } finally {
      library.selectNone();
      for (var restoreIndex = 0; restoreIndex < selectedNames.length; restoreIndex++) {
        library.selectItem(selectedNames[restoreIndex], false);
      }
    }
  }

  /** Reads supported AS3 linkage values for the selected item.
   * @param ctx Document and operation state.
    * @param item Selected library item.
   * @returns Read-back values; disabled AS export uses stable empty defaults.
   */
  function readLibraryLinkage(ctx, item) {
    var library = ctx.document.library;
    var exportForAS = !!library.getItemProperty("linkageExportForAS");
    if (!exportForAS) {
      return { name: item.name, exportForAS: false, className: "", baseClass: "", exportInFirstFrame: false };
    }
    var className = library.getItemProperty("linkageClassName");
    var baseClass = library.getItemProperty("linkageBaseClass");
    var exportInFirstFrame = library.getItemProperty("linkageExportInFirstFrame");
    return {
      name: item.name,
      exportForAS: exportForAS,
      className: typeof className === "undefined" || className === null ? item.name : className,
      baseClass: typeof baseClass === "undefined" || baseClass === null ? "" : baseClass,
      exportInFirstFrame: !!exportInFirstFrame
    };
  }

  /** Validates and reads one item's AS3 linkage settings.
   * @param ctx Document and operation state.
    * @param op Linkage operation.
   * @param set Whether the operation writes linkage values.
   * @returns The operation's read-back values.
   */
  function applyLinkageOp(ctx, op, set) {
    if (ctx.document.type !== "Flash" || String(ctx.document.asVersion).indexOf("3") < 0) {
      throw new Error("AS3 linkage is supported only for Flash/AS3 documents");
    }
    if (typeof op.item !== "string" || !op.item) {
      throw new Error("A library item path is required");
    }
    var item = findLibraryItem(ctx.document, op.item);
    if (!item) {
      throw new Error("Library item not found: " + op.item);
    }
    if (item.itemType === "folder") {
      throw new Error("Library folders do not support AS3 linkage: " + op.item);
    }
    if (set) {
      var fields = ["exportForAS", "className", "baseClass", "exportInFirstFrame"], hasSetting = false;
      for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        var field = fields[fieldIndex];
        if (typeof op[field] !== "undefined") {
          hasSetting = true;
          if (field === "className" && (typeof op[field] !== "string" || !op[field])) {
            throw new Error("className must be a non-empty string");
          }
          if (field === "baseClass" && typeof op[field] !== "string") {
            throw new Error(field + " must be a string");
          }
          if ((field === "exportForAS" || field === "exportInFirstFrame") && typeof op[field] !== "boolean") {
            throw new Error(field + " must be a boolean");
          }
        }
      }
      if (!hasSetting) {
        throw new Error("setLinkage requires at least one linkage setting");
      }
    }
    return withSelectedLibraryItem(ctx, item, /** Reads or updates linkage while the target item is selected.
     * @returns The linkage values after the requested operation.
     */
    function () {
      var current = readLibraryLinkage(ctx, item);
      if (!set) {
        return current;
      }
      var nextExportForAS = typeof op.exportForAS === "undefined" ? current.exportForAS : op.exportForAS;
      if ((typeof op.className !== "undefined" || typeof op.baseClass !== "undefined") && !nextExportForAS) {
        throw new Error("className and baseClass require exportForAS to be true");
      }
      if (op.exportInFirstFrame === true && !nextExportForAS) {
        throw new Error("exportInFirstFrame requires exportForAS to be true");
      }
      ctx.libraryChanged = true;
      if (op.exportForAS === true && !current.exportForAS) {
        ctx.document.library.setItemProperty("linkageExportForAS", true);
      }
      if (typeof op.className !== "undefined") item.linkageClassName = op.className;
      if (typeof op.baseClass !== "undefined") item.linkageBaseClass = op.baseClass;
      if (typeof op.exportInFirstFrame !== "undefined" && nextExportForAS) {
        item.linkageExportInFirstFrame = op.exportInFirstFrame;
      }
      if (op.exportForAS === false && current.exportForAS) {
        ctx.document.library.setItemProperty("linkageExportForAS", false);
      }
      return readLibraryLinkage(ctx, item);
    });
  }

  /** Applies one library operation and reports its result.
   * @param ctx Document and operation state.
    * @param op Library operation to apply.
   * @returns Operation-specific result data.
   */
  function applyLibraryOp(ctx, op) {
    var item, targetPath, parent, linked;
    if (op.op === "listUnused") {
      return { items: listUnusedItems(ctx) };
    }
    if (op.op === "findUsages") {
      return findLibraryUsages(ctx, op.item);
    }
    if (op.op === "createSymbol") {
      return createLibrarySymbol(ctx, op);
    }
    if (op.op === "duplicateItem") {
      return duplicateLibraryItem(ctx, op);
    }
    if (op.op === "getLinkage") {
      return applyLinkageOp(ctx, op, false);
    }
    if (op.op === "setLinkage") {
      return applyLinkageOp(ctx, op, true);
    }
    if (op.op === "createFolder") {
      if (ctx.document.library.itemExists(op.path)) {
        throw new Error("Library item already exists: " + op.path);
      }
      ctx.libraryChanged = true;
      ctx.document.library.newFolder(op.path);
      if (!ctx.document.library.itemExists(op.path)) {
        throw new Error("Library folder creation failed: " + op.path);
      }
      return { path: op.path };
    }
    if (op.op === "moveItem") {
      item = findLibraryItem(ctx.document, op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      if (op.toFolder && (!findLibraryItem(ctx.document, op.toFolder) || findLibraryItem(ctx.document, op.toFolder).itemType !== "folder")) {
        throw new Error("Destination folder not found: " + op.toFolder);
      }
      if (op.toFolder.indexOf(op.item + "/") === 0) {
        throw new Error("Cannot move a folder into itself");
      }
      targetPath = op.toFolder ? op.toFolder + "/" + libraryBasename(op.item) : libraryBasename(op.item);
      if (targetPath !== op.item && ctx.document.library.itemExists(targetPath)) {
        throw new Error("Destination item already exists: " + targetPath);
      }
      if (containsLibraryLinkage(ctx.document, op.item, item)) {
        ctx.warnings.push(libraryLinkageWarning());
      }
      if (targetPath !== op.item) {
        ctx.libraryChanged = true;
        ctx.document.library.moveToFolder(op.toFolder, op.item, false);
        if (!ctx.document.library.itemExists(targetPath)) {
          throw new Error("Library item move failed: " + op.item);
        }
      }
      return { name: targetPath, itemType: item.itemType };
    }
    if (op.op === "renameItem") {
      item = findLibraryItem(ctx.document, op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      parent = libraryParent(op.item);
      targetPath = parent ? parent + "/" + op.newName : op.newName;
      if (targetPath !== op.item && ctx.document.library.itemExists(targetPath)) {
        throw new Error("Destination item already exists: " + targetPath);
      }
      if (hasLibraryLinkage(item)) {
        ctx.warnings.push(libraryLinkageWarning());
      }
      ctx.document.library.selectNone();
      try {
        ctx.document.library.selectItem(op.item);
        ctx.libraryChanged = true;
        ctx.document.library.renameItem(op.newName);
      } finally {
        ctx.document.library.selectNone();
      }
      if (!ctx.document.library.itemExists(targetPath)) {
        throw new Error("Library item rename failed: " + targetPath);
      }
      return { name: targetPath, itemType: item.itemType };
    }
    if (op.op === "deleteItem") {
      if (op.confirm !== true) {
        throw new Error("confirm required");
      }
      item = findLibraryItem(ctx.document, op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      ensureLibraryItemUnused(ctx, op.item, item);
      linked = containsLibraryLinkage(ctx.document, op.item, item);
      ctx.libraryChanged = true;
      ctx.document.library.deleteItem(op.item);
      if (ctx.document.library.itemExists(op.item)) {
        throw new Error("Library item delete failed: " + op.item);
      }
      if (linked) {
        ctx.warnings.push(libraryLinkageWarning());
      }
      return { name: op.item, itemType: item.itemType };
    }
    throw new Error("Unknown library operation: " + op.op);
  }
