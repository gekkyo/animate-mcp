export const libraryRuntime = `  const libraryItems = [
    { name: "F", itemType: "folder" },
    { name: "dir", itemType: "folder" },
    { name: "dir/Hero", itemType: "movie clip", linkageExportForAS: true, linkageClassName: "com.Hero", linkageBaseClass: "flash.display.MovieClip", linkageExportInFirstFrame: false },
    { name: "dir/Bitmap", itemType: "bitmap" },
    { name: "Bitmap", itemType: "bitmap" },
    { name: "Sound", itemType: "sound" },
    { name: "Font", itemType: "font" },
    ...Array.from({ length: Number(process.env.FAKE_EXTRA ?? 0) }, (_, index) => ({ name: "S" + index, itemType: "graphic" })),
    { name: "Broken", itemType: "button" },
    ...(process.env.FAKE_AUDIT_FIXTURES ? [
      { name: "Symbol 1", itemType: "graphic" },
      { name: "シンボル 2", itemType: "graphic" },
      { name: "Linked", itemType: "movie clip", linkageExportForAS: true, linkageClassName: "external.Linked" },
      { name: "constructor", itemType: "bitmap" },
      { name: "toString", itemType: "bitmap" },
      { name: "Folder", itemType: "folder" },
      { name: "Folder/Symbol 3", itemType: "graphic" },
      { name: "Folder/Unused", itemType: "graphic" },
    ] : []),
  ];
  const linkageWrites = [];
  for (const item of libraryItems) {
    const values = {};
    for (const property of ["linkageExportForAS", "linkageClassName", "linkageBaseClass", "linkageExportInFirstFrame"]) {
      values[property] = item[property];
      Object.defineProperty(item, property, {
        enumerable: true,
        configurable: true,
        get() { return values[property]; },
        set(value) {
          linkageWrites.push({ item: item.name, property, value });
          if (property === "linkageExportInFirstFrame" && !item.linkageExportForAS) throw new Error("invalid argument");
          values[property] = value;
        },
      });
    }
  }
  let selectedLibraryItems = (process.env.FAKE_SELECTED_LIBRARY_ITEMS ?? "").split(",").filter(Boolean)
    .map((name) => libraryItems.find((item) => item.name === name)).filter(Boolean);
  const logLibrarySelection = () => process.env.FAKE_LOG && appendFileSync(
    process.env.FAKE_LOG + ".library-selection",
    JSON.stringify(selectedLibraryItems.map((item) => item.name)) + "\\n",
  );
  let addedItemCount = 0;
  const library = {
    items: libraryItems,
    linkageWrites,
    /** Returns the selected Library items.
     * @returns Selected items.
     */
    getSelectedItems() { return selectedLibraryItems.slice(); },
    /** Reads a linkage property from the selected Library item.
     * @param property Linkage property name.
     * @returns The selected item's value, or undefined when its AS export is disabled.
     */
    getItemProperty(property) {
      if (selectedLibraryItems.length !== 1) throw new Error("one library item must be selected");
      if (!["linkageExportForAS", "linkageClassName", "linkageBaseClass", "linkageExportInFirstFrame"].includes(property)) {
        throw new Error("invalid argument");
      }
      const item = selectedLibraryItems[0];
      if (property !== "linkageExportForAS" && !item.linkageExportForAS) return undefined;
      return item[property];
    },
    /** Writes the linkage property supported by Animate's Library API.
     * @param property Linkage property name.
     * @param value New value.
     * @returns Nothing.
     */
    setItemProperty(property, value) {
      if (selectedLibraryItems.length !== 1 || property !== "linkageExportForAS") throw new Error("invalid argument");
      const item = selectedLibraryItems[0];
      item[property] = value;
      if (value) item.linkageClassName = item.name;
    },
    /** Returns library items that are not marked as used by the test environment.
     * @returns Unused library items.
     */
    get unusedItems() {
      const used = (process.env.FAKE_USED ?? "").split(",");
      return libraryItems.filter((item) => !used.includes(item.name));
    },
    /** Tests whether a library path exists.
     * @param path Library path.
     * @returns Whether the path exists.
     */
    itemExists: (path) => libraryItems.some((item) => item.name === path),
    /** Adds a library item to the current timeline frame.
     * @param path Library item path
     * @param position Initial stage position
     * @returns Nothing
     */
    addItemToDocument(position, path) {
      addedItemCount++;
      if (process.env.FAKE_FAIL_ADD_ITEM_AFTER && addedItemCount > Number(process.env.FAKE_FAIL_ADD_ITEM_AFTER)) {
        throw new Error("fake addItemToDocument failure");
      }
      const item = libraryItems.find((candidate) => candidate.name === path);
      if (!item) throw new Error("library item not found");
      const timeline = document.getTimeline();
      const currentLayer = timeline.layers[timeline.currentLayer];
      const frame = currentLayer.frames[timeline.currentFrame];
      if (!frame || currentLayer.locked) throw new Error("cannot add to layer");
      const offset = Number(process.env.FAKE_ADD_ITEM_OFFSET || 0);
      const instance = makeInstance("", position.x + offset, item);
      instance.y = position.y - offset;
      instance.matrix.tx = instance.x;
      instance.matrix.ty = instance.y;
      if (process.env.FAKE_READONLY_COLOR_PROPERTIES) lockColorEffectProperties(instance);
      frame.elements.push(instance);
    },
    /** Creates a library folder and any missing intermediate folders.
     * @param path Folder path.
     * @returns Nothing.
     */
    newFolder(path) {
      let current = "";
      for (const part of path.split("/")) {
        current = current ? current + "/" + part : part;
        if (!libraryItems.some((item) => item.name === current)) {
          libraryItems.push({ name: current, itemType: "folder" });
        }
      }
    },
    /** Moves a library item into a folder.
     * @param folder Destination folder.
     * @param itemPath Source path.
     * @param overwrite Whether the move may replace an existing item.
     * @returns Nothing.
     */
    moveToFolder(folder, itemPath, overwrite) {
      const source = libraryItems.find((item) => item.name === itemPath);
      const basename = itemPath.split("/").at(-1);
      const destination = folder ? folder + "/" + basename : basename;
      if (!source) {
        throw new Error("missing source");
      }
      if (overwrite) {
        throw new Error("overwrite is unsupported in the fake runtime");
      }
      const prefix = itemPath + "/";
      for (const item of libraryItems) {
        if (item.name === itemPath || item.name.startsWith(prefix)) {
          item.name = destination + item.name.slice(itemPath.length);
        }
      }
    },
    /** Clears library selection.
     * @returns Nothing.
     */
    selectNone() {
      selectedLibraryItems = [];
      logLibrarySelection();
    },
    /** Selects the library item at a path.
     * @param path Library item path.
     * @returns Nothing.
     */
    selectItem(path, replaceCurrentSelection = true) {
      const item = libraryItems.find((candidate) => candidate.name === path);
      if (!item) throw new Error("library item not found");
      if (replaceCurrentSelection) selectedLibraryItems = [];
      if (!selectedLibraryItems.includes(item)) selectedLibraryItems.push(item);
      logLibrarySelection();
    },
    /** Renames the selected library item.
     * @param name New basename.
     * @returns Nothing.
     */
    renameItem(name) {
      if (!selectedLibraryItems[0]) {
        throw new Error("nothing selected");
      }
      const oldPath = selectedLibraryItems[0].name;
      const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) + "/" : "";
      const nextPath = parent + name;
      for (const item of libraryItems) {
        if (item.name === oldPath || item.name.startsWith(oldPath + "/")) {
          item.name = nextPath + item.name.slice(oldPath.length);
        }
      }
    },
    /** Deletes a library item and its descendants.
     * @param path Library item path.
     * @returns Nothing.
     */
    deleteItem(path) {
      for (let index = libraryItems.length - 1; index >= 0; index--) {
        if (libraryItems[index].name === path || libraryItems[index].name.startsWith(path + "/")) {
          libraryItems.splice(index, 1);
        }
      }
    },
    /**
     * Opens a library item for timeline editing.
     * @param itemName Library item name to open
     * @returns Nothing.
     */
    editItem: (itemName) => {
      if (itemName === "Broken" && !process.env.FAKE_NO_BROKEN) {
        throw new Error("cannot edit");
      }
      editing = itemName;
    },
  };
  document.library = library;
  return document; };
`;
