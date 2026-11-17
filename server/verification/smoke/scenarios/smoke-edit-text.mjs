// Real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-edit-text.mjs`.
// Creates and closes disposable AS3 and HTML5 Canvas documents; Animate must be running.
import assert from "node:assert/strict";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerEditText } from "../../dist/tools/timeline/edit-text.js";
import { registerInspectTimeline } from "../../dist/tools/timeline/inspect-timeline.js";
import { toolHandler } from "../lib/smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const editText = toolHandler(registerEditText);
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
/** Asserts that a tool response is a refusal matching the expected message.
 * @param result Tool response.
 * @param description Operation description for assertion errors.
 * @param expectedMessage Expected error-message pattern.
 */
const expectRefusal = (result, description, expectedMessage) => {
    assert.equal(result.isError, true, `${description} was not refused`);
    assert.match(message(result), expectedMessage, `${description} returned an unexpected error`);
};

const setup = await runJsfl({
    code: `(function () {
  var created = [], names = [];
  try {
    fl.createDocument("timeline", 550, 400, 24);
    var as3 = fl.getDocumentDOM();
    created.push(as3);
    if (!as3 || as3.type !== "Flash" || String(as3.asVersion).indexOf("3") < 0) throw new Error("Could not create an AS3 smoke document");
    var as3Timeline = as3.getTimeline(), as3Layer = as3Timeline.addNewLayer("TextSmokeAS3", "normal", true);
    as3Timeline.layers[as3Layer].locked = true;
    names.push(as3.name);

    fl.createDocument("htmlcanvas", 550, 400, 24);
    var canvas = fl.getDocumentDOM();
    created.push(canvas);
    if (!canvas || canvas.type !== "htmlcanvas") throw new Error("Could not create an HTML5 Canvas smoke document");
    var canvasTimeline = canvas.getTimeline(), canvasLayer = canvasTimeline.addNewLayer("TextSmokeCanvas", "normal", true);
    canvasTimeline.layers[canvasLayer].locked = true;
    names.push(canvas.name);
    if (names[0] === names[1]) throw new Error("Animate assigned the disposable documents the same name");
    fl.setActiveWindow(as3);
    return names.join("\\t");
  } catch (error) {
    for (var index = 0; index < created.length; index++) if (created[index]) created[index].close(false);
    throw error;
  }
})()`,
});
if (setup.isError) {
    throw new Error(`Could not prepare text smoke documents: ${message(setup)}`);
}
const names = String(setup.structuredContent?.result ?? "").split("\t");
if (names.length !== 2 || names.some((name) => !name)) {
    throw new Error(`Setup returned invalid document names: ${message(setup)}`);
}
const [as3Document, canvasDocument] = names;
let failure;

