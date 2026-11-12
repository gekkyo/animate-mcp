// Real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-edit-elements.mjs`.
// Creates and closes a disposable document; Animate must be running.
import assert from "node:assert/strict";
import { registerEditElements } from "../dist/tools/edit-elements.js";
import { registerEditTween } from "../dist/tools/edit-tween.js";
import { registerInspectTimeline } from "../dist/tools/inspect-timeline.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const editElements = toolHandler(registerEditElements);
const editTween = toolHandler(registerEditTween);
const inspectTimeline = toolHandler(registerInspectTimeline);
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent;
};
const near = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < 0.1, `${description}: ${actual}`);

const setup = await runJsfl({
    code: `var __smokeDoc = null;
try {
  fl.createDocument("timeline", 550, 400, 24);
  __smokeDoc = fl.getDocumentDOM();
  var __symbol = "EditElementsSmokeSymbol";
  __smokeDoc.library.addNewItem("movie clip", __symbol);
  var __timeline = __smokeDoc.getTimeline();
  __timeline.insertFrames(4, true, 0);
  if (__timeline.frameCount < 5) throw new Error("Could not create the 5-frame smoke timeline");
  function __addInstance(__layerName, __instanceName) {
    var __layerIndex = __timeline.addNewLayer(__layerName, "normal", true);
    __timeline.currentLayer = __layerIndex;
    __timeline.currentFrame = 0;
    __smokeDoc.library.addItemToDocument({ x: 50, y: 50 }, __symbol);
    __timeline.layers[__layerIndex].frames[0].elements[0].name = __instanceName;
    return __layerIndex;
  }
  __addInstance("effects", "staticInstance");
  __addInstance("classic", "classicInstance");
  __addInstance("motion", "motionInstance");
  var __lockedIndex = __addInstance("locked", "lockedInstance");
  __timeline.layers[__lockedIndex].locked = true;
  fl.setActiveWindow(__smokeDoc);
  __smokeDoc.name;
} catch (__error) {
  if (__smokeDoc) __smokeDoc.close(false);
  throw __error;
}`,
});
if (setup.isError) throw new Error(`Could not prepare Animate smoke document: ${message(setup)}`);
const documentName = setup.structuredContent?.result;
if (!documentName) throw new Error(`Setup did not return a document name: ${message(setup)}`);

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
                        keyframes: [{ frame: 1, x: 50 }, { frame: 5, x: 150 }],
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
        [{ mode: "advanced", redPercent: 80, greenPercent: 70, bluePercent: 60, redAmount: 10, greenAmount: -20, blueAmount: 30 }, "advanced"],
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
        if (mode === "alpha") near(colorEffectReadback.alphaPercent, 57, "alpha percent");
        if (mode === "brightness") near(colorEffectReadback.brightnessPercent, 34, "brightness percent");
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
} finally {
    const closed = await runJsfl({
        code: `var __name = ${JSON.stringify(documentName)}, __doc = null;
for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __name) __doc = fl.documents[__index];
if (__doc) __doc.close(false);
'closed';`,
    });
    if (closed.isError) throw new Error(`Could not close the smoke document: ${message(closed)}`);
    console.log(`Closed smoke document ${documentName}`);
}
