// Disposable real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-v021-tools.mjs`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isAnimateRunning } from "../../dist/runtime/animate-launcher.js";
import { registerGetStatus } from "../../dist/tools/document/get-status.js";
import { registerPreflightPublish } from "../../dist/tools/output/preflight-publish.js";
import { registerVisualRegression } from "../../dist/tools/output/visual-regression.js";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerEditTween } from "../../dist/tools/timeline/edit-tween.js";
import { registerInspectTimeline } from "../../dist/tools/timeline/inspect-timeline.js";
import { closeDocumentByPath, toolHandler } from "../lib/smoke-lib.mjs";

assert.equal(await isAnimateRunning(), true, "Animate must already be running; refusing to launch it");
const getStatus = toolHandler(registerGetStatus);
const preflightPublish = toolHandler(registerPreflightPublish);
const visualRegression = toolHandler(registerVisualRegression);
const inspectTimeline = toolHandler(registerInspectTimeline);
const editTween = toolHandler(registerEditTween);
const runJsfl = toolHandler(registerRunJsfl);
const tempDir = await mkdtemp(join(tmpdir(), "animate-mcp-v021-"));
const flaPath = join(tempDir, `${basename(tempDir)}.fla`);
const baselineName = `smoke-${process.pid}-${Date.now()}`;
let savedPath;
let documentName;
let canvasPath;
let failure;
/** Gets the first text content from a tool result.
 * @param result Tool result to inspect.
 * @returns Its first text content, or an empty string.
 */
const text = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts a tool call succeeded and returns its structured content.
 * @param result Tool result to verify.
 * @param label Name used in assertion messages.
 * @returns The result's structured content.
 */
const verify = (result, label) => {
    assert.equal(result.isError, undefined, `${label}: ${text(result)}`);
    assert.ok(result.structuredContent, `${label} returned no structured content`);
    return result.structuredContent;
};
/** Runs JSFL through the registered tool and returns its execution result.
 * @param code JSFL source code.
 * @returns The JSFL execution result.
 */
const run = async (code) => {
    const result = await runJsfl({ code });
    assert.equal(result.isError, undefined, text(result));
    return result.structuredContent.result;
};

