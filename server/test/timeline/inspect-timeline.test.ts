import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { createJsflRunner } from "../../src/tools/core/shared.js";
import { registerInspectTimeline } from "../../src/tools/timeline/inspect-timeline.js";
import { stateLog, text, withServer } from "../helpers/fake-animate.js";

test("inspect_timeline returns layer spans and instance properties without changing the document", {
    timeout: 30_000,
}, async () => {
    await withServer(
        { FAKE_TWEEN: "motion object", FAKE_INSPECT_TINT: "1", FAKE_INSPECT_FILTERS: "1" },
        async (client) => {
            const result = await client.callTool({ name: "inspect_timeline", arguments: { timeline: 0, frame: 4 } });
            assert.equal(result.isError, undefined, text(result));
            const inspection = result.structuredContent as {
                frame: number;
                layers: {
                    name: string;
                    index: number;
                    frameCount: number;
                    spans: { start: number; end: number; keyframe: boolean; tweenType: string; label?: string }[];
                    elements: {
                        type: string;
                        name: string;
                        libraryItem: string;
                        matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number };
                        x: number;
                        y: number;
                        transformationPoint: { x: number; y: number };
                        scaleX: number;
                        scaleY: number;
                        colorEffect: { mode: string; alphaPercent: number };
                        filters: { name: string }[];
                        blendMode: string;
                        visible: boolean;
                    }[];
                }[];
            };
            assert.equal(inspection.frame, 4);
            const layer = inspection.layers[0];
            assert.equal(layer.name, "a/b");
            assert.equal(layer.index, 0);
            assert.equal(layer.frameCount, 5);
            assert.deepEqual(layer.spans, [
                { start: 1, end: 2, keyframe: true, tweenType: "none" },
                { start: 3, end: 5, keyframe: true, tweenType: "motion", label: "end" },
            ]);
            assert.equal(layer.elements[0].type, "movie clip");
            assert.equal(layer.elements[0].libraryItem, "Hero");
            assert.deepEqual(layer.elements[0].matrix, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
            assert.equal(layer.elements[0].x, 0);
            assert.equal(layer.elements[0].scaleX, 1);
            assert.deepEqual(layer.elements[0].transformationPoint, { x: 2, y: 3 });
            assert.deepEqual(layer.elements[0].colorEffect, {
                mode: "tint",
                alphaPercent: 75,
                alphaAmount: 75,
                tintColor: "#336699",
                tintPercent: 35,
            });
            assert.deepEqual(layer.elements[0].filters, [
                { name: "blurFilter", enabled: false, blurX: 8, blurY: 4, quality: "high" },
            ]);
            assert.equal(layer.elements[0].blendMode, "normal");
            assert.equal(layer.elements[0].visible, true);
            assert.equal(text(result).includes("Export again"), false);
        },
    );
});

test("inspect_timeline reports shape tween ease and blend", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_SHAPE_TWEEN_INSPECT: "1" }, async (client) => {
        const result = await client.callTool({
            name: "inspect_timeline",
            arguments: { timeline: 0, layers: ["a/b"], frame: 2 },
        });
        assert.equal(result.isError, undefined, text(result));
        const inspection = result.structuredContent as {
            layers: { spans: { tweenType: string; ease?: number; blend?: string }[] }[];
        };
        assert.deepEqual(inspection.layers[0].spans[0], {
            start: 1,
            end: 2,
            keyframe: true,
            tweenType: "shape",
            ease: 30,
            blend: "angular",
        });
    });
});

test("inspect_timeline supports selected layers, motion keyframe values and library timelines", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_SECOND_LAYER: "Other",
            FAKE_SECOND_TWEEN: "motion object",
            FAKE_SECOND_MOTION_XML:
                '<AnimationCore TimeScale="24000"><Property id="Motion_X"><Keyframe anchor="0,99" timevalue="0"/></Property></AnimationCore>',
            FAKE_TWEEN: "motion object",
            FAKE_INITIAL_CURRENT_LAYER: "1",
            FAKE_INITIAL_SELECTED_FRAMES: "[1,0,2]",
        },
        async (client, tempDir) => {
            const motion = await client.callTool({
                name: "inspect_timeline",
                arguments: { timeline: 0, layers: ["Other", "a/b"], frame: 4 },
            });
            assert.equal(motion.isError, undefined, text(motion));
            const selected = motion.structuredContent as {
                layers: { name: string; motionKeyframes?: { frame: number; values: Record<string, string> }[] }[];
            };
            assert.deepEqual(
                selected.layers.map((layer) => layer.name),
                ["Other", "a/b"],
            );
            assert.equal(selected.layers[0].motionKeyframes?.[0].values.Motion_X, "99");
            assert.equal(selected.layers[1].motionKeyframes?.[0].frame, 3);
            assert.equal(selected.layers[1].motionKeyframes?.[0].values.Motion_X, "0");
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 1,
                currentFrame: 0,
                selectedFrames: [1, 0, 2],
                selectedElements: 0,
            });

            const symbol = await client.callTool({
                name: "inspect_timeline",
                arguments: { timeline: "dir/Hero", layers: [0], frame: 1 },
            });
            assert.equal(symbol.isError, undefined, text(symbol));
            assert.equal((symbol.structuredContent as { layers: { name: string }[] }).layers[0].name, "L");
        },
    );
});

