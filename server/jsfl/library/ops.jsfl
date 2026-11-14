  /** Lists unused library items and identifies linkage-bearing entries.
   * @returns Item names, types, and optional linkage flags.
   */
  function listUnusedItems() {
    var unusedItems = document.library.unusedItems || [], results = [];
    for (var itemIndex = 0; itemIndex < unusedItems.length; itemIndex++) {
      var item = unusedItems[itemIndex], result = { name: item.name, itemType: item.itemType };
      if (containsLibraryLinkage(item.name, item)) {
        result.linkage = true;
      }
      results.push(result);
    }
    return results;
  }

  /** Rejects deletion when an item or any non-folder descendant is in use.
   * @param path Library item path.
   * @param item The item at path.
   * @returns Nothing.
   */
  function ensureLibraryItemUnused(path, item) {
    if (item.itemType !== "folder") {
      if (!isLibraryItemUnused(path)) {
        throw new Error("Library item is in use: " + path);
      }
      return;
    }
    var prefix = path + "/", items = document.library.items;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
      var child = items[itemIndex];
      if (child.name.indexOf(prefix) === 0 && child.itemType !== "folder" && !isLibraryItemUnused(child.name)) {
        throw new Error("Library folder contains an item in use: " + child.name);
      }
    }
  }

  /** Selects an item for linkage access and restores the prior Library selection.
   * @param item Library item to select.
   * @param callback Work to run with the item selected.
   * @returns The callback result.
   */
  function withSelectedLibraryItem(item, callback) {
    var library = document.library, selectedItems = library.getSelectedItems(), selectedNames = [];
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
   * @param item Selected library item.
   * @returns Read-back values; disabled AS export uses stable empty defaults.
   */
  function readLibraryLinkage(item) {
    var library = document.library;
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
   * @param op Linkage operation.
   * @param set Whether the operation writes linkage values.
   * @returns The operation's read-back values.
   */
  function applyLinkageOp(op, set) {
    if (document.type !== "Flash" || String(document.asVersion).indexOf("3") < 0) {
      throw new Error("AS3 linkage is supported only for Flash/AS3 documents");
    }
    if (typeof op.item !== "string" || !op.item) {
      throw new Error("A library item path is required");
    }
    var item = findLibraryItem(op.item);
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
    return withSelectedLibraryItem(item, function () {
      var current = readLibraryLinkage(item);
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
      libraryChanged = true;
      if (op.exportForAS === true && !current.exportForAS) {
        document.library.setItemProperty("linkageExportForAS", true);
      }
      if (typeof op.className !== "undefined") item.linkageClassName = op.className;
      if (typeof op.baseClass !== "undefined") item.linkageBaseClass = op.baseClass;
      if (typeof op.exportInFirstFrame !== "undefined" && nextExportForAS) {
        item.linkageExportInFirstFrame = op.exportInFirstFrame;
      }
      if (op.exportForAS === false && current.exportForAS) {
        document.library.setItemProperty("linkageExportForAS", false);
      }
      return readLibraryLinkage(item);
    });
  }

  /** Applies one library operation and reports its result.
   * @param op Library operation to apply.
   * @returns Operation-specific result data.
   */
  function applyLibraryOp(op) {
    var item, targetPath, parent, linked;
    if (op.op === "listUnused") {
      return { items: listUnusedItems() };
    }
    if (op.op === "getLinkage") {
      return applyLinkageOp(op, false);
    }
    if (op.op === "setLinkage") {
      return applyLinkageOp(op, true);
    }
    if (op.op === "createFolder") {
      if (document.library.itemExists(op.path)) {
        throw new Error("Library item already exists: " + op.path);
      }
      libraryChanged = true;
      document.library.newFolder(op.path);
      if (!document.library.itemExists(op.path)) {
        throw new Error("Library folder creation failed: " + op.path);
      }
      return { path: op.path };
    }
    if (op.op === "moveItem") {
      item = findLibraryItem(op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      if (op.toFolder && (!findLibraryItem(op.toFolder) || findLibraryItem(op.toFolder).itemType !== "folder")) {
        throw new Error("Destination folder not found: " + op.toFolder);
      }
      if (op.toFolder.indexOf(op.item + "/") === 0) {
        throw new Error("Cannot move a folder into itself");
      }
      targetPath = op.toFolder ? op.toFolder + "/" + libraryBasename(op.item) : libraryBasename(op.item);
      if (targetPath !== op.item && document.library.itemExists(targetPath)) {
        throw new Error("Destination item already exists: " + targetPath);
      }
      if (containsLibraryLinkage(op.item, item)) {
        warnings.push(libraryLinkageWarning());
      }
      if (targetPath !== op.item) {
        libraryChanged = true;
        document.library.moveToFolder(op.toFolder, op.item, false);
        if (!document.library.itemExists(targetPath)) {
          throw new Error("Library item move failed: " + op.item);
        }
      }
      return { name: targetPath, itemType: item.itemType };
    }
    if (op.op === "renameItem") {
      item = findLibraryItem(op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      parent = libraryParent(op.item);
      targetPath = parent ? parent + "/" + op.newName : op.newName;
      if (targetPath !== op.item && document.library.itemExists(targetPath)) {
        throw new Error("Destination item already exists: " + targetPath);
      }
      if (hasLibraryLinkage(item)) {
        warnings.push(libraryLinkageWarning());
      }
      document.library.selectNone();
      try {
        document.library.selectItem(op.item);
        libraryChanged = true;
        document.library.renameItem(op.newName);
      } finally {
        document.library.selectNone();
      }
      if (!document.library.itemExists(targetPath)) {
        throw new Error("Library item rename failed: " + targetPath);
      }
      return { name: targetPath, itemType: item.itemType };
    }
    if (op.op === "deleteItem") {
      if (op.confirm !== true) {
        throw new Error("confirm required");
      }
      item = findLibraryItem(op.item);
      if (!item) {
        throw new Error("Library item not found: " + op.item);
      }
      ensureLibraryItemUnused(op.item, item);
      linked = containsLibraryLinkage(op.item, item);
      libraryChanged = true;
      document.library.deleteItem(op.item);
      if (document.library.itemExists(op.item)) {
        throw new Error("Library item delete failed: " + op.item);
      }
      if (linked) {
        warnings.push(libraryLinkageWarning());
      }
      return { name: op.item, itemType: item.itemType };
    }
    throw new Error("Unknown library operation: " + op.op);
  }