try {
    const identity = await run(`(function () {
      var prior = fl.documents.length, doc = null;
      try {
        fl.createDocument("timeline", 550, 400, 24);
        doc = fl.getDocumentDOM();
        if (!doc || fl.documents.length !== prior + 1) throw new Error("Could not create disposable document");
        doc.getTimeline().insertFrames(4, true, 0);
        doc.addNewRectangle({ left: 40, top: 40, right: 120, bottom: 120 }, 0);
        doc.library.addNewItem("movie clip", "V021SmokeSymbol");
        doc.library.editItem("V021SmokeSymbol");
        doc.addNewRectangle({ left: 0, top: 0, right: 50, bottom: 50 }, 0);
        doc.exitEditMode();
        doc.library.addNewItem("graphic", "V021SmokeGraphic");
        doc.library.editItem("V021SmokeGraphic");
        var graphicTimeline = doc.getTimeline();
        graphicTimeline.insertFrames(2, true, 0);
        doc.addNewRectangle({ left: 0, top: 0, right: 40, bottom: 40 }, 0);
        doc.exitEditMode();
        var timeline = doc.getTimeline();
        for (var i = 0; i < 2; i++) {
          var layer = i === 0 ? "classicTween" : "motionTween";
          var index = timeline.addNewLayer(layer, "normal", true);
          timeline.currentLayer = index;
          timeline.currentFrame = 0;
          doc.library.addItemToDocument({ x: 50, y: 50 }, "V021SmokeSymbol");
          timeline.layers[index].frames[0].elements[0].name = i === 0 ? "classicInstance" : "motionInstance";
        }
        var graphicLayer = timeline.addNewLayer("graphicPlayback", "normal", true);
        timeline.currentLayer = graphicLayer;
        timeline.currentFrame = 0;
        doc.library.addItemToDocument({ x: 180, y: 60 }, "V021SmokeGraphic");
        timeline.layers[graphicLayer].frames[0].elements[0].name = "graphicPlaybackInstance";
        timeline.layers[graphicLayer].frames[0].elements[0].loop = "play once";
        timeline.layers[graphicLayer].frames[0].elements[0].firstFrame = 2;
        if (fl.saveDocument(doc, ${JSON.stringify(pathToFileURL(flaPath).href)}) !== true) throw new Error("Could not save disposable AS3 document");
        fl.setActiveWindow(doc);
        return doc.name + "\\t" + doc.pathURI;
      } catch (error) { if (doc) doc.close(false); throw error; }
    })()`);
    const [name, pathURI] = String(identity).split("\t");
    assert.ok(name && pathURI, "No saved document identity returned");
    documentName = name;
    savedPath = pathURI;
    await run(`(function(){var d=fl.getDocumentDOM(); d.getTimeline().currentLayer=0; return true;})()`);
    console.log("PASS setup: created and saved disposable AS3 document in os.tmpdir().");

    const status = verify(await getStatus({}), "get_status");
    assert.ok(Array.isArray(status.documents) && status.documents.some((doc) => doc.name === documentName));
    assert.equal(status.activeDocument?.name, documentName);
    console.log(`PASS get_status: ${status.documents.length} open docs; active=${status.activeDocument.name}.`);

    for (const kind of ["classic", "motion"]) {
        const layer = `${kind}Tween`;
        const symbol = `${kind}Instance`;
        const prep = verify(
            await editTween({
                document: documentName,
                timeline: 0,
                ops: [
                    {
                        op: "createTween",
                        layer,
                        instance: symbol,
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
        assert.equal(prep.failed, null, `${kind} tween setup failed`);
        const before = verify(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 3 }),
            `${kind} default inspect`,
        );
        const alsoDefault = verify(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 3, geometry: false }),
            `${kind} explicit default inspect`,
        );
        assert.deepEqual(alsoDefault, before, "geometry:false changed default output");
        const geometry = verify(
            await inspectTimeline({ document: documentName, timeline: 0, layers: [layer], frame: 3, geometry: true }),
            `${kind} geometry inspect`,
        );
        const element = geometry.layers[0].elements[0];
        assert.equal(element.interpolated, true);
        assert.ok(Number.isFinite(element.x) && Number.isFinite(element.y));
        assert.ok(Number.isFinite(element.scaleX) && Number.isFinite(element.rotation));
        assert.ok(Number.isFinite(element.bounds?.left) && Number.isFinite(element.bounds?.top));
        assert.equal(
            Number(await run("fl.getDocumentDOM().getTimeline().currentFrame")),
            0,
            "inspection did not restore frame",
        );
        console.log(
            `PASS inspect_timeline geometry: ${kind} interior interpolated; geometry present; currentFrame restored.`,
        );
    }

    const graphic = verify(
        await inspectTimeline({
            document: documentName,
            timeline: 0,
            layers: ["graphicPlayback"],
            frame: 3,
            geometry: true,
        }),
        "inspect graphic symbol geometry",
    );
    const graphicInstance = graphic.layers[0].elements[0];
    assert.equal(graphicInstance.loop, "play once");
    assert.equal(graphicInstance.firstFrame, 2);
    assert.equal(graphicInstance.symbolFrameCount, 3);
    assert.equal(
        Number(await run("fl.getDocumentDOM().getTimeline().currentFrame")),
        0,
        "graphic inspection did not restore frame",
    );
    console.log("PASS inspect_timeline graphic: loop/firstFrame/frameCount returned; currentFrame restored.");

    const entriesBefore = (await readdir(tempDir)).sort();
    const preflight = verify(await preflightPublish({ document: documentName }), "preflight saved AS3");
    assert.ok(["pass", "fail", "unchecked"].includes(preflight.checks.saved.status));
    assert.ok(["pass", "fail", "unchecked"].includes(preflight.checks.compilation.status));
    assert.equal(preflight.checks.compilation.status, "unchecked");
    assert.ok(Array.isArray(preflight.checks.outputFiles.warnings));
    assert.deepEqual((await readdir(tempDir)).sort(), entriesBefore, "preflight wrote files beside the FLA");
    console.log(
        `PASS preflight_publish: AS3 ${preflight.checks.saved.status}; compilation unchecked; ${preflight.checks.outputFiles.warnings.length} output warnings; no files written.`,
    );

    const canvasFlaPath = join(tempDir, "v021-canvas.fla");
    const canvasIdentity = await run(`(function(){
      var doc=null;
      try {
        fl.createDocument("htmlcanvas",550,400,24);
        doc=fl.getDocumentDOM();
        if(!doc || doc.type!=="htmlcanvas") throw new Error("Could not create disposable Canvas document");
        if(fl.saveDocument(doc,${JSON.stringify(pathToFileURL(canvasFlaPath).href)})!==true) throw new Error("Could not save disposable Canvas document");
        fl.setActiveWindow(doc);
        return doc.name+"\\t"+doc.pathURI;
      } catch(error) { if(doc) doc.close(false); throw error; }
    })()`);
    const [canvasName, savedCanvasPath] = String(canvasIdentity).split("\t");
    assert.ok(canvasName && savedCanvasPath, "No saved Canvas identity returned");
    canvasPath = savedCanvasPath;
    const canvasProfile = String(
        await run(
            `(function(){var docs=fl.documents; for(var i=0;i<docs.length;i++) if(docs[i].pathURI===${JSON.stringify(canvasPath)}) return docs[i].exportPublishProfileString(); throw new Error("Saved Canvas document not found");})()`,
        ),
    );
    console.log(`Canvas exportPublishProfileString(): ${canvasProfile}`);
    const canvasEntriesBefore = (await readdir(tempDir)).sort();
    const canvasPreflight = verify(await preflightPublish({ document: canvasName }), "preflight saved Canvas");
    assert.equal(canvasPreflight.type, "htmlcanvas");
    assert.equal(canvasPreflight.checks.documentType.status, "pass");
    assert.equal(canvasPreflight.checks.publishFormats.status, "pass");
    assert.deepEqual(canvasPreflight.checks.publishFormats.formats, [
        { name: "SVG Image", enabled: false },
        { name: "JavaScript/HTML", enabled: true },
    ]);
    assert.ok(Array.isArray(canvasPreflight.checks.publishFormats.formats));
    assert.ok(["pass", "unchecked"].includes(canvasPreflight.checks.outputFiles.status));
    assert.ok(Array.isArray(canvasPreflight.checks.outputFiles.candidates));
    assert.ok(Array.isArray(canvasPreflight.checks.outputFiles.warnings));
    assert.equal(canvasPreflight.checks.compilation.status, "unchecked");
    assert.deepEqual(
        (await readdir(tempDir)).sort(),
        canvasEntriesBefore,
        "Canvas preflight wrote files beside the FLA",
    );
    console.log(
        `PASS preflight_publish Canvas: type/status=${canvasPreflight.checks.documentType.status}; formats=${canvasPreflight.checks.publishFormats.status}; outputs=${canvasPreflight.checks.outputFiles.status}; compilation unchecked; no files written.`,
    );

    const unsavedCanvasName = await run(
        `(function(){fl.createDocument("htmlcanvas",550,400,24); var d=fl.getDocumentDOM(); fl.setActiveWindow(d); return d.name;})()`,
    );
    try {
        const unsavedCanvas = verify(
            await preflightPublish({ document: unsavedCanvasName }),
            "preflight unsaved Canvas",
        );
        assert.equal(unsavedCanvas.checks.saved.status, "fail");
        console.log("PASS preflight_publish unsaved Canvas: saved check failed as designed.");
    } finally {
        await run(
            `(function(){var docs=fl.documents; for(var i=0;i<docs.length;i++) if(docs[i].name===${JSON.stringify(unsavedCanvasName)}) {docs[i].close(false); return true;} return true;})()`,
        );
        await run(
            `(function(){var docs=fl.documents; for(var i=0;i<docs.length;i++) if(docs[i].pathURI===${JSON.stringify(savedPath)}) {fl.setActiveWindow(docs[i]); return true;} throw new Error("Saved smoke document not found");})()`,
        );
    }

    const unsavedName = await run(
        `(function(){fl.createDocument("timeline",550,400,24); var d=fl.getDocumentDOM(); fl.setActiveWindow(d); return d.name;})()`,
    );
    try {
        const unsaved = verify(await preflightPublish({ document: unsavedName }), "preflight unsaved AS3");
        assert.equal(unsaved.checks.saved.status, "fail");
        console.log("PASS preflight_publish unsaved document: saved check failed as designed.");
    } finally {
        await run(
            `(function(){var docs=fl.documents; for(var i=0;i<docs.length;i++) if(docs[i].name===${JSON.stringify(unsavedName)}) {docs[i].close(false); return true;} return true;})()`,
        );
        await run(
            `(function(){var docs=fl.documents; for(var i=0;i<docs.length;i++) if(docs[i].pathURI===${JSON.stringify(savedPath)}) {fl.setActiveWindow(docs[i]); return true;} throw new Error("Saved smoke document not found");})()`,
        );
    }

    const baselineRoot = join(
        homedir(),
        ".animate-mcp",
        "baselines",
        `doc-${createHash("sha256").update(pathURI).digest("hex").slice(0, 24)}`,
    );
    const baselinePath = join(baselineRoot, baselineName);
    const saved = verify(
        await visualRegression({ action: "save", name: baselineName, range: { start: 1, end: 2 } }),
        "save visual baseline",
    );
    assert.equal(saved.captures.length, 2);
    const same = verify(
        await visualRegression({ action: "compare", name: baselineName, range: { start: 1, end: 2 } }),
        "compare identical baseline",
    );
    assert.equal(same.passed, true);
    const refused = await visualRegression({ action: "save", name: baselineName, range: { start: 1, end: 2 } });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /already exists/);
    console.log(
        "PASS visual_regression: saved 2-frame baseline; identical compare passed; overwrite refusal enforced.",
    );

    await run(
        `(function(){var d=fl.getDocumentDOM(), t=d.getTimeline(); t.currentLayer=t.addNewLayer("visualChange","normal",true); t.currentFrame=0; d.selectNone(); d.addNewRectangle({left:220,top:40,right:330,bottom:160},0); return true;})()`,
    );
    const changed = verify(
        await visualRegression({ action: "compare", name: baselineName, range: { start: 1, end: 2 } }),
        "compare changed baseline",
    );
    assert.equal(changed.passed, false);
    assert.ok(changed.frames.some((frame) => !frame.passed && frame.diff));
    assert.ok((await stat(changed.frames.find((frame) => frame.diff).diff)).size > 0);
    const overwritten = verify(
        await visualRegression({ action: "save", name: baselineName, range: { start: 1, end: 2 }, overwrite: true }),
        "overwrite visual baseline",
    );
    assert.equal(overwritten.captures.length, 2);
    console.log(
        `PASS visual_regression: modified stage failed compare with diff PNG; overwrite:true replaced baseline at ${baselinePath}.`,
    );
} catch (error) {
    failure = error;
} finally {
    if (canvasPath) {
        try {
            await closeDocumentByPath(runJsfl, canvasPath);
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke and Canvas cleanup failed") : error;
        }
    }
    if (savedPath) {
        try {
            await closeDocumentByPath(runJsfl, savedPath);
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke and document cleanup failed") : error;
        }
    }
    try {
        const baselineRoot = join(homedir(), ".animate-mcp", "baselines");
        for (const dir of await readdir(baselineRoot).catch(() => [])) {
            const candidate = join(baselineRoot, dir, baselineName);
            await rm(candidate, { recursive: true, force: true });
            await rm(join(baselineRoot, dir), { recursive: false }).catch(() => {});
        }
        await rm(join(homedir(), ".animate-mcp", "captures", basename(flaPath, ".fla")), {
            recursive: true,
            force: true,
        });
        await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke and filesystem cleanup failed") : error;
    }
}
if (failure) {
    throw failure;
}
console.log(`v0.2.1 tools smoke passed; disposable FLA ${flaPath} closed and temporary data removed.`);
