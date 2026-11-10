  /** Runs ordered library operations and returns their serialized results.
   * @returns The serialized operation result.
   */
  (function () {
  /** Finds a library item by its full path.
   * @param path Full library item path.
   * @returns The matching item, or null when it does not exist.
   */
  function findLibraryItem(path) {
    var items = document.library.items;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
      if (items[itemIndex].name === path) {
        return items[itemIndex];
      }
    }
    return null;
  }

  /** Returns the basename of a library path.
   * @param path Full library item path.
   * @returns The final path segment.
   */
  function libraryBasename(path) {
    return path.substring(path.lastIndexOf("/") + 1);
  }

  /** Returns the parent folder path of a library path.
   * @param path Full library item path.
   * @returns Parent path, or an empty string for the library root.
   */
  function libraryParent(path) {
    var separator = path.lastIndexOf("/");
    return separator < 0 ? "" : path.substring(0, separator);
  }

  /** Checks whether an item has any Animate linkage export metadata.
   * @param item Library item to inspect.
   * @returns Whether the item has linkage metadata.
   */
  function hasLibraryLinkage(item) {
    return !!(item.linkageExportForAS || item.linkageIdentifier || item.linkageClassName);
  }

  /** Returns the warning for linkage-bearing items whose code references cannot be updated.
   * @returns The linkage warning text.
   */
  function libraryLinkageWarning() {
    return "Code-string references (attachMovie, linkage IDs, and class names) cannot be detected or updated; linkage metadata is unchanged.";
  }

  /** Tests whether a path appears in Animate's unusedItems list.
   * @param path Full library item path.
   * @returns Whether the item is unused.
   */
  function isLibraryItemUnused(path) {
    var unusedItems = document.library.unusedItems || [];
    for (var itemIndex = 0; itemIndex < unusedItems.length; itemIndex++) {
      if (unusedItems[itemIndex].name === path) {
        return true;
      }
    }
    return false;
  }

  /** Returns linkage warnings for an item or any non-folder item inside a folder.
   * @param path Library item path to inspect.
   * @param item The item at path.
   * @returns Whether a linkage warning is required.
   */
  function containsLibraryLinkage(path, item) {
    if (hasLibraryLinkage(item)) {
      return true;
    }
    if (item.itemType !== "folder") {
      return false;
    }
    var prefix = path + "/", items = document.library.items;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
      if (items[itemIndex].name.indexOf(prefix) === 0 && hasLibraryLinkage(items[itemIndex])) {
        return true;
      }
    }
    return false;
  }