test("inspect_timeline reports text content and whole-field style", async () => {
    // Execute the real bundled JSFL against a small VM fixture to cover static-text getter failures.
    const context = createContext({});
    runInContext(
        `var __textAttrs = { face: "Arial", size: 18, fillColor: "#123456", bold: true, italic: false };
var __lineType = "multiline";
var __text = { elementType: "text", name: "caption", textType: "dynamic", get lineType() { if (this.textType === "static") throw new Error("lineType is unsupported for static text"); return __lineType; }, alignment: "center", textRuns: [{ textAttrs: __textAttrs }], getTextString: function () { return "Hello"; } };
var __frame = { startFrame: 0, duration: 1, tweenType: "none", elements: [__text] };
var __layer = { name: "Text", layerType: "normal", locked: false, visible: true, frames: [__frame] };
var __timeline = { currentLayer: 0, currentFrame: 0, selectedFrames: [], layers: [__layer], getSelectedFrames: function () { return this.selectedFrames; }, setSelectedFrames: function (frames) { this.selectedFrames = frames; } };
var __doc = { name: "text.fla", type: "Flash", currentTimeline: 0, timelines: [__timeline], library: { items: [] }, getTimeline: function () { return this.timelines[this.currentTimeline]; }, exitEditMode: function () {}, editScene: function (index) { this.currentTimeline = index; } };
var fl = { documents: [__doc], trace: function () {} };`,
        context,
    );
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    const runner = { execute: async (code: string) => runInContext(code, context) };
    registerInspectTimeline(
        {
            registerTool: (_name: string, _config: unknown, callback: (input: unknown) => unknown) => {
                handler = callback as unknown as (input: unknown) => Promise<unknown>;
            },
        } as unknown as Parameters<typeof registerInspectTimeline>[0],
        {
            runner,
            jsfl: createJsflRunner(runner),
        },
    );

    const result = (await handler?.({ timeline: 0, frame: 1 })) as {
        structuredContent: { layers: { elements: { type: string; text: string; style: Record<string, unknown> }[] }[] };
    };
    const element = result.structuredContent.layers[0].elements[0];
    assert.equal(element.type, "text");
    assert.equal(element.text, "Hello");
    assert.deepEqual(element.style, {
        face: "Arial",
        size: 18,
        fillColor: "#123456",
        bold: true,
        italic: false,
        alignment: "center",
        textType: "dynamic",
        lineType: "multiline",
    });

    runInContext('__text.textType = "static";', context);
    const staticResult = (await handler?.({ timeline: 0, frame: 1 })) as {
        structuredContent: { layers: { elements: { style: { textType: string; lineType: null } }[] }[] };
    };
    assert.deepEqual(staticResult.structuredContent.layers[0].elements[0].style, {
        face: "Arial",
        size: 18,
        fillColor: "#123456",
        bold: true,
        italic: false,
        alignment: "center",
        textType: "static",
        lineType: null,
    });
});

