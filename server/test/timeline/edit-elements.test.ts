import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { z } from "zod";
import { registerEditElements } from "../../src/tools/timeline/edit-elements.js";
import { layersLog, stateLog, text, withServer } from "../helpers/fake-animate.js";

const callEditElementsWithSymbolType = async (
    input: Record<string, unknown>,
    options: {
        libraryItemType: string;
        symbolType: string;
        timeline?: { frameCount?: number; layers?: { frames?: unknown[] }[] };
    },
) => {
    const context = createContext({});
    runInContext(
        `var __libraryItem = { name: "Hero", itemType: ${JSON.stringify(options.libraryItemType)}, timeline: ${JSON.stringify(options.timeline ?? { frameCount: 3 })} };
var __targetItem = { name: "SwapTarget", itemType: "graphic", timeline: { frameCount: 3 } };
var __element = { elementType: "instance", symbolType: ${JSON.stringify(options.symbolType)}, name: "hero", libraryItem: __libraryItem, x: 0, y: 0,
  scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, loop: "loop", firstFrame: 1, filters: [], blendMode: "normal", visible: true };
var __frame = { startFrame: 0, tweenType: "none", elements: [__element] };
var __layer = { name: "L", layerType: "normal", locked: false, frames: [__frame] };
var __timeline = { currentLayer: 0, currentFrame: 0, libraryItem: null, layers: [__layer], getSelectedFrames: function () { return []; }, setSelectedFrames: function () {} };
var __doc = { name: "fixture.fla", type: "Flash", currentTimeline: 0, timelines: [__timeline], library: { items: [__libraryItem, __targetItem], editItem: function () {},
  addItemToDocument: function (point, name) { var added = {}; for (var property in __element) added[property] = __element[property]; added.name = ""; added.selected = false;
    added.libraryItem = this.items.filter(function (item) { return item.name === name; })[0]; added.symbolType = added.libraryItem.itemType; added.x = point.x; added.y = point.y; __frame.elements.push(added); return true; } },
  getTimeline: function () { return this.timelines[0]; }, exitEditMode: function () {}, editScene: function () {}, selectNone: function () { __element.selected = false; },
  swapElement: function (name) { __swapWrites++; __element.libraryItem = this.library.items.filter(function (item) { return item.name === name; })[0]; } };
var __swapWrites = 0;
Object.defineProperty(__doc, "selection", { get: function () { return __element.selected ? [__element] : []; } });
var fl = { documents: [__doc], trace: function () {} };`,
        context,
    );
    let handler: ((input: never) => Promise<unknown>) | undefined;
    let inputSchema: z.ZodRawShape = {};
    const bundlePaths: Record<string, string> = {
        "select-document": "server/jsfl/shared/select-document.jsfl",
        "edit-state": "server/jsfl/shared/edit-state.jsfl",
        "export-common": "server/jsfl/shared/export-common.jsfl",
        "timeline-helpers": "server/jsfl/timeline/helpers.jsfl",
        "element-read": "server/jsfl/shared/element-read.jsfl",
        "edit-elements": "server/jsfl/timeline/edit-elements.jsfl",
    };
    const bundle = (...names: string[]) =>
        names.map((name) => readFileSync(resolve(bundlePaths[name]), "utf8")).join("\n");
    registerEditElements(
        {
            registerTool: (_name, config, callback) => {
                inputSchema = config.inputSchema as z.ZodRawShape;
                handler = callback as (input: never) => Promise<unknown>;
            },
        } as never,
        { runner: { execute: async (code) => runInContext(code, context) }, bundle },
    );
    const parsed = z.object(inputSchema).safeParse(input);
    if (!parsed.success) {
        return { isError: true, content: [{ type: "text", text: parsed.error.message }], context };
    }
    return { ...((await handler?.(parsed.data as never)) as object), context };
};

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
                    type: "movie clip",
                    name: "runner",
                    libraryItem: "Hero",
                    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                    x: 12.5,
                    y: 8,
                    transformationPoint: { x: 2, y: 3 },
                    scaleX: 1.5,
                    scaleY: 0.75,
                    rotation: 30,
                    skewX: 0,
                    skewY: 0,
                    colorEffect: { mode: "alpha", alphaPercent: 75, alphaAmount: 75 },
                    filters: [{ name: "blurFilter", blurX: 8, blurY: 4, quality: "high", enabled: false }],
                    blendMode: "multiply",
                    visible: false,
                    layer: "a/b",
                    frame: 1,
                    element: 0,
                },
            ],
        });
        const element = (await layersLog(tempDir)).at(-1)[0].frames[0].elements[0];
        assert.equal(element.x, 12.5);
        assert.equal(element.name, "runner");
    });
});

