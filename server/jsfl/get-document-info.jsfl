// Concatenated and evaluated after export-common. The last expression is the result (a JSON string built with ser, since JSFL has no JSON).
(function () {
  var d = fl.getDocumentDOM();
  if (!d) throw new Error("No document open");
  var t = [];
  for (var i = 0; i < d.timelines.length; i++) t.push(d.timelines[i].name);
  return ser({ name: d.name, width: d.width, height: d.height, frameRate: d.frameRate, timelines: t });
})()