test("inspect_timeline adds opt-in tween geometry and restores the inspected frame", async () => {
    const context = createContext({});
    runInContext(
        `var __startElement = { elementType: "shape", name: "start", x: 123, y: 2, width: 8, height: 6, left: 1, top: 2, right: 9, bottom: 8, scaleX: 1, scaleY: 1, rotation: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } };
var __tweenElement = { elementType: "instance", instanceType: "symbol", name: "interior", libraryItem: { name: "Graphic", itemType: "graphic", timeline: { frameCount: 3 } }, symbolType: "graphic", loop: "play once", firstFrame: 2, get x() { if (timeline.failRead && timeline.currentFrame === 1) throw new Error("geometry read failed"); return timeline.currentFrame * 10; }, y: 2, width: 8, height: 6, left: 1, top: 2, right: 9, bottom: 8, scaleX: 1, scaleY: 1, rotation: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } };
var __keyframe = { startFrame: 0, duration: 3, tweenType: "motion object", name: "", getMotionObjectXML: function () { if (timeline.failMotion) throw new Error("motion read failed"); return ""; }, elements: [__startElement] };
var __middleFrame = { startFrame: 0, duration: 3, tweenType: "motion", elements: [__tweenElement] };
var __lastFrame = { startFrame: 0, duration: 3, tweenType: "motion", elements: [__tweenElement] };
var __layer = { name: "Tween", layerType: "normal", locked: false, visible: true, frames: [__keyframe, __middleFrame, __lastFrame] };
var __currentFrame = 0, __frameAssignments = [];
var timeline = { currentLayer: 0, get currentFrame() { return __currentFrame; }, set currentFrame(value) { __frameAssignments.push(value); __currentFrame = value; }, selectedFrames: [], layers: [__layer], getSelectedFrames: function () { return this.selectedFrames; }, setSelectedFrames: function (frames, end) { this.selectedFrames = end === undefined ? frames : [frames, end]; if (end !== undefined) this.currentFrame = end; } };
var __doc = { name: "geometry.fla", type: "Flash", currentTimeline: 0, timelines: [timeline], library: { items: [] }, getTimeline: function () { return this.timelines[this.currentTimeline]; }, exitEditMode: function () {}, editScene: function (index) { this.currentTimeline = index; } };
var fl = { documents: [__doc], trace: function () {} };`,
        context,
    );
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    const runner = { execute: async (code: string) => runInContext(code, context) };
    registerInspectTimeline(
        {
            registerTool: (_name: string, _config: unknown, callback: (input: unknown) => unknown) => {
                handler = callback as unknown as (input: unknown) => Promise<unknown>;
            },
        } as unknown as Parameters<typeof registerInspectTimeline>[0],
        {
            runner,
            jsfl: createJsflRunner(runner),
        },
    );

    const legacy = (await handler?.({ timeline: 0, frame: 2 })) as {
        structuredContent: { layers: { elements: Record<string, unknown>[] }[] };
    };
    assert.equal(legacy.structuredContent.layers[0].elements[0].x, 123);
    assert.equal("instanceType" in legacy.structuredContent.layers[0].elements[0], false);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("__frameAssignments", context))), [1, 0]);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("timeline.selectedFrames", context))), []);

    runInContext("__frameAssignments.length = 0; timeline.failMotion = true;", context);
    const legacyFailed = (await handler?.({ timeline: 0, frame: 2 })) as { isError?: boolean };
    assert.equal(legacyFailed.isError, true);
    assert.equal(runInContext("timeline.currentFrame", context), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("__frameAssignments", context))), [1, 0]);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("timeline.selectedFrames", context))), []);
    runInContext("timeline.failMotion = false; __frameAssignments.length = 0;", context);

    const result = (await handler?.({ timeline: 0, frame: 2, geometry: true })) as {
        structuredContent: { layers: { elements: Record<string, unknown>[] }[] };
    };
    const element = result.structuredContent.layers[0].elements[0];
    assert.equal(element.x, 10);
    assert.deepEqual(element.bounds, { left: 1, top: 2, right: 9, bottom: 8 });
    assert.equal(element.interpolated, true);
    assert.equal("matrix" in element, false);
    assert.equal(element.instanceType, "symbol");
    assert.equal(element.symbolFrameCount, 3);
    assert.equal(element.loop, "play once");
    assert.equal(element.firstFrame, 2);
    assert.equal(runInContext("timeline.currentFrame", context), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("__frameAssignments", context))), [1, 1, 0]);

    runInContext("__keyframe.tweenType = 'shape'; __frameAssignments.length = 0;", context);
    const shapeTween = (await handler?.({ timeline: 0, frame: 2, geometry: true })) as {
        isError?: boolean;
        content?: { text: string }[];
        structuredContent: { layers: { elements: Record<string, unknown>[] }[] };
    };
    assert.equal(shapeTween.isError, undefined, shapeTween.content?.[0].text);
    assert.equal("interpolated" in shapeTween.structuredContent.layers[0].elements[0], false);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("__frameAssignments", context))), []);

    runInContext("__keyframe.tweenType = 'motion object'; __frameAssignments.length = 0;", context);
    runInContext("timeline.failRead = true; __frameAssignments.length = 0;", context);
    const failed = (await handler?.({ timeline: 0, frame: 2, geometry: true })) as { isError?: boolean };
    assert.equal(failed.isError, true);
    assert.equal(runInContext("timeline.currentFrame", context), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(runInContext("__frameAssignments", context))), [1, 1, 0]);
});
