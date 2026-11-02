// 他の JSFL の前に連結される共通部品。
// 現在の編集状態を控え、戻す関数を返す。戻す関数は失敗時の警告文字列(成功なら空文字)を返す。
function saveEditState(d) {
  var before = d.getTimeline().libraryItem;
  var beforeName = before ? before.name : "";
  var beforeScene = d.currentTimeline;
  return function () {
    try {
      if (beforeName) d.library.editItem(beforeName);
      else {
        d.exitEditMode();
        // Canvas では editScene が使えないため、シーンが変わったときだけ呼ぶ
        if (d.currentTimeline !== beforeScene) d.editScene(beforeScene);
      }
      var now = d.getTimeline().libraryItem;
      return (now ? now.name : "") !== beforeName ? "Edit state was not restored" : "";
    } catch (e) {
      return "Edit state was not restored: " + String(e && e.message ? e.message : e);
    }
  };
}
