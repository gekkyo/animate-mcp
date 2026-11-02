// Evaluated by the Run file wrapper: the last expression is the result (a JSON string; JSFL has no JSON).
(function () {
  var d = fl.getDocumentDOM();
  if (!d) throw new Error("No document open");
  function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  var t = [];
  for (var i = 0; i < d.timelines.length; i++) t.push(q(d.timelines[i].name));
  return '{"name":' + q(d.name) + ',"width":' + d.width + ',"height":' + d.height +
    ',"frameRate":' + d.frameRate + ',"timelines":[' + t.join(",") + ']}';
})()
