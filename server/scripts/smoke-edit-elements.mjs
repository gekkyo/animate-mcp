// Real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-edit-elements.mjs`.
// Creates and closes a disposable document; Animate must be running.
import assert from "node:assert/strict";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { registerEditElements } from "../dist/tools/timeline/edit-elements.js";
import { registerEditTween } from "../dist/tools/timeline/edit-tween.js";
import { registerInspectTimeline } from "../dist/tools/timeline/inspect-timeline.js";
import { toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const editElements = toolHandler(registerEditElements);
const editTween = toolHandler(registerEditTween);
const inspectTimeline = toolHandler(registerInspectTimeline);
/** Extracts the first text result from a tool response.
 * @param result Tool response.
 * @returns Text content or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts a successful tool response and returns its structured payload.
 * @param result Tool response.
 * @param description Operation description for assertion errors.
 * @returns Structured tool response.
 */
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent;
};
/** Asserts that two numeric values are within the smoke test tolerance.
 * @param actual Measured value.
 * @param expected Expected value.
 * @param description Assertion context.
 * @returns Nothing.
 */
const near = (actual, expected, description) =>
    assert.ok(Math.abs(actual - expected) < 0.1, `${description}: ${actual}`);

const setup = await runJsfl({
    code: `var __smokeDoc = null, __canvasDoc = null;
try {
  fl.createDocument("timeline", 550, 400, 24);
  __smokeDoc = fl.getDocumentDOM();
  var __symbol = "EditElementsSmokeSymbol";
  __smokeDoc.library.addNewItem("movie clip", __symbol);
  var __graphic = "EditElementsSmokeGraphic", __graphicTarget = "EditElementsSmokeGraphicTarget";
  /** Creates a three-frame graphic symbol in the supplied document.
   * @param __doc Animate document.
   * @param __name Library name for the symbol.
   */
  function __makeGraphic(__doc, __name) {
    __doc.library.addNewItem("graphic", __name);
    __doc.library.editItem(__name);
    var __graphicTimeline = __doc.getTimeline();
    __graphicTimeline.insertFrames(2, true, 0);
    if (__graphicTimeline.frameCount < 3) throw new Error("Could not create the 3-frame graphic " + __name);
    __doc.exitEditMode();
  }
  __makeGraphic(__smokeDoc, __graphic);
  __makeGraphic(__smokeDoc, __graphicTarget);
  var __timeline = __smokeDoc.getTimeline();
  __timeline.insertFrames(4, true, 0);
  if (__timeline.frameCount < 5) throw new Error("Could not create the 5-frame smoke timeline");
  /** Adds a named Library instance on a new layer of the smoke timeline.
   * @param __layerName Name of the new layer.
   * @param __instanceName Name assigned to the placed instance.
   * @param __item Optional Library item; defaults to the smoke symbol.
   * @returns Index of the created layer.
   */
  function __addInstance(__layerName, __instanceName, __item) {
    var __layerIndex = __timeline.addNewLayer(__layerName, "normal", true);
    __timeline.currentLayer = __layerIndex;
    __timeline.currentFrame = 0;
    __smokeDoc.library.addItemToDocument({ x: 50, y: 50 }, __item || __symbol);
    __timeline.layers[__layerIndex].frames[0].elements[0].name = __instanceName;
    return __layerIndex;
  }
  __addInstance("effects", "staticInstance");
  __addInstance("classic", "classicInstance");
  __addInstance("motion", "motionInstance");
  __addInstance("graphic", "graphicInstance", __graphic);
  var __lockedIndex = __addInstance("locked", "lockedInstance");
  __timeline.layers[__lockedIndex].locked = true;
  __smokeDoc.addNewScene();
  __smokeDoc.editScene(1);
  var __sceneTwoTimeline = __smokeDoc.getTimeline();
  __sceneTwoTimeline.insertFrames(4, true, 0);
  var __sceneTwoLayer = __sceneTwoTimeline.addNewLayer("sceneTwoEffects", "normal", true);
  __sceneTwoTimeline.currentLayer = __sceneTwoLayer;
  __sceneTwoTimeline.currentFrame = 0;
  __smokeDoc.library.addItemToDocument({ x: 50, y: 50 }, __symbol);
  __sceneTwoTimeline.layers[__sceneTwoLayer].frames[0].elements[0].name = "sceneTwoInstance";
  __smokeDoc.editScene(0);

  fl.createDocument("htmlcanvas", 550, 400, 24);
  __canvasDoc = fl.getDocumentDOM();
  var __canvasGraphic = "EditElementsCanvasGraphic", __canvasGraphicTarget = "EditElementsCanvasGraphicTarget";
  __makeGraphic(__canvasDoc, __canvasGraphic);
  __makeGraphic(__canvasDoc, __canvasGraphicTarget);
  var __canvasTimeline = __canvasDoc.getTimeline();
  var __canvasLayer = __canvasTimeline.addNewLayer("graphic", "normal", true);
  __canvasTimeline.currentLayer = __canvasLayer;
  __canvasTimeline.currentFrame = 0;
  __canvasDoc.library.addItemToDocument({ x: 50, y: 50 }, __canvasGraphic);
  __canvasTimeline.layers[__canvasLayer].frames[0].elements[0].name = "graphicInstance";
  fl.setActiveWindow(__smokeDoc);
  __smokeDoc.name + "\\t" + __canvasDoc.name;
} catch (__error) {
  if (__canvasDoc && __canvasDoc !== __smokeDoc) __canvasDoc.close(false);
  if (__smokeDoc) __smokeDoc.close(false);
  throw __error;
}`,
});
if (setup.isError) {
    throw new Error(`Could not prepare Animate smoke document: ${message(setup)}`);
}
const [documentName, canvasDocumentName] = String(setup.structuredContent?.result ?? "").split("\t");
if (!documentName || !canvasDocumentName) {
    throw new Error(`Setup did not return both document names: ${message(setup)}`);
}

