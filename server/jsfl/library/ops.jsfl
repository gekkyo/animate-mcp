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

  /** Applies one library operation and reports its result.
   * @param op Library operation to apply.
   * @returns Operation-specific result data.
   */
  function applyLibraryOp(op) {
    var item, targetPath, parent, linked;
    if (op.op === "listUnused") {
      return { items: listUnusedItems() };
    }
    if (op.op === "createFolder") {
      if (document.library.itemExists(op.path)) {
        throw new Error("Library item already exists: " + op.path);
      }
      libraryChanged = true;
      document.library.newFolder(op.path);
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
      if (linked) {
        warnings.push(libraryLinkageWarning());
      }
      return { name: op.item, itemType: item.itemType };
    }
    throw new Error("Unknown library operation: " + op.op);
  }
