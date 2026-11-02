// edit-state の後に連結して評価する。直前に `var __docName` と `var __edits`
// ([{file, scene, layer, start, expected, script, item?}]) が差し込まれる。item があればライブラリのシンボル内。
// 書き出し後に Animate 側が変わっていたフレームは書き込まず failed に載せる。script が空ならスクリプト削除。
// シンボルは編集モードに入るため、終了時に元の編集状態へ戻す(戻せなければ warning)。
(function () {
  function q(s) {
    var r = '"', t = String(s);
    for (var j = 0; j < t.length; j++) {
      var c = t.charAt(j), n = t.charCodeAt(j);
      if (c === '"') r += '\\"';
      else if (c === "\\") r += "\\\\";
      else if (n < 32) r += "\\u" + ("0000" + n.toString(16)).slice(-4);
      else r += c;
    }
    return r + '"';
  }
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
      if ((frame.actionScript || "") !== ed.expected) throw new Error("Changed in Animate since Export");
      frame.actionScript = ed.script;
      applied.push(q(ed.file));
    } catch (e) {
      failed.push('{"file":' + q(ed.file) + ',"error":' + q(e && e.message ? e.message : e) + "}");
    }
  }
  var warning = editing ? restore() : "";
  return '{"applied":[' + applied.join(",") + '],"failed":[' + failed.join(",") + '],"warning":' + q(warning) + "}";
})()
