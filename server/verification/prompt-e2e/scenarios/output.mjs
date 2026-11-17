import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { CANVAS_ERROR_MARKER, CANVAS_FRAME_SCRIPT, investigationScript, TEST_MOVIE_MARKER } from "./scenarios.mjs";
import { createInvestigationScriptFixture, readInvestigationScript } from "./scripts.mjs";

/** Requires a verified compile-error result and rejects tools outside get_status/publish.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulPublish(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No publish tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "publish"),
        "A tool outside the publish workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "publish" && succeeded),
        "Claude did not successfully receive verified compiler errors from publish",
    );
}

/** Requires a successful test_movie result and rejects tools outside its workflow.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulTestMovie(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No test_movie tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "test_movie"),
        "A tool outside the test_movie workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "test_movie" && succeeded),
        "Claude did not successfully receive the Test Movie result",
    );
}

/** Requires a successful Canvas browser result with the fixture console error and no other tools.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulCanvas(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No Canvas verification tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "verify_canvas_output"),
        "A tool outside the Canvas verification workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "verify_canvas_output" && succeeded),
        "Claude did not successfully receive the fixture console error from verify_canvas_output",
    );
}

/** Requires a syntax diagnosis and a token from Animate's verified compiler diagnostic.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertPublishReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(
        /readmeTotal|\)|括弧|parenthes|rightparen|syntax|構文|文法/i.test(result),
        "Claude final result did not identify the syntax problem",
    );
    assert.ok(
        /1084|rightparen|semicolon|シンタックスエラー|行\s*1|line\s*1/i.test(result),
        "Claude final result omitted the compiler diagnostic",
    );
}

/** Requires the final response to report the startup marker and no compile errors.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertTestMovieReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(result.includes(TEST_MOVIE_MARKER), "Claude final result omitted the startup output marker");
    assert.ok(
        /(?:コンパイル)?エラー(?:(?:は|が)?ありません|(?:は|が)?なし)|(?:no|zero)\s+(?:compil(?:e|ation)\s+)?errors?/i.test(
            result,
        ),
        "Claude final result did not report that there are no compile errors",
    );
}

/** Requires the final response to report console errors and identify the fixture marker.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertCanvasReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(result.includes(CANVAS_ERROR_MARKER), "Claude final result omitted the fixture console-error marker");
    assert.ok(
        /コンソール.{0,20}エラー.{0,20}(?:あり(?!ません)|存在|検出|見つか|発生|出てい)/i.test(result) ||
            /\b(?:console|browser)\b.{0,30}\berrors?\b.{0,30}\b(?:are|were|exist|present|found|detected|reported|occurred|logged)\b/i.test(
                result,
            ) ||
            /\bthere (?:is|are)\s+(?!no\b).{0,30}\b(?:console|browser)\b.{0,20}\berrors?\b/i.test(result),
        "Claude final result did not report that console errors exist",
    );
}

/** Requires a successful frame-12 capture and rejects tools outside the allowed workflow.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulCapture(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No capture tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "capture_frame"),
        "A tool outside the capture workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "capture_frame" && succeeded),
        "Claude did not successfully capture frame 12",
    );
}

/** Validates captured PNG bytes, metadata, and pixels against the frame-12 fixture.
 * @param result Capture result retained by the restricted MCP tool.
 * @param outDir Disposable E2E workspace.
 * @param timelineName Trusted name of the scene timeline, including locale-specific text.
 */
