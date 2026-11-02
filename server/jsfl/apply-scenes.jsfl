// Concatenated and evaluated after export-common and edit-state. `var __docName` and `var __edits`
// ([{file, scene, layer, start, expected, script, item?}]) are injected before it. With item, the frame is inside a library symbol.
// A frame changed in Animate since Export is not written and goes to failed (if it already equals script it counts as applied).
// An empty script deletes the frame script.
// Symbols are edited in edit mode, so the original edit state is restored at the end (warning if it cannot be).
(function () {
  var d = selectDocument(), applied = [], failed = [], editing = "";
  var restore = saveEditState(d);
  for (var i = 0; i < __edits.length; i++) {
    var ed = __edits[i];
    try {
      var tl;
      if (ed.item !== undefined) {
        if (editing !== ed.item) {
          d.library.editItem(ed.item);
          editing = ed.item;
        }
        tl = d.getTimeline();
      } else tl = d.timelines[ed.scene];
      var frame = tl && tl.layers[ed.layer] && tl.layers[ed.layer].frames[ed.start];
      if (!frame || frame.startFrame !== ed.start) throw new Error("Frame no longer exists");
      var current = frame.actionScript || "";
      if (current !== ed.expected && current !== ed.script) throw new Error("Changed in Animate since Export");
      frame.actionScript = ed.script;
      applied.push(ed.file);
    } catch (e) {
      failed.push({ file: ed.file, error: String(e && e.message ? e.message : e) });
    }
  }
  var warning = editing ? restore() : "";
  return ser({ applied: applied, failed: failed, warning: warning });
})()
