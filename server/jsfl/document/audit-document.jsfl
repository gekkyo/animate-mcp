// @requires shared/select-document, shared/edit-state, shared/export-common
// Read-only audit; timeline edits are temporary and restored by withTimelineEdit.
/** Audits scene and symbol timelines and reports review findings as JSON text.
 * @returns The serialized audit report.
 */
(function () {
  var document = selectDocument(), findings = [], warnings = [], usages = {}, scanComplete = true;
  var libraryItems = document.library.items || [];
  var symbolItems = [];

  /** Checks whether a Library item has an editable symbol timeline.
   * @param item Library item to inspect.
   * @returns Whether the item is a movie clip, graphic, or button.
   */
  function isSymbol(item) {
    return item.itemType === 'movie clip' || item.itemType === 'graphic' || item.itemType === 'button';
  }

  /** Checks whether a name resembles an Animate-generated default name.
   * @param name Name to inspect.
   * @param kind Whether the name belongs to a layer or symbol.
   * @returns Whether the name matches a known default-name pattern.
   */
  function defaultLooking(name, kind) {
    var pattern = kind === 'layer'
      ? /^(Layer|レイヤー)\s*\d+$/i
      : /^(Symbol|シンボル|Movie Clip|ムービークリップ|Button|ボタン|Graphic|グラフィック)\s*\d+$/i;
    return pattern.test(name);
  }

  /** Records direct Library item and sound references on a timeline.
   * @param timeline Timeline to scan.
   * @returns Nothing.
   */
  function addUsage(timeline) {
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      var layer = timeline.layers[layerIndex], frames = layer.frames || [];
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        var frame = frames[frameIndex];
        if (!frame || frame.startFrame !== frameIndex) continue;
        var elements = frame.elements || [];
        for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
          var item = elements[elementIndex].libraryItem;
          if (item && item.name) usages['$' + item.name] = true;
        }
        var soundItem = frame.soundLibraryItem;
        if (soundItem && soundItem.name) usages['$' + soundItem.name] = true;
      }
    }
  }

  /** Adds default-layer and empty-keyframe findings for a timeline.
   * @param timeline Timeline to inspect.
   * @param name Display name used in finding locations.
   * @returns Nothing.
   */
  function auditTimeline(timeline, name) {
    addUsage(timeline);
    for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) {
      var layer = timeline.layers[layerIndex], frames = layer.frames || [];
      var layerLocation = name + ' / layer "' + layer.name + '"';
      if (defaultLooking(layer.name, 'layer')) {
        findings.push({
          category: 'defaultName', severity: 'info', location: layerLocation,
          message: 'Layer name resembles an Animate default; review whether a descriptive name would help.'
        });
      }
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        var frame = frames[frameIndex];
        if (!frame || frame.startFrame !== frameIndex || (frame.elements || []).length || frame.soundLibraryItem || frame.actionScript || frame.name) continue;
        findings.push({
          category: 'emptyKeyframe', severity: 'info',
          location: layerLocation + ' / keyframe ' + (frameIndex + 1) + ' (span ' + (frameIndex + 1) + '-' + (frameIndex + frame.duration) + ')',
          message: 'Keyframe contains no elements. This is a review suggestion; blank spans are not reported once per frame.'
        });
      }
    }
  }

  for (var itemIndex = 0; itemIndex < libraryItems.length; itemIndex++) {
    if (isSymbol(libraryItems[itemIndex])) symbolItems.push(libraryItems[itemIndex]);
  }

  for (var sceneIndex = 0; sceneIndex < document.timelines.length; sceneIndex++) {
    if (!scanComplete) break;
    try {
      var sceneResult = withTimelineEdit(document, sceneIndex, /** Audits the selected scene timeline.
       * @param timeline Scene timeline being inspected.
       * @returns Nothing.
       */ function (timeline) {
        auditTimeline(timeline, 'scene "' + (timeline.name || sceneIndex) + '"');
      });
      warnings = warnings.concat(sceneResult.warnings);
      if (sceneResult.warnings.length) scanComplete = false;
    } catch (sceneError) {
      scanComplete = false;
      warnings.push('Could not inspect scene ' + sceneIndex + ': ' + String(sceneError && sceneError.message ? sceneError.message : sceneError));
    }
  }

  for (var symbolIndex = 0; symbolIndex < symbolItems.length; symbolIndex++) {
    if (!scanComplete) break;
    var symbol = symbolItems[symbolIndex];
    if (defaultLooking(symbol.name.split('/').pop(), 'symbol')) {
      findings.push({
        category: 'defaultName', severity: 'info', location: 'Library item "' + symbol.name + '"',
        message: 'Symbol name resembles an Animate default; review whether a descriptive name would help.'
      });
    }
    try {
      var symbolResult = withTimelineEdit(document, symbol.name, /** Audits the selected symbol timeline.
       * @param timeline Symbol timeline being inspected.
       * @returns Nothing.
       */ function (timeline) {
        auditTimeline(timeline, 'symbol "' + symbol.name + '"');
      });
      warnings = warnings.concat(symbolResult.warnings);
      if (symbolResult.warnings.length) scanComplete = false;
    } catch (symbolError) {
      scanComplete = false;
      warnings.push('Could not inspect symbol "' + symbol.name + '"; Library usage scan may be incomplete: ' + String(symbolError && symbolError.message ? symbolError.message : symbolError));
    }
  }

  for (var libraryIndex = 0; libraryIndex < libraryItems.length; libraryIndex++) {
    var libraryItem = libraryItems[libraryIndex];
    if (libraryItem.itemType === 'folder' || usages['$' + libraryItem.name] || !scanComplete) continue;
    var linked = libraryItem.linkageExportForAS === true || Boolean(libraryItem.linkageClassName);
    var indirectReference = libraryItem.itemType === 'font' || libraryItem.itemType === 'bitmap';
    findings.push({
      category: 'unusedLibraryItem', severity: linked || indirectReference ? 'info' : 'warning',
      location: 'Library item "' + libraryItem.name + '"',
      item: libraryItem.name,
      linkage: linked,
      message: linked
        ? 'No direct timeline usage was found, but linkage is enabled; it may be required externally and must not be treated as safe to delete.'
        : indirectReference
          ? 'No direct timeline usage was found. This item may be referenced by text or fills and must not be treated as safe to delete.'
        : 'No direct timeline usage was found. External code or other intentional references may exist; review before any deletion.'
    });
  }
  return serialize({ document: document.name, findings: findings, warnings: warnings });
})();