test("edit_elements adds a library item on a new layer at the stage center and extends to the requested frame", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_RENAME_STATIC: "1",
            FAKE_INITIAL_CURRENT_LAYER: "1",
            FAKE_INITIAL_CURRENT_FRAME: "3",
            FAKE_INITIAL_SELECTED_FRAMES: "[1,0,2]",
        },
        async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: {
                    timeline: 0,
                    ops: [
                        { op: "add", item: "dir/Hero", layer: "static", frame: 7, set: { name: "newHero" } },
                        { op: "add", item: "dir/Hero", layer: "static", frame: 7, set: { name: "secondHero" } },
                        { layer: 0, frame: 1, element: 0, set: { x: 99 } },
                    ],
                },
            });
            assert.equal(result.isError, undefined, text(result));
            assert.equal(result.structuredContent.applied, 3);
            assert.deepEqual(
                result.structuredContent.elements
                    .slice(0, 2)
                    .map((element) => [
                        element.name,
                        element.layer,
                        element.frame,
                        element.element,
                        element.x,
                        element.y,
                    ]),
                [
                    ["newHero", "static_idn", 7, 0, 275, 200],
                    ["secondHero", "static_idn", 7, 1, 275, 200],
                ],
            );
            const layers = await layersLog(tempDir);
            const placed = layers.at(-1)[0];
            assert.equal(placed.name, "static_idn");
            assert.equal(placed.parent, undefined);
            assert.equal(placed.frames.at(-1).start, 6);
            assert.deepEqual(
                placed.frames.at(-1).elements.map((element) => element.name),
                ["newHero", "secondHero"],
            );
            assert.equal(layers.at(-1).find((layer) => layer.name === "a/b").frames[0].elements[0].x, 99);
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 2,
                currentFrame: 3,
                selectedFrames: [2, 0, 2],
                selectedElements: 0,
            });
        },
    );
});

test("edit_elements adds to an existing layer at supplied coordinates and applies instance properties", {
    timeout: 30_000,
}, async () => {
    await withServer({ FAKE_ADD_ITEM_OFFSET: "5" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    {
                        op: "add",
                        item: "dir/Hero",
                        layer: "a/b",
                        frame: 1,
                        x: 40,
                        y: 60,
                        set: { name: "placed", rotation: 15 },
                    },
                ],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        const added = result.structuredContent.elements[0];
        assert.equal(added.name, "placed");
        assert.equal(added.libraryItem, "dir/Hero");
        assert.equal(added.x, 40);
        assert.equal(added.y, 60);
        assert.equal(added.rotation, 15);
        assert.equal(added.layer, "a/b");
        assert.equal(added.frame, 1);
        assert.equal(added.element, 1);
        const layer = (await layersLog(tempDir)).at(-1).find((candidate) => candidate.name === "a/b");
        assert.deepEqual(
            layer.frames[0].elements.map((element) => element.name),
            ["hero", "placed"],
        );
    });
});

