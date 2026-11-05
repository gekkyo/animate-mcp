// Concatenated and evaluated after export-common and edit-state. `var __docName` and `var __edits`
// ([{file, scene, layer, start, expected, script, item?}]) are injected before it. With item, the frame is inside a library symbol.
// A frame changed in Animate since Export is not written and goes to failed (if it already equals script it counts as applied).
// An empty script deletes the frame script.
// Symbols are edited in edit mode, so the original edit state is restored at the end (warning if it cannot be).
(function () {
  var document = selectDocument(), applied = [], failed = [], editingItemName = "";
  var restore = saveEditState(document);
  for (var editIndex = 0; editIndex < __edits.length; editIndex++) {
    var edit = __edits[editIndex];
    try {
      var timeline;
      if (edit.item !== undefined) {
        if (editingItemName !== edit.item) {
          document.library.editItem(edit.item);
          editingItemName = edit.item;
        }
        timeline = document.getTimeline();
      } else timeline = document.timelines[edit.scene];
      var frame = timeline && timeline.layers[edit.layer] && timeline.layers[edit.layer].frames[edit.start];
      if (!frame || frame.startFrame !== edit.start) throw new Error("Frame no longer exists");
      var currentScript = frame.actionScript || "";
      if (currentScript !== edit.expected && currentScript !== edit.script) throw new Error("Changed in Animate since Export");
      frame.actionScript = edit.script;
      applied.push(edit.file);
    } catch (error) {
      failed.push({ file: edit.file, error: String(error && error.message ? error.message : error) });
    }
  }
  var warning = editingItemName ? restore() : "";
  return serialize({ applied: applied, failed: failed, warning: warning });
})()