let failure;
try {
    const initialTimeline = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, frame: 1 }),
        "inspect prepared timeline",
    );
    console.log("Prepared layers:", initialTimeline.layers.map((layer) => layer.name).join(", "));

    for (const [layer, instance, kind] of [
        ["classic", "classicInstance", "classic"],
        ["motion", "motionInstance", "motion"],
    ]) {
        const tween = verifyTool(
            await editTween({
                document: documentName,
                timeline: 0,
                ops: [
                    {
                        op: "createTween",
                        layer,
                        instance,
                        kind,
                        keyframes: [
                            { frame: 1, x: 50 },
                            { frame: 5, x: 150 },
                        ],
                    },
                ],
            }),
            `create ${kind} tween`,
        );
        assert.equal(tween.failed, null, `${kind} tween setup failed: ${JSON.stringify(tween)}`);
        const before = verifyTool(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 1 }),
            `inspect ${kind} tween`,
        );
        const x = before.layers[0].elements[0].x;
        const rejected = await editElements({
            document: documentName,
            timeline: 0,
            ops: [{ layer, frame: 3, element: instance, set: { x: 999 } }],
        });
        assert.equal(rejected.isError, true, `${kind} tween interior was accepted`);
        assert.match(message(rejected), /tween|keyframe/i);
        const after = verifyTool(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 1 }),
            `verify ${kind} tween unchanged`,
        );
        near(after.layers[0].elements[0].x, x, `${kind} tween start changed after rejection`);
        console.log(`${kind} tween-interior rejection: passed`);
    }

    for (const [layer, kind] of [
        ["classic", "classic"],
        ["motion", "motion"],
    ]) {
        const before = verifyTool(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 1 }),
            `inspect ${kind} tween start`,
        );
        const startRejected = await editElements({
            document: documentName,
            timeline: 0,
            ops: [{ op: "add", item: "EditElementsSmokeSymbol", layer, frame: 1 }],
        });
        assert.equal(startRejected.isError, true, `${kind} tween start was accepted`);
        assert.match(message(startRejected), /tween/i);
        const after = verifyTool(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 1 }),
            `verify ${kind} tween start unchanged`,
        );
        assert.equal(after.layers[0].frameCount, before.layers[0].frameCount);
        assert.equal(after.layers[0].elements.length, before.layers[0].elements.length);
        console.log(`${kind} tween-start rejection: passed`);
    }

    const motionBeforeExtension = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["motion"], frame: 1 }),
        "inspect motion tween before extension rejection",
    );
    const extensionRejected = await editElements({
        document: documentName,
        timeline: 0,
        ops: [{ op: "add", item: "EditElementsSmokeSymbol", layer: "motion", frame: 7 }],
    });
    assert.equal(extensionRejected.isError, true, "extension of a tween span was accepted");
    assert.match(message(extensionRejected), /tween/i);
    const motionAfterExtension = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["motion"], frame: 1 }),
        "verify motion tween unchanged after extension rejection",
    );
    assert.equal(motionAfterExtension.layers[0].frameCount, motionBeforeExtension.layers[0].frameCount);
    console.log("motion tween timeline-extension rejection: passed");

    const locked = verifyTool(
        await editElements({
            document: documentName,
            timeline: 0,
            ops: [{ layer: "locked", frame: 1, element: "lockedInstance", set: { x: 77 } }],
        }),
        "edit locked layer",
    );
    near(locked.elements[0].x, 77, "locked-layer x was not updated");
    const lockedInspect = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["locked"], frame: 1 }),
        "inspect restored locked layer",
    );
    assert.equal(lockedInspect.layers[0].locked, true);
    console.log("locked layer unlock/restore: passed");

    const transformed = verifyTool(
        await editElements({
            document: documentName,
            timeline: 0,
            ops: [
                {
                    layer: "effects",
                    frame: 1,
                    element: "staticInstance",
                    set: { x: 124, y: 86, scaleX: 1.4, scaleY: 0.8, rotation: 35 },
                },
            ],
        }),
        "set position with scale and rotation",
    );
    near(transformed.elements[0].x, 124, "position after scale and rotation");
    near(transformed.elements[0].y, 86, "vertical position after scale and rotation");
    console.log("position with scale and rotation: passed");

    for (const [targetDocument, targetSymbol] of [
        [documentName, "EditElementsSmokeGraphicTarget"],
        [canvasDocumentName, "EditElementsCanvasGraphicTarget"],
    ]) {
        const graphicSet = verifyTool(
            await editElements({
                document: targetDocument,
                timeline: 0,
                ops: [
                    {
                        layer: "graphic",
                        frame: 1,
                        element: "graphicInstance",
                        set: {
                            x: 124,
                            y: 86,
                            scaleX: 1.4,
                            scaleY: 0.8,
                            rotation: 35,
                            loop: "single frame",
                            firstFrame: 2,
                        },
                    },
                ],
            }),
            `${targetDocument}: set graphic playback properties`,
        );
        assert.equal(graphicSet.elements[0].loop, "single frame");
        assert.equal(graphicSet.elements[0].firstFrame, 2);
        const invalidGraphicFrame = await editElements({
            document: targetDocument,
            timeline: 0,
            ops: [{ layer: "graphic", frame: 1, element: "graphicInstance", set: { firstFrame: 3 } }],
        });
        assert.equal(invalidGraphicFrame.isError, true, "out-of-range graphic firstFrame was accepted");
        const swappedGraphic = verifyTool(
            await editElements({
                document: targetDocument,
                timeline: 0,
                ops: [{ layer: "graphic", frame: 1, element: "graphicInstance", set: { swapSymbol: targetSymbol } }],
            }),
            `${targetDocument}: swap graphic symbol`,
        ).elements[0];
        assert.equal(swappedGraphic.libraryItem, targetSymbol);
        assert.equal(swappedGraphic.loop, "single frame");
        assert.equal(swappedGraphic.firstFrame, 2);
        near(swappedGraphic.x, 124, `${targetDocument}: graphic x after swap`);
        near(swappedGraphic.y, 86, `${targetDocument}: graphic y after swap`);
        near(swappedGraphic.scaleX, 1.4, `${targetDocument}: graphic scaleX after swap`);
        near(swappedGraphic.scaleY, 0.8, `${targetDocument}: graphic scaleY after swap`);
        near(swappedGraphic.rotation, 35, `${targetDocument}: graphic rotation after swap`);
        const inspectedGraphic = verifyTool(
            await inspectTimeline({ document: targetDocument, timeline: 0, layers: ["graphic"], frame: 1 }),
            `${targetDocument}: inspect swapped graphic`,
        ).layers[0].elements[0];
        assert.equal(inspectedGraphic.loop, "single frame");
        assert.equal(inspectedGraphic.firstFrame, 2);
        console.log(`${targetDocument}: graphic loop/firstFrame range and symbol swap preservation: passed`);
    }

    const placed = verifyTool(
        await editElements({
            document: documentName,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    item: "EditElementsSmokeSymbol",
                    layer: "static",
                    frame: 7,
                    x: 123,
                    y: 234.05,
                    set: { name: "placedSmoke", scaleX: 1.25 },
                },
                {
                    op: "add",
                    item: "EditElementsSmokeSymbol",
                    layer: "static",
                    frame: 7,
                    x: 321,
                    y: 123,
                    set: { name: "secondPlacedSmoke" },
                },
                {
                    op: "add",
                    item: "EditElementsSmokeSymbol",
                    layer: "static",
                    frame: 7,
                    set: { name: "centerPlacedSmoke" },
                },
            ],
        }),
        "place Library item on a new layer and extended frame",
    );
    assert.deepEqual(
        placed.elements.map((element) => [element.name, element.layer, element.frame]),
        [
            ["placedSmoke", "static_idn", 7],
            ["secondPlacedSmoke", "static_idn", 7],
            ["centerPlacedSmoke", "static_idn", 7],
        ],
    );
    near(placed.elements[0].x, 123, "explicit placement x");
    near(placed.elements[0].y, 234.05, "explicit placement y");
    near(placed.elements[1].x, 321, "second explicit placement x");
    near(placed.elements[1].y, 123, "second explicit placement y");
    const placedInspect = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["static_idn"], frame: 7 }),
        "inspect placed Library item",
    );
    assert.deepEqual(
        placedInspect.layers[0].elements.map((element) => [element.name, element.x, element.y]),
        [
            ["placedSmoke", 123, 234.05],
            ["secondPlacedSmoke", 321, 123],
            ["centerPlacedSmoke", 275, 200],
        ],
    );
    console.log("Library placement, layer creation, and timeline extension: passed");

    const filters = [{ name: "blurFilter", blurX: 8, blurY: 4, quality: "high", enabled: false }];
    verifyTool(
        await editElements({
            document: documentName,
            timeline: 0,
            ops: [{ layer: "effects", frame: 1, element: "staticInstance", set: { filters } }],
        }),
        "replace filters",
    );
    const filterInspect = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["effects"], frame: 1 }),
        "inspect filters",
    );
    assert.deepEqual(filterInspect.layers[0].elements[0].filters, filters);

    const colorModes = [
        [{ mode: "none" }, "none"],
        [{ mode: "alpha", alphaPercent: 57 }, "alpha"],
        [{ mode: "brightness", brightnessPercent: 34 }, "brightness"],
        [{ mode: "tint", tintColor: "#33aaee", tintPercent: 63 }, "tint"],
        [
            {
                mode: "advanced",
                redPercent: 80,
                greenPercent: 70,
                bluePercent: 60,
                redAmount: 10,
                greenAmount: -20,
                blueAmount: 30,
            },
            "advanced",
        ],
    ];
    for (const [colorEffect, mode] of colorModes) {
        verifyTool(
            await editElements({
                document: documentName,
                timeline: 0,
                ops: [{ layer: "effects", frame: 1, element: "staticInstance", set: { colorEffect } }],
            }),
            `set ${mode} color mode`,
        );
        const inspected = verifyTool(
            await inspectTimeline({ document: documentName, timeline: 0, layers: ["effects"], frame: 1 }),
            `inspect ${mode} color mode`,
        );
        const colorEffectReadback = inspected.layers[0].elements[0].colorEffect;
        assert.equal(colorEffectReadback.mode, mode);
        if (mode === "alpha") {
            near(colorEffectReadback.alphaPercent, 57, "alpha percent");
        }
        if (mode === "brightness") {
            near(colorEffectReadback.brightnessPercent, 34, "brightness percent");
        }
        if (mode === "tint") {
            assert.equal(colorEffectReadback.tintColor.toLowerCase(), "#33aaee");
            near(colorEffectReadback.tintPercent, 63, "tint percent");
        }
        if (mode === "advanced") {
            near(colorEffectReadback.redPercent, 80, "advanced red percent");
            near(colorEffectReadback.greenAmount, -20, "advanced green amount");
        }
    }
    console.log("filters and all color modes: passed");

    const sceneTwoColor = verifyTool(
        await editElements({
            document: documentName,
            timeline: 1,
            ops: [
                {
                    layer: "sceneTwoEffects",
                    frame: 1,
                    element: "sceneTwoInstance",
                    set: { colorEffect: { mode: "alpha", alphaPercent: 42 } },
                },
            ],
        }),
        "edit color effect on inactive Scene 2",
    );
    assert.equal(sceneTwoColor.elements[0].colorEffect.mode, "alpha");
    near(sceneTwoColor.elements[0].colorEffect.alphaPercent, 42, "Scene 2 edit result alpha percent");
    const sceneTwoInspect = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 1, layers: ["sceneTwoEffects"], frame: 1 }),
        "inspect inactive Scene 2 color effect",
    );
    near(sceneTwoInspect.layers[0].elements[0].colorEffect.alphaPercent, 42, "Scene 2 alpha percent");
    const activeScene = await runJsfl({
        code: `var __doc = null; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === ${JSON.stringify(documentName)}) __doc = fl.documents[__index]; __doc.currentTimeline;`,
    });
    assert.equal(activeScene.structuredContent?.result, 0, "Scene 1 was not restored after editing Scene 2");
    console.log("inactive Scene 2 color effect and scene restoration: passed");

    const sceneTwoTween = verifyTool(
        await editTween({
            document: documentName,
            timeline: 1,
            ops: [
                {
                    op: "createTween",
                    layer: "sceneTwoEffects",
                    instance: "sceneTwoInstance",
                    kind: "classic",
                    keyframes: [
                        { frame: 1, x: 50 },
                        { frame: 5, x: 150 },
                    ],
                },
            ],
        }),
        "create tween on inactive Scene 2",
    );
    assert.equal(sceneTwoTween.failed, null, `Scene 2 tween setup failed: ${JSON.stringify(sceneTwoTween)}`);
    console.log("inactive Scene 2 tween: passed");

    const beforeInvalid = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["effects"], frame: 1 }),
        "inspect before invalid operation",
    ).layers[0].elements[0].x;
    const invalid = await editElements({
        document: documentName,
        timeline: 0,
        ops: [
            { layer: "effects", frame: 1, element: "staticInstance", set: { x: beforeInvalid + 100 } },
            { layer: "effects", frame: 1, element: "missingInstance", set: { y: 10 } },
        ],
    });
    assert.equal(invalid.isError, true, "invalid second operation was accepted");
    const afterInvalid = verifyTool(
        await inspectTimeline({ document: documentName, timeline: 0, layers: ["effects"], frame: 1 }),
        "inspect after invalid operation",
    ).layers[0].elements[0].x;
    near(afterInvalid, beforeInvalid, "first operation was applied before validation completed");
    console.log("invalid-operation rollback: passed");
} catch (error) {
    failure = error;
} finally {
    try {
        const closed = await runJsfl({
            code: `var __names = [${JSON.stringify(documentName)}, ${JSON.stringify(canvasDocumentName)}];
for (var __nameIndex = 0; __nameIndex < __names.length; __nameIndex++) {
  var __doc = null;
  for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __names[__nameIndex]) __doc = fl.documents[__index];
  if (__doc) __doc.close(false);
}
'closed';`,
        });
        if (closed.isError) {
            const error = new Error(`Could not close the smoke document: ${message(closed)}`);
            failure = failure ? new AggregateError([failure, error], "Smoke test and document cleanup failed") : error;
        } else {
            console.log(`Closed smoke document ${documentName}`);
        }
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke test and document cleanup failed") : error;
    }
}
if (failure) {
    throw failure;
}