test("edit_elements adds on a symbol timeline and rejects an invalid later add before any mutation", {
    timeout: 30_000,
}, async () => {
    await withServer({ FAKE_SYM_INSTANCE: "1" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: "dir/Hero",
                ops: [{ op: "add", item: "dir/Bitmap", layer: "symbolAdditions", frame: 3 }],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        assert.equal(result.structuredContent.elements[0].libraryItem, "dir/Bitmap");
        assert.equal(result.structuredContent.elements[0].layer, "symbolAdditions");
        assert.equal(result.structuredContent.elements[0].frame, 3);
        assert.equal(result.structuredContent.elements[0].x, 275);
        assert.equal(result.structuredContent.elements[0].y, 200);
        assert.deepEqual((await stateLog(tempDir)).at(-1), {
            currentLayer: 0,
            currentFrame: 0,
            selectedFrames: [],
            selectedElements: 0,
        });

        const invalid = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { op: "add", item: "missing", layer: "mustNotBeCreated", frame: 1 },
                ],
            },
        });
        assert.equal(invalid.isError, true);
        assert.match(text(invalid), /Library item not found/);
        const sceneLayers = (await layersLog(tempDir)).at(-1);
        assert.equal(
            sceneLayers.some((layer) => layer.name === "mustNotBeCreated"),
            false,
        );
        assert.equal(sceneLayers.find((layer) => layer.name === "a/b").frames[0].elements[0].x, 0);

        const selfAdd = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: "dir/Hero",
                ops: [{ op: "add", item: "dir/Hero", layer: "recursive", frame: 1 }],
            },
        });
        assert.equal(selfAdd.isError, true);
        assert.match(text(selfAdd), /own symbol timeline/);
    });
});

test("edit_elements rejects tween keyframes and extension of a tween before mutation", {
    timeout: 30_000,
}, async () => {
    for (const frame of [3, 7]) {
        await withServer({ FAKE_TWEEN: "motion" }, async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: {
                    timeline: 0,
                    ops: [{ op: "add", item: "dir/Hero", layer: "a/b", frame }],
                },
            });
            assert.equal(result.isError, true);
            assert.match(text(result), /tween/i);
            const layer = (await layersLog(tempDir)).at(-1).find((candidate) => candidate.name === "a/b");
            assert.deepEqual(
                layer.frames.map((keyframe) => [keyframe.start, keyframe.tween, keyframe.elements.length]),
                [
                    [0, "none", 1],
                    [2, "motion", 1],
                ],
            );
        });
    }
});

test("edit_elements rejects non-visual Library items before any mutation", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { op: "add", item: "Font", layer: "mustNotBeCreated", frame: 1 },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /not a visual item/i);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(
            layers.some((layer) => layer.name === "mustNotBeCreated"),
            false,
        );
        assert.equal(layers.find((layer) => layer.name === "a/b").frames[0].elements[0].x, 0);
    });
});

test("edit_elements preserves the existing update operation shape", { timeout: 30_000 }, async () => {
    await withServer({}, async (client) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [{ op: "set", layer: 0, frame: 1, element: 0, set: { x: 1 } }],
            },
        });
        assert.equal(result.isError, true);
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
            assert.equal(JSON.parse(text(result)).elements[0].colorEffect.mode, colorEffect.mode);
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

test("edit_elements edits a library symbol and restores the prior scene selection", { timeout: 30_000 }, async () => {
    await withServer(
        {
            FAKE_SYM_INSTANCE: "1",
            FAKE_INITIAL_CURRENT_FRAME: "3",
            FAKE_INITIAL_SELECTED_FRAMES: "[0,2,4]",
            FAKE_INITIAL_SELECTED_ELEMENT: "1",
        },
        async (client, tempDir) => {
            const result = await client.callTool({
                name: "edit_elements",
                arguments: {
                    timeline: "dir/Hero",
                    ops: [{ layer: "L", frame: 1, element: "symbolInstance", set: { x: 42 } }],
                },
            });
            assert.equal(result.isError, undefined, text(result));
            const element = JSON.parse(text(result)).elements[0];
            assert.equal(element.x, 42);
            assert.equal(element.type, "movie clip");
            assert.equal(element.colorEffect.mode, "alpha");
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 0,
                currentFrame: 3,
                selectedFrames: [0, 2, 4],
                selectedElements: 1,
            });
        },
    );
});