export async function assertCaptureEvidence(result, outDir, timelineName) {
    assert.ok(result?.data && Array.isArray(result.content), "Capture returned no tool evidence");
    const metadata = result.data;
    assert.equal(metadata.frame, 12);
    assert.equal(metadata.timeline, timelineName);
    assert.equal(metadata.width, 550);
    assert.equal(metadata.height, 400);
    const captureDir = resolve(join(outDir, "captures"));
    assert.equal(dirname(resolve(metadata.path)), captureDir, "Capture escaped the disposable capture directory");
    const image = result.content.find((item) => item.type === "image");
    const text = result.content.find((item) => item.type === "text");
    assert.ok(image?.data && image.mimeType === "image/png", "Capture has no PNG image content");
    assert.deepEqual(JSON.parse(text?.text ?? "null"), metadata, "Image metadata does not match tool data");
    const fileBytes = await readFile(metadata.path);
    const returnedBytes = Buffer.from(image.data, "base64");
    assert.deepEqual(returnedBytes, fileBytes, "Returned PNG differs from the saved capture file");
    const png = PNG.sync.read(fileBytes);
    assert.equal(png.width, 550);
    assert.equal(png.height, 400);
    /** Reads one decoded RGBA pixel.
     * @param x Horizontal coordinate.
     * @param y Vertical coordinate.
     * @returns RGBA channel values.
     */
    const pixel = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
    const background = pixel(400, 300);
    for (const [x, y, shape] of [
        [60, 60, "rectangle"],
        [240, 90, "oval"],
    ]) {
        const sample = pixel(x, y);
        assert.notDeepEqual(sample, background, `Frame 12 PNG does not show the fixture ${shape}`);
        assert.ok(sample[0] < 80 && sample[1] < 80 && sample[2] < 80, `Fixture ${shape} is not visibly black`);
    }
    assert.equal(pixel(195, 45)[3], 0, "Frame 12 PNG did not retain the oval's transparent corner");
}

/** Requires a visual description matching the distinct fixture geometry and color.
 * @param result Claude final response.
 */
export function assertCaptureReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    const concepts = {
        squareOrRectangle: /四角|正方形|長方形|rectangle|square/i.test(result),
        circleOrOval: /円|円形|楕円|circle|oval|ellipse/i.test(result),
        black: /黒|black/i.test(result),
    };
    assert.ok(
        Object.values(concepts).every(Boolean),
        `Claude visual description missed fixture concepts: ${JSON.stringify({ ...concepts, replyLength: result.length })}`,
    );
}

/** Checks the fixture's frame-12 geometry from trusted JSFL output.
 * @param report Trusted JSFL fixture report.
 * @returns Locale-specific scene timeline name.
 */
export function assertCaptureFixture(report) {
    assert.equal(typeof report, "string", "Trusted capture fixture verification returned no report");
    const [timelineName, ...fixture] = report.split("\t");
    assert.ok(timelineName, "Capture fixture has no scene timeline name");
    assert.deepEqual(fixture, ["12", "550", "400", "1", "shape", "165", "90", "250", "100"]);
    return timelineName;
}

/** Requires the capture operation to leave the saved fixture unchanged.
 * @param before Trusted pre-capture fixture report.
 * @param after Trusted post-capture fixture report.
 */
export function assertCaptureDocumentUnchanged(before, after) {
    assertCaptureFixture(before);
    assert.equal(after, before, "Capture changed the saved frame-12 fixture");
}

/** Requires Test Movie to leave the saved frame-one fixture script unchanged.
 * @param before Trusted pre-Test-Movie frame-one source.
 * @param after Trusted post-Test-Movie frame-one source.
 */
