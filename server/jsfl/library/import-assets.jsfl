// `var __docName` and `var __assets` are injected before this file.
(function () {
  var document = selectDocument(), library = document.library, originalSelection = library.getSelectedItems() || [];
  var asset, extension, index, previousIndex, libraryIndex, existingName;
  if (!__assets || !__assets.length) throw new Error("At least one asset path is required");

  // Validate every item name and collision before invoking importFile; collisions open a modal in Animate.
  for (index = 0; index < __assets.length; index++) {
    asset = __assets[index];
    if (!asset || typeof asset.name !== "string" || !asset.name || asset.name.indexOf("/") >= 0 ||
      typeof asset.uri !== "string" || !/^file:\/\//i.test(asset.uri)) {
      throw new Error("Invalid asset path");
    }
    extension = asset.name.substring(asset.name.lastIndexOf(".")).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".wav", ".mp3"].indexOf(extension) < 0) {
      throw new Error("Unsupported asset file extension: " + asset.name);
    }
    for (previousIndex = 0; previousIndex < index; previousIndex++) {
      if (__assets[previousIndex].name === asset.name) throw new Error("Duplicate Library item name: " + asset.name);
    }
    if (library.itemExists(asset.name)) throw new Error("Library item already exists: " + asset.name);
    for (libraryIndex = 0; libraryIndex < library.items.length; libraryIndex++) {
      existingName = String(library.items[libraryIndex].name);
      if (existingName.substring(existingName.lastIndexOf("/") + 1) === asset.name) {
        throw new Error("Library item name already exists: " + existingName);
      }
    }
  }

  var imported = [], importError = null, restoreError = null;
  try {
    library.selectNone();
    for (index = 0; index < __assets.length; index++) {
      asset = __assets[index];
      if (!document.importFile(asset.uri, true, false)) throw new Error("Animate could not import asset: " + asset.name);
      if (!library.itemExists(asset.name)) throw new Error("Imported asset was not found at the Library root: " + asset.name);
      imported.push(asset.name);
    }
  } catch (error) {
    importError = error;
  }
  try {
    library.selectNone();
    for (index = 0; index < originalSelection.length; index++) {
      var selectedItem = originalSelection[index], stillExists = false;
      for (libraryIndex = 0; libraryIndex < library.items.length; libraryIndex++) {
        if (library.items[libraryIndex] === selectedItem) stillExists = true;
      }
      if (stillExists) library.selectItem(selectedItem.name, false);
    }
  } catch (error) {
    restoreError = error;
  }
  if (importError) {
    var errorMessage = String(importError);
    if (imported.length) errorMessage += "; already imported: " + imported.join(", ");
    if (restoreError) errorMessage += "; Library selection restore failed: " + String(restoreError);
    throw new Error(errorMessage);
  }
  if (restoreError) throw restoreError;
  return serialize({ document: document.name, items: imported });
})()
