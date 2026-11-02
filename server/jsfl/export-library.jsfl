// export-common の後に連結して評価する。直前に `var __docName` と `var __items` が差し込まれる。
// __items が null ならシンボル一覧(と AS3 の Linked class)だけ返す。配列なら各シンボルのタイムラインを読む。
// 読み取りは編集モードに入るため、終了時に元の編集状態へ戻す。戻せなければ warning に載せる。
(function () {
  var d = selectDocument(), i;

  function symbolItem(name) {
    var items = d.library.items;
    for (var k = 0; k < items.length; k++) if (items[k].name === name) return items[k];
    return null;
  }

  if (__items === null) {
    var symbols = [];
    var all = d.library.items;
    for (i = 0; i < all.length; i++) {
      var t = all[i].itemType;
      if (t !== "movie clip" && t !== "graphic" && t !== "button") continue;
      var linked = d.type === "Flash" && all[i].linkageExportForAS ? all[i].linkageClassName || "" : "";
      symbols.push({ name: all[i].name, linked: linked });
    }
    return ser({ document: d.name, type: d.type, symbols: symbols });
  }

  var restore = saveEditState(d);
  var out = [];
  for (i = 0; i < __items.length; i++) {
    try {
      var item = symbolItem(__items[i]);
      if (!item) throw new Error("Library item not found");
      d.library.editItem(__items[i]);
      out.push({ name: __items[i], layers: exportTimeline(d.getTimeline()) });
    } catch (e) {
      out.push({ name: __items[i], error: String(e && e.message ? e.message : e) });
    }
  }

  var warning = restore();
  return ser({ document: d.name, type: d.type, symbols: out, warning: warning });
})()
