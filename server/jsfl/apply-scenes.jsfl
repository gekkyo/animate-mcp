// export-common と edit-state の後に連結して評価する。直前に `var __docName` と `var __edits`
// ([{file, scene, layer, start, expected, script, item?}]) が差し込まれる。item があればライブラリのシンボル内。
// 書き出し後に Animate 側が変わっていたフレームは書き込まず failed に載せる(すでに script と同じ内容なら反映済みとして数える)。
// script が空ならスクリプト削除。
// シンボルは編集モードに入るため、終了時に元の編集状態へ戻す(戻せなければ warning)。
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
