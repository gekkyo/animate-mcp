// Real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-edit-text.mjs`.
// Creates and closes disposable AS3 and HTML5 Canvas documents; Animate must be running.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerEditText } from "../../../dist/tools/timeline/edit-text.js";
import { registerInspectTimeline } from "../../../dist/tools/timeline/inspect-timeline.js";
import {
    closeDocumentByPath,
    createSavedAs3Document,
    createSavedHtmlCanvasDocument,
    toolHandler,
} from "../lib/smoke-lib.mjs";

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

const tempDir = await mkdtemp(join(tmpdir(), "animate-mcp-edit-text-"));
const as3Path = join(tempDir, "edit-text-as3.fla");
const canvasPath = join(tempDir, "edit-text-canvas.fla");
let as3Disposable;
let canvasDisposable;
let as3Document;
let canvasDocument;
let failure;

try {
    as3Disposable = await createSavedAs3Document(runJsfl, pathToFileURL(as3Path).href, "");
    as3Document = as3Disposable.name;
    const as3Setup = await runJsfl({
        code: `(function () { var __docs = fl.documents || [], as3 = null; for (var __index = 0; __index < __docs.length; __index++) if (__docs[__index].pathURI === ${JSON.stringify(as3Disposable.pathURI)}) as3 = __docs[__index]; if (!as3) throw new Error("Disposable AS3 smoke document not found"); var timeline = as3.getTimeline(), layer = timeline.addNewLayer("TextSmokeAS3", "normal", true); timeline.layers[layer].locked = true; return as3.name; })()`,
    });
    if (as3Setup.isError || as3Setup.structuredContent?.result !== as3Document) {
        throw new Error(`Could not prepare AS3 text smoke document: ${message(as3Setup)}`);
    }
    canvasDisposable = await createSavedHtmlCanvasDocument(runJsfl, pathToFileURL(canvasPath).href);
    canvasDocument = canvasDisposable.name;
    const canvasSetup = await runJsfl({
        code: `(function () { var __docs = fl.documents || [], canvas = null, as3 = null; for (var __index = 0; __index < __docs.length; __index++) { if (__docs[__index].pathURI === ${JSON.stringify(canvasDisposable.pathURI)}) canvas = __docs[__index]; if (__docs[__index].pathURI === ${JSON.stringify(as3Disposable.pathURI)}) as3 = __docs[__index]; } if (!canvas || canvas.type !== "htmlcanvas") throw new Error("Disposable Canvas smoke document not found"); var timeline = canvas.getTimeline(), layer = timeline.addNewLayer("TextSmokeCanvas", "normal", true); timeline.layers[layer].locked = true; if (!as3 || as3.name === canvas.name) throw new Error("Animate assigned the disposable documents invalid names"); fl.setActiveWindow(as3); return canvas.name; })()`,
    });
    if (canvasSetup.isError || canvasSetup.structuredContent?.result !== canvasDocument) {
        throw new Error(`Could not prepare Canvas text smoke document: ${message(canvasSetup)}`);
    }

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
    for (const disposable of [canvasDisposable, as3Disposable]) {
        if (!disposable) {
            continue;
        }
        try {
            await closeDocumentByPath(runJsfl, disposable.pathURI);
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke test and cleanup both failed") : error;
        }
    }
    try {
        await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke test and temporary cleanup failed") : error;
    }
}

if (failure) {
    throw failure;
}
console.log(`Text smoke passed (closed disposable documents ${as3Document} and ${canvasDocument}).`);
