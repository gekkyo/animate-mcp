export const timelineRuntime = `// Like real Animate, layer.frames has one element per frame (the keyframe's frame repeated duration times)
/**
 * Expands keyframes into one entry per timeline frame.
 * @param keyframes Keyframes to expand
 * @returns The expanded frame array
 */
const expand = (keyframes) => keyframes.flatMap((keyframe) => Array(keyframe.duration).fill(keyframe));
/**
 * Creates a fake Animate layer and enforces lock behavior on its frames.
 * @param name Layer name
 * @param frames Expanded layer frame array
 * @param layerType Animate layer type
 * @param locked Whether the layer starts locked
 * @param parentLayer Parent layer, if any
 * @returns The constructed layer
 */
const layer = (name, frames, layerType = "normal", locked = false, parentLayer = null) => {
  const result = { name, frames, layerType, locked, writeWasUnlocked: false };
  if (parentLayer) result.parentLayer = parentLayer;
  if (locked) {
    for (const frame of new Set(frames)) {
      let actionScript = frame.actionScript;
      Object.defineProperty(frame, "actionScript", {
        /** Returns the frame's current ActionScript. */
        get: () => actionScript,
        /**
         * Updates the frame's ActionScript, enforcing the layer lock.
         * @param value New ActionScript text
         */
        set: (value) => {
          if (result.locked) throw new Error("Layer is locked");
          result.writeWasUnlocked = true;
          actionScript = value;
        },
      });
    }
  }
  if (process.env.FAKE_ENFORCE_ELEMENT_LOCK) {
    for (const frame of new Set(frames)) for (const element of frame.elements || []) {
      let x = element.x;
      Object.defineProperty(element, "x", {
        enumerable: true,
        configurable: true,
        get: () => x,
        set: (value) => {
          if (result.locked) throw new Error("Layer is locked");
          result.writeWasUnlocked = true;
          x = value;
        },
      });
    }
  }
  return result;
};
/**
 * Creates a fake Animate timeline with the operations used by the tests.
 * @param name Timeline name
 * @param frames Initial timeline frame count
 * @param layers Timeline layers
 * @param libraryItem Library item associated with the timeline, if any
 * @returns The constructed timeline
 */
const makeTimeline = (name, frames, layers, libraryItem) => {
  const timeline = { name, frameCount: frames, currentLayer: 0, currentFrame: 0, selectedFrames: null, clipboard: null, layers, libraryItem,
    /** Recalculates the timeline frame count from its layers. */
    recalculateFrameCount() { this.frameCount = Math.max(0, ...this.layers.map((candidate) => candidate.frames.length)); },
    /**
     * Recalculates keyframe spans on a layer and updates the timeline frame count.
     * @param targetLayer Layer whose keyframe spans to recalculate
     */
    recalculateLayer(targetLayer) {
      let start = 0;
      while (start < targetLayer.frames.length) {
        const frame = targetLayer.frames[start];
        let end = start + 1;
        while (end < targetLayer.frames.length && targetLayer.frames[end] === frame) end++;
        frame.startFrame = start;
        frame.duration = end - start;
        start = end;
      }
      this.recalculateFrameCount();
    },
    /**
     * Inserts frames into the current layer or all non-folder layers.
     * @param count Number of frames to insert
     * @param allLayers Whether to insert into every non-folder layer
     * @param frameNumberIndex Zero-based insertion frame index
     */
    insertFrames(count, allLayers, frameNumberIndex) {
      const targets = allLayers ? this.layers.filter((candidate) => candidate.layerType !== "folder") : [this.layers[this.currentLayer]];
      for (const target of targets) {
        if (target.locked) throw new Error("Layer is locked");
        const index = Math.min(frameNumberIndex, target.frames.length);
        const active = target.frames[Math.min(index, target.frames.length - 1)];
        const insertAt = active && active.startFrame === index ? index + 1 : index;
        const content = active || makeKeyframe(insertAt, count);
        target.frames.splice(insertAt, 0, ...Array(count).fill(content));
        this.recalculateLayer(target);
      }
    },
    /**
     * Removes a range of frames from the current layer.
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index
     */
    removeFrames(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    /**
     * Inserts a keyframe at the requested frame on the current layer.
     * @param frameNumber Zero-based frame index for the new keyframe
     */
    insertKeyframe(frameNumber) {
      const currentLayer = this.layers[this.currentLayer];
      if (currentLayer.locked) throw new Error("Layer is locked");
      const oldFrame = currentLayer.frames[frameNumber];
      if (!oldFrame) {
        currentLayer.frames[frameNumber] = makeKeyframe(frameNumber, 1);
        return;
      }
      if (oldFrame.startFrame === frameNumber) return;
      const oldEnd = oldFrame.startFrame + oldFrame.duration;
      oldFrame.duration = frameNumber - oldFrame.startFrame;
      const insertedFrame = Object.assign({}, oldFrame, { startFrame: frameNumber, duration: oldEnd - frameNumber, actionScript: "", elements: oldFrame.elements.map((element) => Object.assign({}, element, { filters: (element.filters || []).map((filter) => Object.assign({}, filter)) })) });
      for (let index = frameNumber; index < oldEnd; index++) { currentLayer.frames[index] = insertedFrame; }
      if (process.env.FAKE_PERSIST_AS && currentLayer.name.toLowerCase() === "as") {
        writeFileSync(process.env.FAKE_LOG + ".as-keyframe-created", "yes");
      }
    },
    /**
     * Converts the requested frame on the current layer to a keyframe.
     * @param frameNumber Zero-based frame index to convert
     */
    convertToKeyframes(frameNumber) {
      this.insertKeyframe(frameNumber);
    },
    /**
     * Clears a keyframe on the current layer and merges its span with the prior span.
     * @param frameNumber Zero-based frame index of the keyframe to clear
     */
    clearKeyframes(frameNumber) {
      const currentLayer = this.layers[this.currentLayer];
      if (currentLayer.locked) throw new Error("Layer is locked");
      const frame = currentLayer.frames[frameNumber];
      if (!frame || frame.startFrame !== frameNumber) return;
      if (frameNumber === 0) {
        const blank = makeKeyframe(0, frame.duration);
        for (let index = 0; index < frame.duration; index++) currentLayer.frames[index] = blank;
      } else {
        const previous = currentLayer.frames[frameNumber - 1];
        previous.duration += frame.duration;
        for (let index = frameNumber; index < frameNumber + frame.duration; index++) currentLayer.frames[index] = previous;
      }
      this.recalculateLayer(currentLayer);
    },
    /**
     * Sets a property on frames in the current layer.
     * @param property Frame property to update
     * @param value New property value
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index, or undefined for one frame
     */
    setFrameProperty(property, value, startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      const end = endFrameIndex === undefined ? startFrameIndex + 1 : endFrameIndex;
      for (let index = startFrameIndex; index < end; index++) target.frames[index][property] = value;
    },
    /**
     * Selects the current layer by index.
     * @param layerIndex Zero-based layer index
     */
    setSelectedLayers(layerIndex) {
      this.currentLayer = layerIndex;
    },
    /**
     * Selects a frame range on the current layer.
     * @param startFrameIndex Zero-based start frame index
     * @param endFrameIndex Exclusive end frame index
     */
    getSelectedFrames() { return this.selectedFrames ? this.selectedFrames.slice() : []; },
    setSelectedFrames(startFrameIndex, endFrameIndex) {
      if (process.env.FAKE_AUDIT_RESTORE_FAIL && Array.isArray(startFrameIndex) && startFrameIndex.length === 0 && this.libraryItem) {
        throw new Error("fake audit selection restore failure");
      }
      if (Array.isArray(startFrameIndex)) {
        this.selectedFrames = startFrameIndex.slice();
        if (this.selectedFrames.length) this.currentLayer = this.selectedFrames[0];
      } else {
        this.selectedFrames = [this.currentLayer, startFrameIndex, endFrameIndex];
      }
    },
    /** Creates a fake motion-object span from a zero-based start to an exclusive end.
     * @param startFrameIndex Zero-based start frame
     * @param endFrameIndex Exclusive end frame
     * @returns Nothing
     */
    createMotionObject(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      this.insertKeyframe(startFrameIndex);
      const frame = target.frames[startFrameIndex];
      frame.tweenType = "motion object";
      for (let index = startFrameIndex; index < endFrameIndex; index++) target.frames[index] = frame;
      this.recalculateLayer(target);
    },
    /** Creates a fake classic tween between adjacent keyframes.
     * @param startFrameIndex Zero-based start frame
     * @param endFrameIndex Exclusive end frame
     * @returns Nothing
     */
    createMotionTween(startFrameIndex, endFrameIndex) {
      const target = this.layers[this.currentLayer];
      const frame = target.frames[startFrameIndex];
      frame.tweenType = "motion";
      frame.duration = endFrameIndex - startFrameIndex;
      this.recalculateLayer(target);
    },
    /** Cuts the selected range from its layer into the timeline clipboard. */
    cutFrames() {
      const [layerIndex, startFrameIndex, endFrameIndex] = this.selectedFrames;
      const target = this.layers[layerIndex];
      if (target.locked) throw new Error("Layer is locked");
      this.clipboard = target.frames.slice(startFrameIndex, endFrameIndex).map((frame) => Object.assign({}, frame));
      target.frames.splice(startFrameIndex, endFrameIndex - startFrameIndex);
      this.recalculateLayer(target);
    },
    /**
     * Pastes the clipboard into the current layer at the given frame.
     * @param startFrameIndex Zero-based frame index for the paste
     */
    pasteFrames(startFrameIndex) {
      const target = this.layers[this.currentLayer];
      if (target.locked) throw new Error("Layer is locked");
      const keyframes = this.clipboard.filter((frame, index) => frame.startFrame === index).map((frame) =>
        Object.assign({}, frame, { startFrame: frame.startFrame + startFrameIndex }),
      );
      const lastKeyframe = keyframes.at(-1);
      if (lastKeyframe) lastKeyframe.duration = Math.max(lastKeyframe.duration, this.frameCount - lastKeyframe.startFrame);
      const frames = [];
      if (startFrameIndex > 0) {
        const blank = makeKeyframe(0, startFrameIndex);
        frames.push(...Array(startFrameIndex).fill(blank));
      }
      for (const frame of keyframes) frames.push(...Array(frame.duration).fill(frame));
      target.frames.splice(0, target.frames.length, ...frames);
      this.recalculateLayer(target);
    },
    /**
     * Deletes a layer and clears child references to it.
     * @param layerIndex Zero-based index of the layer to delete
     */
    deleteLayer(layerIndex) {
      const removed = this.layers.splice(layerIndex, 1)[0];
      for (const candidate of this.layers) if (candidate.parentLayer === removed) delete candidate.parentLayer;
      this.currentLayer = Math.min(this.currentLayer, this.layers.length - 1);
      this.recalculateFrameCount();
    },
    /**
     * Moves a layer before or after another layer.
     * @param layerToMove Zero-based index of the layer to move
     * @param layerToPutItBy Zero-based index of the reference layer
     * @param addBefore Whether to place the moved layer before the reference layer
     */
    reorderLayer(layerToMove, layerToPutItBy, addBefore = true) {
      const moved = this.layers.splice(layerToMove, 1)[0];
      let target = layerToPutItBy - (layerToMove < layerToPutItBy ? 1 : 0);
      if (!addBefore) target++;
      this.layers.splice(target, 0, moved);
    },
    /**
     * Adds a layer adjacent to the current layer and selects it.
     * @param layerName Name of the new layer
     * @param layerType Animate layer type
     * @param addAbove Whether to insert above the current layer
     * @returns The zero-based index of the new layer
     */
    addNewLayer(layerName, layerType, addAbove) {
      const actualName = process.env.FAKE_RENAME_STATIC && layerName === "static" ? "static_idn" : layerName;
      const newLayer = layer(actualName, expand([makeKeyframe(0, this.frameCount)]), layerType);
      const insertIndex = this.layers.length ? this.currentLayer + (addAbove ? 0 : 1) : 0;
      this.layers.splice(insertIndex, 0, newLayer);
      this.currentLayer = insertIndex;
      if (process.env.FAKE_PERSIST_AS && layerName.toLowerCase() === "as") {
        writeFileSync(process.env.FAKE_LOG + ".as-created", "yes");
      }
      return insertIndex;
    },
  };
  for (const candidate of layers) for (const frame of new Set(candidate.frames)) {
    Object.defineProperty(frame, "__fakeTimeline", { value: timeline, configurable: true });
  }
  return timeline;
};
/**
 * Creates a one-frame fake timeline for a library symbol.
 * @param symbolName Library symbol name
 * @param script Initial ActionScript for the symbol
 * @returns The constructed symbol timeline
 */
const symTimeline = (symbolName, script) => makeTimeline(symbolName, 1, [layer("L", expand([makeKeyframe(0, 1, { actionScript: script, elements: process.env.FAKE_SYM_INSTANCE ? [makeInstance("symbolInstance", 10)] : [] })]))], { name: symbolName });
`;