test("edit_elements rejects non-instance elements before any writes", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_DISTRIBUTE: "1", FAKE_DISTRIBUTE_BAD_ELEMENT: "1" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 1, set: { x: 99 } },
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /Only symbol instances can be edited/);
        const elements = (await layersLog(tempDir)).at(-1)[0].frames[0].elements;
        assert.equal(elements[1].x, 20);
    });
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

test("edit_elements sets graphic loop on added instances", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_EXTRA: "1" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [{ op: "add", item: "S0", layer: "a/b", frame: 1, set: { loop: "single frame" } }],
            },
        });
        assert.equal(result.isError, undefined, text(result));
        const element = (await layersLog(tempDir)).at(-1)[0].frames[0].elements.at(-1);
        assert.equal(element.loop, "single frame");
    });
});

test("edit_elements rejects graphic-only properties on movie clips before writes", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { layer: "a/b", frame: 1, element: 0, set: { loop: "play once" } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /graphic/i);
        assert.equal((await layersLog(tempDir)).at(-1)[0].frames[0].elements[0].x, 0);
    });
});

test("edit_elements validates swapSymbol before applying earlier operations", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { layer: "a/b", frame: 1, element: 0, set: { swapSymbol: "Missing" } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /Library item not found: Missing/);
        assert.equal((await layersLog(tempDir)).at(-1)[0].frames[0].elements[0].x, 0);
    });
});

test("edit_elements refuses swapSymbol on non-instance elements before writes", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_DISTRIBUTE: "1", FAKE_DISTRIBUTE_BAD_ELEMENT: "1" }, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { layer: "a/b", frame: 1, element: 1, set: { swapSymbol: "dir/Hero" } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /Only symbol instances can be edited/);
        assert.equal((await layersLog(tempDir)).at(-1)[0].frames[0].elements[0].x, 10);
    });
});

test("edit_elements uses instance.symbolType for playback validation and readback", async () => {
    const graphicInstance = await callEditElementsWithSymbolType(
        { timeline: 0, ops: [{ layer: "L", frame: 1, element: "hero", set: { loop: "play once", firstFrame: 2 } }] },
        { libraryItemType: "movie clip", symbolType: "graphic" },
    );
    assert.equal(graphicInstance.isError, undefined, text(graphicInstance));
    const graphicReadback = graphicInstance.structuredContent as {
        elements: { loop: string; firstFrame: number; type: string }[];
    };
    assert.equal(graphicReadback.elements[0].type, "movie clip");
    assert.equal(graphicReadback.elements[0].loop, "play once");
    assert.equal(graphicReadback.elements[0].firstFrame, 2);

    const nonGraphicInstance = await callEditElementsWithSymbolType(
        {
            timeline: 0,
            ops: [
                { layer: "L", frame: 1, element: "hero", set: { x: 99 } },
                { layer: "L", frame: 1, element: "hero", set: { loop: "play once" } },
            ],
        },
        { libraryItemType: "graphic", symbolType: "movie clip" },
    );
    assert.equal(nonGraphicInstance.isError, true);
    assert.match(text(nonGraphicInstance), /graphic/i);
    assert.equal(runInContext("__element.x", nonGraphicInstance.context), 0);

    const nonGraphicReadback = await callEditElementsWithSymbolType(
        { timeline: 0, ops: [{ layer: "L", frame: 1, element: "hero", set: { x: 1 } }] },
        { libraryItemType: "graphic", symbolType: "movie clip" },
    );
    const nonGraphicResult = nonGraphicReadback.structuredContent as { elements: Record<string, unknown>[] };
    assert.equal("loop" in nonGraphicResult.elements[0], false);
    assert.equal("firstFrame" in nonGraphicResult.elements[0], false);
});

