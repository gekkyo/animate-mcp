// Concatenated and evaluated after export-common. `var __docName` and `var __items` are injected before it.
// If __items is null, only the symbol list (and AS3 Linked classes) is returned. If it is an array, each symbol's timeline is read.
// Reading enters edit mode, so the original edit state is restored at the end; a failure goes to warning.
(function () {
  var document = selectDocument(), itemIndex;

  /** Finds a library item by its full name. */
  function findSymbolItem(symbolName) {
    var libraryItems = document.library.items;
    for (var libraryIndex = 0; libraryIndex < libraryItems.length; libraryIndex++) {
      if (libraryItems[libraryIndex].name === symbolName) return libraryItems[libraryIndex];
    }
    return null;
  }

  if (__items === null) {
    var symbols = [];
    var libraryItems = document.library.items;
    for (itemIndex = 0; itemIndex < libraryItems.length; itemIndex++) {
      var itemType = libraryItems[itemIndex].itemType;
      if (itemType !== "movie clip" && itemType !== "graphic" && itemType !== "button") continue;
      var linkedClass = document.type === "Flash" && libraryItems[itemIndex].linkageExportForAS
        ? libraryItems[itemIndex].linkageClassName || ""
        : "";
      symbols.push({ name: libraryItems[itemIndex].name, linked: linkedClass });
    }
    return serialize({ document: document.name, type: document.type, symbols: symbols });
  }

  var restore = saveEditState(document);
  var exportedSymbols = [];
  for (itemIndex = 0; itemIndex < __items.length; itemIndex++) {
    try {
      var symbol = findSymbolItem(__items[itemIndex]);
      if (!symbol) throw new Error("Library item not found");
      document.library.editItem(__items[itemIndex]);
      exportedSymbols.push({ name: __items[itemIndex], layers: exportTimeline(document.getTimeline()) });
    } catch (error) {
      exportedSymbols.push({ name: __items[itemIndex], error: String(error && error.message ? error.message : error) });
    }
  }

  var warning = restore();
  return serialize({ document: document.name, type: document.type, symbols: exportedSymbols, warning: warning });
})()
