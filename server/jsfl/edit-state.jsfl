// Shared part concatenated before other JSFL.
// Records the current edit state and returns a restore function. It returns a warning string on failure (empty string on success).
function saveEditState(d) {
  var before = d.getTimeline().libraryItem;
  var beforeName = before ? before.name : "";
  var beforeScene = d.currentTimeline;
  return function () {
    try {
      if (beforeName) d.library.editItem(beforeName);
      else {
        d.exitEditMode();
        // editScene is unavailable on Canvas, so call it only when the scene changed
        if (d.currentTimeline !== beforeScene) d.editScene(beforeScene);
      }
      var now = d.getTimeline().libraryItem;
      return (now ? now.name : "") !== beforeName ? "Edit state was not restored" : "";
    } catch (e) {
      return "Edit state was not restored: " + String(e && e.message ? e.message : e);
    }
  };
}
