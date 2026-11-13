// Shared element inspection helpers used by inspect_timeline and edit_elements.
var ELEMENT_FILTER_FIELDS = {
  blurFilter: ['blurX', 'blurY', 'quality'],
  glowFilter: ['blurX', 'blurY', 'color', 'alpha', 'strength', 'quality', 'inner', 'knockout'],
  dropShadowFilter: ['blurX', 'blurY', 'color', 'alpha', 'strength', 'quality', 'distance', 'angle', 'inner', 'knockout', 'hideObject'],
  bevelFilter: ['blurX', 'blurY', 'shadowColor', 'shadowAlpha', 'highlightColor', 'highlightAlpha', 'strength', 'quality', 'distance', 'angle', 'knockout', 'type'],
  gradientGlowFilter: ['blurX', 'blurY', 'colors', 'alphas', 'ratios', 'strength', 'quality', 'distance', 'angle', 'knockout', 'type'],
  gradientBevelFilter: ['blurX', 'blurY', 'colors', 'alphas', 'ratios', 'strength', 'quality', 'distance', 'angle', 'knockout', 'type'],
  adjustColorFilter: ['brightness', 'contrast', 'saturation', 'hue']
};

/** Copies a filter's main serializable parameters.
 * @param filter Animate filter instance.
 * @returns A plain filter description.
 */
function readFilter(filter) {
  var result = { name: filter.name, enabled: filter.enabled !== false };
  var fields = ELEMENT_FILTER_FIELDS[filter.name] || [];
  for (var index = 0; index < fields.length; index++) {
    if (filter[fields[index]] !== undefined) result[fields[index]] = filter[fields[index]];
  }
  return result;
}

/** Reads one instance, shape, text, or bitmap element.
 * @param element Animate timeline element.
 * @returns A plain element description.
 */
function readElement(element) {
  var libraryItem = element.libraryItem || null, transformationPoint = null, filters = [], matrix = null;
  if (element.matrix) matrix = {
    a: element.matrix.a,
    b: element.matrix.b,
    c: element.matrix.c,
    d: element.matrix.d,
    tx: element.matrix.tx,
    ty: element.matrix.ty
  };
  var point = element.getTransformationPoint ? element.getTransformationPoint() : element.transformationPoint;
  var colorMode = element.colorMode || 'none', colorEffect = {
    mode: colorMode,
    alphaPercent: element.colorAlphaPercent,
    alphaAmount: element.colorAlphaAmount
  };
  if (colorMode === 'brightness') colorEffect.brightnessPercent = element.brightness;
  if (colorMode === 'tint') {
    colorEffect.tintColor = element.tintColor;
    colorEffect.tintPercent = element.tintPercent;
  }
  if (colorMode === 'advanced') {
    colorEffect.redPercent = element.colorRedPercent;
    colorEffect.greenPercent = element.colorGreenPercent;
    colorEffect.bluePercent = element.colorBluePercent;
    colorEffect.redAmount = element.colorRedAmount;
    colorEffect.greenAmount = element.colorGreenAmount;
    colorEffect.blueAmount = element.colorBlueAmount;
  }
  if (point) transformationPoint = { x: Number(point.x || 0), y: Number(point.y || 0) };
  for (var filterIndex = 0; filterIndex < (element.filters || []).length; filterIndex++) filters.push(readFilter(element.filters[filterIndex]));
  return {
    type: libraryItem ? libraryItem.itemType : element.elementType,
    name: element.name || '',
    libraryItem: libraryItem ? libraryItem.name : '',
    matrix: matrix,
    x: Number(element.x || 0),
    y: Number(element.y || 0),
    transformationPoint: transformationPoint,
    scaleX: Number(element.scaleX === undefined ? 1 : element.scaleX),
    scaleY: Number(element.scaleY === undefined ? 1 : element.scaleY),
    rotation: Number(element.rotation || 0),
    skewX: Number(element.skewX || 0),
    skewY: Number(element.skewY || 0),
    colorEffect: colorEffect,
    filters: filters,
    blendMode: element.blendMode || 'normal',
    visible: element.visible !== false
  };
}