export function assertTestMovieScriptUnchanged(before, after) {
    assert.equal(typeof before, "string", "Trusted Test Movie verification returned no source");
    assert.match(before, /trace\s*\(\s*['"]README_TEST_MOVIE_OK['"]\s*\)\s*;?/);
    assert.equal(after, before, "Test Movie changed the frame-one script");
}

/** Requires the saved Canvas frame-one console-error fixture to remain unchanged.
 * @param before Trusted original frame-one source.
 * @param after Trusted frame-one source after verification or reopening.
 */
export function assertCanvasFrameScriptUnchanged(before, after) {
    assert.equal(before, CANVAS_FRAME_SCRIPT, "Canvas fixture script does not contain the expected marker");
    assert.equal(after, before, "Canvas verification changed the frame-one script");
}

/** Reads frame-one source from the sole exact saved HTML5 Canvas document.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Frame-one ActionScript source.
 */
export async function readCanvasFrameOneScript(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable Canvas FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (result.isError || typeof source !== "string") {
        throw new Error("Trusted Canvas frame-one script verification failed");
    }
    return source;
}

/** Closes Test Movie Player windows only while the disposable FLA is the sole open document.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function closeTestMoviePlayer(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: "(function () { fl.closeAllPlayerDocuments(); return true; })()",
    });
    if (result.isError || result.structuredContent?.result !== true) {
        throw new Error("Trusted Test Movie Player cleanup failed");
    }
    const after = (await status({})).structuredContent?.documents ?? [];
    if (after.length !== 1 || after[0].path !== pathURI) {
        throw new Error("Test Movie Player cleanup changed the open document scope.");
    }
}

/** Creates an AS3 frame-12 fixture with a black rectangle and oval on a white stage.
 * @param runJsfl Trusted JSFL tool handler.
 * @param pathURI Exact disposable FLA URI.
 */
export async function createCaptureScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.width = 550; doc.height = 400; doc.backgroundColor = "#FFFFFF"; var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "図形"; timeline.insertFrames(11, true, 0); timeline.currentLayer = 0; timeline.currentFrame = 11; var fill = doc.getCustomFill("toolbar"); fill.style = "solid"; fill.color = "#000000"; doc.setCustomFill(fill); doc.addNewRectangle({ left: 40, top: 40, right: 140, bottom: 140 }, 0); doc.addNewOval({ left: 190, top: 40, right: 290, bottom: 140 }, 0); var elements = timeline.layers[0].frames[11].elements || []; if (timeline.frameCount < 12 || elements.length !== 1 || elements[0].elementType !== "shape") throw new Error("Frame-12 drawing fixture failed"); doc.selectNone(); return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the frame-12 capture fixture");
    }
}

/** Reads stage dimensions and exact frame-12 shape geometry using trusted JSFL.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab-delimited fixture report.
 */
export async function readCaptureFixture(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "図形") layer = timeline.layers[i]; if (!layer || timeline.frameCount < 12) throw new Error("Frame-12 fixture missing"); var oldFrame = timeline.currentFrame; try { timeline.currentFrame = 11; var elements = layer.frames[11].elements || []; if (elements.length !== 1) throw new Error("Frame-12 drawing missing"); var values = [String(timeline.name), String(timeline.frameCount), String(doc.width), String(doc.height), String(elements.length)]; for (i = 0; i < elements.length; i++) values.push(elements[i].elementType, String(elements[i].x), String(elements[i].y), String(elements[i].width), String(elements[i].height)); return values.join(String.fromCharCode(9)); } finally { timeline.currentFrame = oldFrame; } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted capture fixture verification failed");
    }
    return result.structuredContent?.result;
}

/** Verifies that Playwright can launch the installed Chrome channel before a paid run.
 * @returns Resolves after closing the temporary headless browser.
 */
export async function assertChromeInstalled() {
    const { chromium } = await import("playwright-core");
    let browser;
    try {
        browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
        throw new Error("Google Chrome is required for the Canvas scenario; install Chrome before running it.");
    } finally {
        await browser?.close();
    }
}

/** Prepares output fixtures owned by publish, Test Movie, Canvas, and capture scenarios.
 * @param scenario Selected scenario name.
 * @param context Fixture setup dependencies.
 * @param state Mutable scenario-specific state.
 */
export async function prepareOutputScenario(scenario, context, state) {
    const { runJsfl, status, pathURI, flaPath, saveDocument } = context;
    if (scenario === "publish") {
        await createInvestigationScriptFixture(runJsfl, pathURI);
        state.investigationBefore = await readInvestigationScript(runJsfl, status, pathURI);
        if (state.investigationBefore !== investigationScript) {
            throw new Error("Malformed AS3 script fixture did not read back exactly");
        }
        const savedFixture = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
        if (savedFixture.isError) {
            throw new Error("Could not save the malformed publish fixture");
        }
    } else if (scenario === "testmovie") {
        state.testMovieBefore = await readInvestigationScript(runJsfl, status, pathURI);
        assertTestMovieScriptUnchanged(state.testMovieBefore, state.testMovieBefore);
    } else if (scenario === "canvas") {
        const fixture = await runJsfl({
            code: `(function () { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); var frame = doc.getTimeline().layers[0].frames[0]; frame.actionScript = ${JSON.stringify(CANVAS_FRAME_SCRIPT)}; return String(frame.actionScript); })()`,
        });
        if (fixture.isError || fixture.structuredContent?.result !== CANVAS_FRAME_SCRIPT) {
            throw new Error("Could not create the Canvas frame-one console-error fixture");
        }
        const savedFixture = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
        if (savedFixture.isError) {
            throw new Error("Could not save the Canvas frame-one console-error fixture");
        }
        state.canvasBefore = await readCanvasFrameOneScript(runJsfl, status, pathURI);
        assertCanvasFrameScriptUnchanged(CANVAS_FRAME_SCRIPT, state.canvasBefore);
    } else if (scenario === "capture") {
        await createCaptureScenarioFixture(runJsfl, pathURI);
        state.captureBefore = await readCaptureFixture(runJsfl, status, pathURI);
        state.captureTimeline = assertCaptureFixture(state.captureBefore);
    }
}

