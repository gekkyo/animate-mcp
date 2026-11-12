import assert from "node:assert/strict";
import { test } from "node:test";
import { stateLog, text, withServer } from "./helpers/fake-animate.js";

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
            assert.equal(text(result).includes("Export again"), false);
        },
    );
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
