// export-common の後に連結して評価する。直前に `var __docName = "..."` (空文字なら未指定) が差し込まれる。
// 結果は JSON 文字列（JSFL に JSON が無いため手組み）。
(function () {
  var d = selectDocument(), i;

  var scenes = [];
  for (i = 0; i < d.timelines.length; i++) {
    var name = d.timelines[i].name;
    try {
      scenes.push({ name: name, layers: exportTimeline(d.timelines[i]) });
    } catch (e) {
      scenes.push({ name: name, error: String(e && e.message ? e.message : e) });
    }
  }
  return ser({ document: d.name, type: d.type, scenes: scenes });
})()