/** Validates an output scenario's tool trace and trusted readback.
 * @param scenario Selected scenario name.
 * @param context Scenario run inputs and Animate handlers.
 */
export async function verifyOutputScenario(scenario, context) {
    const { trace, claudeResult, runJsfl, status, pathURI, state, outDir } = context;
    if (scenario === "publish") {
        assertSuccessfulPublish(trace);
        assertPublishReply(claudeResult);
        if ((await readInvestigationScript(runJsfl, status, pathURI)) !== state.investigationBefore) {
            throw new Error("Publish changed the malformed frame-one script");
        }
    } else if (scenario === "testmovie") {
        assertSuccessfulTestMovie(trace);
        assertTestMovieReply(claudeResult);
        assertTestMovieScriptUnchanged(state.testMovieBefore, await readInvestigationScript(runJsfl, status, pathURI));
    } else if (scenario === "canvas") {
        assertSuccessfulCanvas(trace);
        assertCanvasReply(claudeResult);
        assertCanvasFrameScriptUnchanged(state.canvasBefore, await readCanvasFrameOneScript(runJsfl, status, pathURI));
    } else if (scenario === "capture") {
        assertSuccessfulCapture(trace);
        assertCaptureReply(claudeResult);
        const captureResult = JSON.parse(await readFile(join(outDir, "capture-evidence.json"), "utf8"));
        await assertCaptureEvidence(captureResult, outDir, state.captureTimeline);
        assertCaptureDocumentUnchanged(state.captureBefore, await readCaptureFixture(runJsfl, status, pathURI));
    }
}

/** Verifies an output scenario after save and reopen.
 * @param scenario Selected scenario name.
 * @param context Reopened document dependencies.
 */
export async function verifyOutputPersistence(scenario, context) {
    const { runJsfl, status, pathURI, state, outDir } = context;
    if (scenario === "publish") {
        if ((await readInvestigationScript(runJsfl, status, pathURI)) !== state.investigationBefore) {
            throw new Error("Frame-one script changed after investigation or publish/reopen");
        }
    } else if (scenario === "testmovie") {
        assertTestMovieScriptUnchanged(state.testMovieBefore, await readInvestigationScript(runJsfl, status, pathURI));
    } else if (scenario === "canvas") {
        assertCanvasFrameScriptUnchanged(state.canvasBefore, await readCanvasFrameOneScript(runJsfl, status, pathURI));
    } else if (scenario === "capture") {
        const captureResult = JSON.parse(await readFile(join(outDir, "capture-evidence.json"), "utf8"));
        await assertCaptureEvidence(captureResult, outDir, state.captureTimeline);
        assertCaptureDocumentUnchanged(state.captureBefore, await readCaptureFixture(runJsfl, status, pathURI));
    }
}

/** Returns whether a scenario requires Chrome before running.
 * @param scenario Selected scenario name.
 * @returns True for the Canvas scenario.
 */
export function outputScenarioRequiresChrome(scenario) {
    return scenario === "canvas";
}

/** Returns whether a scenario may open the Test Movie Player.
 * @param scenario Selected scenario name.
 * @returns True for the Test Movie scenario.
 */
export function outputScenarioNeedsPlayerCleanup(scenario) {
    return scenario === "testmovie";
}

/** Returns the completion message for an output scenario.
 * @param scenario Selected scenario name.
 * @returns Completion message.
 */
export function outputScenarioMessage(scenario) {
    if (scenario === "publish") {
        return "PASS: publish returned verified compiler errors for the malformed AS3 fixture; the frame-one script was unchanged after save and reopen.";
    }
    if (scenario === "capture") {
        return "PASS: capture_frame returned the frame-12 fixture PNG; image content matched the saved file and persisted fixture after reopen.";
    }
    if (scenario === "testmovie") {
        return "PASS: test_movie reported the startup marker and no compile errors; the frame-one script was unchanged after save and reopen.";
    }
    if (scenario === "canvas") {
        return "PASS: verify_canvas_output reported the fixture console error; the frame-one script was unchanged after save and reopen.";
    }
    return "";
}