try {
    const as3Added = verifyTool(
        await editText({
            document: as3Document,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "TextSmokeAS3",
                    frame: 1,
                    rectangle: { left: 30, top: 40, right: 250, bottom: 100 },
                    text: "AS3 dynamic text",
                    style: {
                        face: "Arial",
                        size: 24,
                        fillColor: "#123456",
                        bold: true,
                        alignment: "center",
                        textType: "dynamic",
                        lineType: "single line",
                    },
                },
            ],
        }),
        "add styled AS3 dynamic text",
    );
    assert.equal(as3Added.elements[0].text, "AS3 dynamic text");
    assert.equal(as3Added.elements[0].style.lineType, "single line");
    const as3Static = verifyTool(
        await editText({
            document: as3Document,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "TextSmokeAS3",
                    frame: 1,
                    rectangle: { left: 30, top: 110, right: 250, bottom: 160 },
                    text: "AS3 static text",
                    style: { textType: "static" },
                },
            ],
        }),
        "add AS3 static text",
    );
    assert.equal(as3Static.elements[0].style.lineType, null);
    expectRefusal(
        await editText({
            document: as3Document,
            timeline: 0,
            ops: [{ op: "set", layer: "TextSmokeAS3", frame: 1, element: 1, style: { lineType: "single line" } }],
        }),
        "refuse AS3 static lineType before writing",
        /lineType can only be set on dynamic or input text/,
    );
    const as3Set = verifyTool(
        await editText({
            document: as3Document,
            timeline: 0,
            ops: [
                {
                    op: "set",
                    layer: "TextSmokeAS3",
                    frame: 1,
                    element: 0,
                    text: "Updated AS3",
                    style: { size: 28, italic: true, lineType: "multiline no wrap" },
                },
            ],
        }),
        "set AS3 text",
    );
    assert.equal(as3Set.elements[0].text, "Updated AS3");
    assert.equal(as3Set.elements[0].style.italic, true);
    assert.equal(as3Set.elements[0].style.lineType, "multiline no wrap");
    const as3Inspect = verifyTool(
        await inspectTimeline({ document: as3Document, timeline: 0, layers: ["TextSmokeAS3"], frame: 1 }),
        "inspect AS3 text",
    );
    assert.equal(as3Inspect.layers[0].locked, true, "AS3 text tool did not restore the layer lock");
    assert.equal(as3Inspect.layers[0].elements[0].text, "Updated AS3");
    assert.equal(
        as3Inspect.layers[0].elements[1].style.lineType,
        null,
        "static text lineType was not safely reported as null",
    );
    console.log("PASS AS3 dynamic lineType add/set, static lineType refusal/read-back, and locked-layer restoration.");

    const canvasActivation = await runJsfl({
        code: `(function () { var docs = fl.documents || [], doc = null; for (var i = 0; i < docs.length; i++) if (docs[i].name === ${JSON.stringify(canvasDocument)}) doc = docs[i]; if (!doc || doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); fl.setActiveWindow(doc); return doc.name; })()`,
    });
    assert.equal(
        canvasActivation.structuredContent?.result,
        canvasDocument,
        `Could not activate Canvas document: ${message(canvasActivation)}`,
    );

    const canvasAdded = verifyTool(
        await editText({
            document: canvasDocument,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "TextSmokeCanvas",
                    frame: 1,
                    rectangle: { left: 30, top: 40, right: 250, bottom: 100 },
                    text: "Canvas text",
                    style: {
                        face: "Arial",
                        size: 20,
                        fillColor: "#654321",
                        textType: "dynamic",
                        lineType: "multiline",
                    },
                },
            ],
        }),
        "add Canvas text",
    );
    assert.equal(canvasAdded.elements[0].text, "Canvas text");
    expectRefusal(
        await editText({
            document: canvasDocument,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "TextSmokeCanvas",
                    frame: 1,
                    rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                    text: "unsupported input",
                    style: { textType: "input" },
                },
            ],
        }),
        "refuse Canvas input text",
        /Canvas does not support textType: input/,
    );
    expectRefusal(
        await editText({
            document: canvasDocument,
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "TextSmokeCanvas",
                    frame: 1,
                    rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                    text: "unsupported line type",
                    style: { textType: "dynamic", lineType: "single line" },
                },
            ],
        }),
        "refuse Canvas single-line text",
        /Canvas does not support lineType: single line/,
    );
    const canvasInspect = verifyTool(
        await inspectTimeline({ document: canvasDocument, timeline: 0, layers: ["TextSmokeCanvas"], frame: 1 }),
        "inspect Canvas text after refusals",
    );
    assert.equal(canvasInspect.layers[0].locked, true, "Canvas text tool did not restore the layer lock");
    assert.equal(canvasInspect.layers[0].elements.length, 1, "a refused Canvas edit changed the timeline");
    assert.equal(canvasInspect.layers[0].elements[0].text, "Canvas text");
    console.log("PASS Canvas add/read-back and input/single-line refusal before writing.");
} catch (error) {
    failure = error;
} finally {
    const cleanup = await runJsfl({
        code: `(function () { var names = ${JSON.stringify(names)}, docs = fl.documents || [], matches = []; for (var i = 0; i < names.length; i++) { var found = []; for (var j = 0; j < docs.length; j++) if (docs[j].name === names[i]) found.push(docs[j]); if (found.length !== 1) throw new Error("Expected exactly one disposable document named " + names[i] + "; found " + found.length); matches.push(found[0]); } for (i = 0; i < matches.length; i++) matches[i].close(false); return matches.length; })()`,
    });
    if (cleanup.isError || cleanup.structuredContent?.result !== 2) {
        const cleanupError = new Error(`Could not close disposable text smoke documents: ${message(cleanup)}`);
        failure = failure
            ? new AggregateError([failure, cleanupError], "Smoke test and cleanup both failed")
            : cleanupError;
    }
}

if (failure) {
    throw failure;
}
console.log(`Text smoke passed (closed disposable documents ${as3Document} and ${canvasDocument}).`);