test("edit_elements derives graphic frame count when frameCount is unavailable", async () => {
    const outOfRange = await callEditElementsWithSymbolType(
        {
            timeline: 0,
            ops: [
                { layer: "L", frame: 1, element: "hero", set: { x: 99 } },
                { layer: "L", frame: 1, element: "hero", set: { firstFrame: 3 } },
            ],
        },
        {
            libraryItemType: "graphic",
            symbolType: "graphic",
            timeline: { layers: [{ frames: [0, 0, 0] }, { frames: [0] }] },
        },
    );
    assert.equal(outOfRange.isError, true);
    assert.match(text(outOfRange), /firstFrame must be less than the graphic frame count \(3\)/);
    assert.equal(runInContext("__element.x", outOfRange.context), 0);

    const validZero = await callEditElementsWithSymbolType(
        { timeline: 0, ops: [{ layer: "L", frame: 1, element: "hero", set: { firstFrame: 0 } }] },
        { libraryItemType: "graphic", symbolType: "graphic", timeline: { layers: [{ frames: [0, 0, 0] }] } },
    );
    assert.equal(validZero.isError, undefined, text(validZero));
    assert.equal((validZero.structuredContent as { elements: { firstFrame: number }[] }).elements[0].firstFrame, 0);

    const addedValidZero = await callEditElementsWithSymbolType(
        {
            timeline: 0,
            ops: [{ op: "add", item: "Hero", layer: "L", frame: 1, x: 10, y: 20, set: { firstFrame: 0 } }],
        },
        { libraryItemType: "graphic", symbolType: "graphic", timeline: { layers: [{ frames: [0, 0, 0] }] } },
    );
    assert.equal(addedValidZero.isError, undefined, text(addedValidZero));
    assert.equal(
        (addedValidZero.structuredContent as { elements: { firstFrame: number }[] }).elements[0].firstFrame,
        0,
    );

    const unavailable = await callEditElementsWithSymbolType(
        {
            timeline: 0,
            ops: [
                { layer: "L", frame: 1, element: "hero", set: { x: 99 } },
                { layer: "L", frame: 1, element: "hero", set: { firstFrame: 0 } },
            ],
        },
        { libraryItemType: "graphic", symbolType: "graphic", timeline: {} },
    );
    assert.equal(unavailable.isError, true);
    assert.match(text(unavailable), /Could not determine graphic frame count/);
    assert.equal(runInContext("__element.x", unavailable.context), 0);

    const emptyTimeline = await callEditElementsWithSymbolType(
        { timeline: 0, ops: [{ layer: "L", frame: 1, element: "hero", set: { firstFrame: 0 } }] },
        { libraryItemType: "graphic", symbolType: "graphic", timeline: { layers: [] } },
    );
    assert.equal(emptyTimeline.isError, true);
    assert.match(text(emptyTimeline), /graphic frame count \(0\)/);
});

test("edit_elements refuses playback changes combined with swapSymbol before swapping", async () => {
    const result = await callEditElementsWithSymbolType(
        {
            timeline: 0,
            ops: [
                { layer: "L", frame: 1, element: "hero", set: { swapSymbol: "SwapTarget" } },
                { layer: "L", frame: 1, element: "hero", set: { loop: "play once" } },
            ],
        },
        { libraryItemType: "movie clip", symbolType: "graphic" },
    );
    assert.equal(result.isError, true);
    assert.match(text(result), /symbolType after swap is unverified/i);
    assert.equal(runInContext("__swapWrites", result.context), 0);
    assert.equal(runInContext("__element.libraryItem.name", result.context), "Hero");
});

test("edit_elements rejects swapSymbol in add.set before earlier writes", { timeout: 30_000 }, async () => {
    await withServer({}, async (client, tempDir) => {
        const result = await client.callTool({
            name: "edit_elements",
            arguments: {
                timeline: 0,
                ops: [
                    { layer: "a/b", frame: 1, element: 0, set: { x: 99 } },
                    { op: "add", item: "dir/Hero", layer: "mustNotBeAdded", frame: 1, set: { swapSymbol: "dir/Hero" } },
                ],
            },
        });
        assert.equal(result.isError, true);
        assert.match(text(result), /swapSymbol.*add/i);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((layer) => layer.name === "a/b").frames[0].elements[0].x, 0);
        assert.equal(
            layers.some((layer) => layer.name === "mustNotBeAdded"),
            false,
        );
    });
});
