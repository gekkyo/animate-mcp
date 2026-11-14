export const elementsRuntime = `const lib = { name: "Hero", itemType: "movie clip" };
/** Simulates Animate's read-only color-effect properties. */
const lockColorEffectProperties = (element) => {
  Object.defineProperties(element, {
    __fakeBrightness: { value: element.brightness, writable: true, configurable: true },
    __fakeTintColor: { value: element.tintColor, writable: true, configurable: true },
    __fakeTintPercent: { value: element.tintPercent, writable: true, configurable: true },
    brightness: { enumerable: true, configurable: true, get() { return this.__fakeBrightness; } },
    tintColor: { enumerable: true, configurable: true, get() { return this.__fakeTintColor; } },
    tintPercent: { enumerable: true, configurable: true, get() { return this.__fakeTintPercent; } },
  });
};
/** Creates a fake Animate symbol instance with a writable transformation point.
 * @param name Instance name
 * @param x Horizontal position
 * @param libraryItem Referenced library symbol
 * @returns The fake symbol instance
 */
const makeInstance = (name, x, libraryItem = lib) => ({ elementType: "instance", name, libraryItem, x, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: 0 }, transformationPoint: { x: 2, y: 3 }, colorMode: "alpha", colorAlphaPercent: 75, colorAlphaAmount: 75, brightness: 0, colorBrightnessPercent: 0, tintColor: "#FFFFFF", tintPercent: 0, color: "#ffffff", colorTintPercent: 0, colorRedPercent: 100, colorGreenPercent: 100, colorBluePercent: 100, colorRedAmount: 0, colorGreenAmount: 0, colorBlueAmount: 0, filters: [], blendMode: "normal", visible: true, cacheAsBitmap: false, loop: "loop", firstFrame: 1, lastFrame: 5, trackAsMenu: false,
  /** Reads the fake transformation point. @returns The transformation point */
  getTransformationPoint() { return this.transformationPoint; },
  /** Writes the fake transformation point.
   * @param point New transformation point
   * @returns Nothing
   */
  setTransformationPoint(point) { this.transformationPoint = { x: point.x, y: point.y }; }
});
/**
 * Creates a fake Animate keyframe with default properties and any supplied overrides.
 * @param startFrame Starting frame index
 * @param duration Number of frames in the keyframe
 * @param extra Additional keyframe properties to apply
 * @returns The constructed keyframe
 */
const makeKeyframe = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [],
  /** Stores fake classic custom-ease points. @param group Tween property group @param points Ease control points @returns Nothing */
  setCustomEase(group, points) { this.customEases = this.customEases || {}; this.customEases[group] = points; },
  /** Returns a minimal fake motion-object XML graph for tween tests. */
  getMotionObjectXML() {
    const timeline = this.__fakeTimeline;
    if (timeline) {
      const layerIndex = timeline.layers.findIndex((candidate) => candidate.frames.includes(this));
      const selected = timeline.selectedFrames;
      if (timeline.currentLayer !== layerIndex || !selected || selected[0] !== layerIndex || selected[1] !== this.startFrame || selected[2] !== this.startFrame + 1) {
        throw new Error("motion XML requested without selecting its layer and frame");
      }
    }
    return this.motionXML || '<AnimationCore TimeScale="24000" Version="1" duration="5000"><PropertyContainer id="Basic_Motion"><Property id="Motion_X"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property><Property id="Motion_Y"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property><Property id="Rotation_Z"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property></PropertyContainer><PropertyContainer id="Transformation"><Property id="Scale_X"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property><Property id="Scale_Y"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property></PropertyContainer><PropertyContainer id="Colors"><Property id="Alpha_Amount"><Keyframe anchor="0,100" next="0,100" previous="0,100" roving="0" timevalue="0"/></Property><Property id="Brightness_Amount"><Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"/></Property></PropertyContainer></AnimationCore>';
  },
  /** Stores a fake motion-object XML graph. @param xml XML graph to store */
  setMotionObjectXML(xml) { this.motionXML = xml; }
}, extra);
`;
