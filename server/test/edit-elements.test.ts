import assert from "node:assert/strict";
import { test } from "node:test";
import { layersLog, stateLog, text, withServer } from "./helpers/fake-animate.js";

test("edit_elements updates instances and returns the values read back from Animate", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    {
                        layer: "a/b",
                        frame: 1,
                        element: 0,
                        set: {
                            x: 12.5,
                            y: 8,
                            scaleX: 1.5,
                            scaleY: 0.75,
                            rotation: 30,
                            name: "runner",
                            blendMode: "multiply",
                            visible: false,
                            filters: [{ name: "blurFilter", blurX: 8, blurY: 4, quality: "high", enabled: false }],
                        },
                    },
                ],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            applied: 1,
            elements: [
                {
                    layer: "a/b",
                    frame: 1,
                    element: 0,
                    name: "runner",
                    x: 12.5,
                    y: 8,
                    scaleX: 1.5,
                    scaleY: 0.75,
                    rotation: 30,
                    skewX: 0,
                    skewY: 0,
                    colorMode: "alpha",
                    blendMode: "multiply",
                    visible: false,
                    filters: [{ name: "blurFilter", blurX: 8, blurY: 4, quality: "high", enabled: false }],
                },
            ],
        });
        const element = (await layersLog(tempDir)).at(-1)[0].frames[0].elements[0];
        assert.equal(element.x, 12.5);
        assert.equal(element.name, "runner");
    });
});

test("edit_elements applies all color modes and clears filters", { timeout: 45_000 }, async () => {
    const cases = [
        { mode: "none" },
        { mode: "alpha", alphaPercent: 57 },
        { mode: "brightness", brightnessPercent: 34 },
        { mode: "tint", tintColor: "#33aaee", tintPercent: 63 },
        {
            mode: "advanced",
            redPercent: 80,
            greenPercent: 70,
            bluePercent: 60,
            redAmount: 10,
            greenAmount: -20,
            blueAmount: 30,
        },
    ];
    for (const colorEffect of cases) {
        await withServer({}, async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: {
                    timeline: 0,
                    ops: [{ layer: 0, frame: 1, element: 0, set: { colorEffect, filters: [] } }],
                },
            });
            assert.equal(result.isError, undefined, text(result));
            const element = (await layersLog(tempDir)).at(-1)[0].frames[0].elements[0];
            assert.equal(element.colorMode, colorEffect.mode);
            assert.deepEqual(element.filters, []);
            if (colorEffect.mode === "alpha") {
                assert.equal(element.colorAlphaPercent, 57);
            }
            if (colorEffect.mode === "brightness") {
                assert.equal(element.brightness, 34);
            }
            if (colorEffect.mode === "tint") {
                assert.equal(element.tintColor, "#33aaee");
                assert.equal(element.tintPercent, 63);
            }
            if (colorEffect.mode === "advanced") {
                assert.equal(element.colorRedPercent, 80);
                assert.equal(element.colorGreenAmount, -20);
            }
        });
    }
});

test("edit_elements rejects tween interiors, temporarily unlocks layers, and validates atomically", {
    timeout: 60_000,
}, async () => {
    for (const tween of ["motion", "motion object"]) {
        await withServer({ FAKE_TWEEN: tween }, async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: { timeline: 0, ops: [{ layer: "a/b", frame: 4, element: 0, set: { x: 90 } }] },
            });
            assert.equal(result.isError, true);
            assert.match(text(result), /tween|keyframe/i);
            assert.equal((await layersLog(tempDir)).at(-1)[0].frames[1].elements[0].x, 0);
        });
    }

    await withServer({ FAKE_LOCK_DISTRIBUTE: "1", FAKE_ENFORCE_ELEMENT_LOCK: "1" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: { timeline: 0, ops: [{ layer: "a/b", frame: 1, element: 0, set: { x: 40 } }] },
        });
        assert.equal(result.isError, undefined, text(result));
        const layer = (await layersLog(tempDir)).at(-1)[0];
        assert.equal(layer.locked, true);
        assert.equal(layer.writeWasUnlocked, true);
        assert.equal(layer.frames[0].elements[0].x, 40);
    });

    await withServer(
        {
            FAKE_INITIAL_CURRENT_FRAME: "3",
            FAKE_INITIAL_SELECTED_FRAMES: "[0,2,4]",
            FAKE_INITIAL_SELECTED_ELEMENT: "1",
        },
        async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: { timeline: 0, ops: [{ layer: "a/b", frame: 1, element: 0, set: { x: 20 } }] },
            });
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 0,
                currentFrame: 3,
                selectedFrames: [0, 2, 4],
                selectedElements: 1,
            });
        },
    );

    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { layer: "a/b", frame: 99, element: 0, set: { y: 10 } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.equal((await layersLog(tempDir)).at(-1)[0].frames[0].elements[0].x, 0);

        const invalidColor = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    {
                        layer: "a/b",
                        frame: 1,
                        element: 0,
                        set: { colorEffect: { mode: "brightness", brightnessPercent: 101 } },
                    },
                ],
            },
        });
        assert.equal(invalidColor.isError, true);
        assert.match(text(invalidColor), /brightnessPercent/);
        assert.equal((await layersLog(tempDir)).at(-1)[0].frames[0].elements[0].x, 0);
    });
});
