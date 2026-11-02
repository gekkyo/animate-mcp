// 他の JSFL の前に連結される共通部品。直前に `var __docName = "..."` (空文字なら未指定) が差し込まれる。
// 対象ドキュメントを返す。複数開いていて未指定ならドキュメント名一覧付きでエラーにする。
function selectDocument() {
  var docs = fl.documents, d = null, i;
  if (!docs || docs.length === 0) throw new Error("No document open");
  if (__docName) {
    for (i = 0; i < docs.length; i++) if (docs[i].name === __docName) d = docs[i];
    if (!d) throw new Error("Document not open: " + __docName);
  } else if (docs.length > 1) {
    var names = [];
    for (i = 0; i < docs.length; i++) names.push(docs[i].name);
    throw new Error("Multiple documents open; specify `document`: " + names.join(", "));
  } else {
    d = docs[0];
  }
  if (d.type !== "Flash" && d.type !== "htmlcanvas") throw new Error("Unsupported document type: " + d.type);
  return d;
}
