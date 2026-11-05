// Shared part concatenated before other JSFL.
// Records the current edit state and returns a restore function. It returns a warning string on failure (empty string on success).
/** Captures a document's edit state and returns a function that restores it. */
function saveEditState(doc) {
  var priorLibraryItem = doc.getTimeline().libraryItem;
  var priorItemName = priorLibraryItem ? priorLibraryItem.name : "";
  var priorTimeline = doc.currentTimeline;
  /** Restores the saved edit state and returns an empty string or warning. */
  return function () {
    try {
      if (priorItemName) doc.library.editItem(priorItemName);
      else {
        doc.exitEditMode();
        // editScene is unavailable on Canvas, so call it only when the scene changed
        if (doc.currentTimeline !== priorTimeline) doc.editScene(priorTimeline);
      }
      var currentLibraryItem = doc.getTimeline().libraryItem;
      return (currentLibraryItem ? currentLibraryItem.name : "") !== priorItemName ? "Edit state was not restored" : "";
    } catch (error) {
      return "Edit state was not restored: " + String(error && error.message ? error.message : error);
    }
  };
}
