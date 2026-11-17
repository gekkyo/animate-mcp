import assert from "node:assert/strict";

/** Asserts that the requested layer's span reaches frame 24.
 * @param layers Inspected timeline layers.
 */
export function assertBackground24(layers) {
    const layer = layers.find(({ name }) => name === "背景");
    assert.ok(layer, "Claude did not create the 背景 layer");
    assert.ok(layer.frameCount >= 24, `背景 layer is only ${layer.frameCount} frames long`);
    assert.ok(
        layer.spans.some(({ end }) => end >= 24),
        "背景 layer has no span reaching frame 24",
    );
}

/** Requires a successful timeline edit in the restricted MCP trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_timeline" && succeeded),
        "Claude did not successfully call edit_timeline",
    );
}

/** Asserts stage metadata returned by get_document_info.
 * @param info Document metadata.
 */
export function assertStageProperties(info) {
    assert.equal(info.width, 1280, "Stage width is not 1280");
    assert.equal(info.height, 720, "Stage height is not 720");
    assert.equal(info.frameRate, 30, "Stage frame rate is not 30");
    assert.equal(info.backgroundColor?.toUpperCase(), "#000000", "Stage background is not black");
}

/** Requires a successful set_document_properties call in the restricted MCP trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulStageEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "set_document_properties" && succeeded),
        "Claude did not successfully call set_document_properties",
    );
}

/** Requires at least one applied edit_text operation in the MCP trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulTextEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_text" && succeeded),
        "Claude did not successfully call edit_text",
    );
}

/** Requires an applied edit_tween call with no failed operation in its scoped trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulTweenEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_tween" && succeeded),
        "Claude did not successfully apply edit_tween",
    );
}

/** Requires an applied edit_elements call in the value-free tool trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulInstanceEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_elements" && succeeded),
        "Claude did not successfully call edit_elements",
    );
}

/** Requires the requested movie-clip name and type in the value-free conversion trace.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulSymbolConversion(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "convert_to_symbol" && succeeded),
        "Claude did not successfully convert the element to ball_mc",
    );
}

/** Requires inspect_timeline success and rejects every other traced tool.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulTimelineInspection(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No timeline inspection tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "inspect_timeline"),
        "A non-read-only tool was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "inspect_timeline" && succeeded),
        "Claude did not successfully inspect the timeline",
    );
}

/** Requires the final response to identify hero and mention a tween.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertTimelineInspectionReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.match(result, /hero/, "Claude final result did not identify the instance");
    assert.match(result, /トゥイーン|tween|モーション/i, "Claude final result did not mention a tween");
}

/** Requires the trusted JSFL frame report to contain the exact requested text and style.
 * @param report Delimited report returned by the read-only JSFL check.
 */
export function assertGameOverText(report) {
    assert.equal(typeof report, "string", "Trusted text verification returned no report");
    assert.deepEqual(
        report.split("\t"),
        ["テキスト", "29", "GAME OVER", "48", "true"],
        "Frame 30 on テキスト does not contain the requested text and style",
    );
}

/** Requires the trusted tween readback and Motion_X XML to match backOut.
 * @param report Delimited tween metadata followed by the raw motion XML.
 * @param initialX Recorded starting X position from the fixture.
 */
export function assertTweenReadback(report, initialX) {
    assert.equal(typeof report, "string", "Trusted tween verification returned no report");
    const [metadata, xml] = report.split("\n--MOTION_XML--\n");
    assert.ok(xml, "Trusted tween verification returned no motion XML");
    const [layer, startFrame, duration, tweenType, startName, endName, startX, endX, overshoot, frameRate] =
        metadata.split("\t");
    assert.equal(layer, "BallLayer");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 24);
    assert.equal(tweenType, "motion object");
    assert.equal(startName, "ボール");
    assert.equal(endName, "ボール");
    assert.ok(Math.abs(Number(startX) - initialX) <= 0.01, "Ball did not retain its fixture start position");
    const targetX = initialX + 200;
    assert.ok(Math.abs(Number(endX) - targetX) <= 1, "Ball did not move right by 200px by frame 24");

    const property = xml.match(/<Property\b[^>]*\bid="Motion_X"[^>]*>([\s\S]*?)<\/Property>/);
    assert.ok(property, "Motion XML has no Motion_X channel");
    const keyframes = [...property[1].matchAll(/<Keyframe\b([^>]*)\/>/g)].map(([, attrs]) => attrs);
    assert.ok(keyframes.length >= 2, "Motion_X channel needs start and end keyframes");
    /** Reads one XML attribute from a keyframe.
     * @param attrs XML keyframe attributes.
     * @param name Attribute name.
     * @returns Attribute text.
     */
    const attribute = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
    /** Parses an XML keyframe coordinate pair.
     * @param attrs XML keyframe attributes.
     * @param name Coordinate-pair attribute.
     * @returns Numeric pair, when present.
     */
    const pair = (attrs, name) => attribute(attrs, name)?.split(",").map(Number);
    const next = pair(keyframes[0], "next");
    const previous = pair(keyframes.at(-1), "previous");
    const timeScale = Number(xml.match(/\bTimeScale="([0-9]+)"/)?.[1]);
    const unitsPerFrame = timeScale / Number(frameRate);
    assert.ok(next?.length === 2 && previous?.length === 2 && Number.isFinite(unitsPerFrame));
    const startHasBackOut =
        Math.abs(next[0] - 23 * unitsPerFrame * 0.175) <= 2 && Math.abs(next[1] - 200 * 0.885) <= 0.05;
    const endHasBackOut =
        Math.abs(previous[0] + 23 * unitsPerFrame * 0.68) <= 2 && Math.abs(previous[1] - 200 * 1.275) <= 0.05;
    assert.ok(
        Number(overshoot) > targetX,
        `BackOut tween did not overshoot during frames 15–23 (maxX=${overshoot}, endX=${endX}, Motion_X backOut handles: start=${startHasBackOut}, end=${endHasBackOut}; Claude input args are not recorded)`,
    );
    assert.ok(startHasBackOut && endHasBackOut, "Motion_X Bezier handles do not match the backOut preset");
}

/** Requires the ball instance to retain alpha 50 and the configured blur filter.
 * @param report Delimited instance state from trusted JSFL.
 */
export function assertBallInstance(report) {
    assert.equal(typeof report, "string", "Trusted instance verification returned no report");
    const [
        layer,
        startFrame,
        duration,
        name,
        type,
        colorMode,
        alphaPercent,
        filterCount,
        filterName,
        filterEnabled,
        blurX,
        blurY,
        quality,
    ] = report.split("\t");
    assert.equal(layer, "BallLayer");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 1);
    assert.equal(name, "ボール");
    assert.equal(type, "instance");
    assert.equal(colorMode, "alpha");
    assert.ok(Math.abs(Number(alphaPercent) - 50) <= 0.1, "ボール alpha is not 50%");
    assert.equal(Number(filterCount), 1);
    assert.equal(filterName, "blurFilter");
    assert.equal(filterEnabled, "true");
    assert.equal(Number(blurX), 4);
    assert.equal(Number(blurY), 4);
    assert.equal(quality, "low");
}

/** Requires the loose ball shape to be a movie-clip instance linked to ball_mc.
 * @param report Delimited symbol state from trusted JSFL.
 */
export function assertBallSymbol(report) {
    assert.equal(typeof report, "string", "Trusted symbol verification returned no report");
    const [
        libraryName,
        libraryType,
        layer,
        startFrame,
        duration,
        elementCount,
        elementType,
        instanceLibraryName,
        symbolType,
        looseShapeCount,
    ] = report.split("\t");
    assert.equal(libraryName, "ball_mc");
    assert.equal(libraryType, "movie clip");
    assert.equal(layer, "ボール");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 1);
    assert.equal(Number(elementCount), 1);
    assert.equal(elementType, "instance");
    assert.equal(instanceLibraryName, "ball_mc");
    assert.equal(symbolType, "movie clip");
    assert.equal(Number(looseShapeCount), 0);
}

/** Requires identical timeline state before and after the read-only inspection.
 * @param before Trusted pre-inspection JSFL report.
 * @param after Trusted post-inspection JSFL report.
 */
export function assertInspectDocumentUnchanged(before, after) {
    /** Parses the trusted tab-delimited timeline snapshot.
     * @param report JSFL report.
     * @returns Parsed timeline state.
     */
    const parse = (report) => {
        assert.equal(typeof report, "string", "Trusted inspect verification returned no report");
        const fields = report.split("\t");
        assert.equal(fields.length, 7, "Trusted inspect verification returned an invalid report");
        const [layerCount, frameCount, layer, startFrame, duration, instanceName, xAtFrame12] = fields;
        assert.ok(
            [layerCount, frameCount, startFrame, duration, xAtFrame12].every((value) => Number.isFinite(Number(value))),
        );
        return { layerCount, frameCount, layer, startFrame, duration, instanceName, xAtFrame12 };
    };
    const state = parse(before);
    assert.equal(state.layer, "キャラ");
    assert.equal(Number(state.frameCount), 24);
    assert.equal(Number(state.startFrame), 0);
    assert.equal(Number(state.duration), 24);
    assert.equal(state.instanceName, "hero");
    assert.deepEqual(parse(after), state, "Read-only inspection changed the disposable document");
}

/** Verifies scene-one frame 30 on the exact disposable document via read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function assertTextInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layers = timeline.layers, layer = null, layerIndex = -1; for (i = 0; i < layers.length; i++) if (layers[i].name === "テキスト") { if (layer) throw new Error("Multiple テキスト layers found"); layer = layers[i]; layerIndex = i; } if (!layer) throw new Error("テキスト layer not found"); var frame = layer.frames[29]; if (!frame || frame.startFrame !== 29) throw new Error("Frame 30 keyframe not found"); var matches = [], elements = frame.elements || []; for (i = 0; i < elements.length; i++) if (elements[i].elementType === "text" && elements[i].getTextString() === "GAME OVER") matches.push(elements[i]); if (matches.length !== 1) throw new Error("Expected one GAME OVER text field"); var runs = matches[0].textRuns || [], attrs = runs.length ? runs[0].textAttrs || {} : {}; return [layer.name, String(frame.startFrame), matches[0].getTextString(), String(attrs.size), String(attrs.bold)].join("\\t"); })()`,
    });
    if (result.isError) {
        throw new Error("Trusted text verification failed");
    }
    assertGameOverText(result.structuredContent?.result);
}

/** Adds exactly one one-frame text layer to the exact disposable document.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function createTextScenarioLayer(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layers = timeline.layers; for (i = 0; i < layers.length; i++) if (layers[i].name === "テキスト") throw new Error("テキスト layer already exists"); var index = timeline.addNewLayer("テキスト", "normal", true), layer = timeline.layers[index]; if (!layer || layer.name !== "テキスト" || layer.frames.length !== 1) throw new Error("Text fixture layer must have one frame"); return layer.name + "\\t" + layer.frames.length; })()`,
    });
    if (result.isError || result.structuredContent?.result !== "テキスト\t1") {
        throw new Error("Could not create one-frame text fixture layer");
    }
}

/** Creates an AS3 ball instance held across a pre-extended 24-frame scene.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns The instance's measured initial X position.
 */
export async function createTweenScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.library.addNewItem("movie clip", "ball_src"); doc.library.editItem("ball_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "BallLayer"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "ball_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") throw new Error("Could not place ball instance"); instance.name = "ボール"; var initialX = Number(instance.x); timeline.insertFrames(23, true, 0); var layer = timeline.layers[0]; if (timeline.frameCount !== 24 || layer.frames.length !== 24 || layer.frames[0].startFrame !== 0 || layer.frames[0].duration !== 24) throw new Error("Ball fixture did not extend as a held 24-frame span"); for (i = 0; i < 24; i++) { var elements = layer.frames[i].elements || []; if (layer.frames[i].startFrame !== 0 || elements.length !== 1 || elements[0].name !== "ボール") throw new Error("Ball hold span fixture invariant failed"); } return String(initialX); })()`,
    });
    const initialX = Number(result.structuredContent?.result);
    if (result.isError || !Number.isFinite(initialX)) {
        throw new Error("Could not create the 24-frame ball tween fixture");
    }
    return initialX;
}

/** Creates a 24-frame character motion-tween fixture using only endpoint keys.
 * @param runJsfl JSFL tool handler.
 * @param editTween Trusted setup tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @param documentName Disposable document name for the setup tool.
 */
export async function createInspectScenarioFixture(runJsfl, editTween, pathURI, documentName) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; doc.library.addNewItem("movie clip", "hero_src"); doc.library.editItem("hero_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) return "FIXTURE_ERROR:timeline"; timeline.layers[0].name = "キャラ"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "hero_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") return "FIXTURE_ERROR:instance"; instance.name = "hero"; var initialX = Number(instance.x); timeline.insertFrames(23, true, 0); if (timeline.frameCount !== 24 || timeline.layers[0].frames.length !== 24) return "FIXTURE_ERROR:extend"; return String(initialX); } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    const initialX = Number(result.structuredContent?.result);
    if (result.isError || !Number.isFinite(initialX)) {
        throw new Error("Could not create the 24-frame character inspect fixture");
    }
    const tween = await editTween({
        document: documentName,
        timeline: 0,
        ops: [
            {
                op: "createTween",
                layer: "キャラ",
                instance: "hero",
                kind: "motion",
                keyframes: [
                    { frame: 1, x: initialX },
                    { frame: 24, dx: 120 },
                ],
            },
        ],
    });
    if (tween.isError || tween.structuredContent?.failed !== null || !tween.structuredContent?.applied?.length) {
        throw new Error("Could not create the character motion tween fixture");
    }
}

/** Reads the requested mid-tween state from the exact disposable FLA.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab-delimited trusted document state.
 */
export async function readInspectDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || docs.length !== 1) return "READ_ERROR:document"; var timeline = doc.getTimeline(), layer = null, layerIndex = -1; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "キャラ") { layer = timeline.layers[i]; layerIndex = i; } if (!layer || timeline.frameCount !== 24 || layer.frames.length !== 24) return "READ_ERROR:timeline"; var oldFrame = timeline.currentFrame, oldLayer = timeline.currentLayer, oldSelected = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null; try { timeline.currentLayer = layerIndex; timeline.currentFrame = 11; var span = layer.frames[0], elements = layer.frames[11].elements || []; if (span.startFrame !== 0 || span.duration !== 24 || span.tweenType !== "motion object" || elements.length !== 1) return "READ_ERROR:tween"; return [String(timeline.layers.length), String(timeline.frameCount), layer.name, String(span.startFrame), String(span.duration), elements[0].name || "", String(elements[0].x)].join(String.fromCharCode(9)); } finally { if (oldSelected && timeline.setSelectedFrames) timeline.setSelectedFrames(oldSelected); timeline.currentLayer = oldLayer; timeline.currentFrame = oldFrame; } } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted inspect verification failed");
    }
    return report;
}

/** Reads the exact tween span, interpolated positions, and raw Motion_X XML.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @param initialX Fixture's measured starting X position.
 */
export async function assertTweenInDocument(runJsfl, status, pathURI, initialX) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null, layerIndex = -1; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "BallLayer") { layer = timeline.layers[i]; layerIndex = i; } if (!layer || layer.frames.length !== 24) throw new Error("BallLayer must contain 24 frames"); var span = layer.frames[0], startElements = span.elements || []; if (span.startFrame !== 0 || span.duration !== 24 || span.tweenType !== "motion object" || startElements.length !== 1) throw new Error("Expected a motion tween spanning frames 1–24"); var oldFrame = timeline.currentFrame, oldLayer = timeline.currentLayer, oldSelected = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null, xs = [], endName = ""; try { for (var n = 0; n < 24; n++) { timeline.currentLayer = layerIndex; timeline.currentFrame = n; var elements = layer.frames[n].elements || [], ball = null; for (i = 0; i < elements.length; i++) if (elements[i].name === "ボール") ball = elements[i]; if (!ball) throw new Error("ボール instance missing from frame " + (n + 1)); xs.push(Number(ball.x)); if (n === 23) endName = ball.name; } timeline.currentLayer = layerIndex; timeline.setSelectedFrames(0, 1); var xml = String(span.getMotionObjectXML()); var report = [layer.name, String(span.startFrame), String(span.duration), String(span.tweenType), startElements[0].name, endName, String(xs[0]), String(xs[23]), String(Math.max.apply(Math, xs.slice(14, 23))), String(doc.frameRate)].join("\\t") + "\\n--MOTION_XML--\\n" + xml; return report; } finally { if (oldSelected && timeline.setSelectedFrames) timeline.setSelectedFrames(oldSelected); timeline.currentLayer = oldLayer; timeline.currentFrame = oldFrame; } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted tween verification failed");
    }
    assertTweenReadback(result.structuredContent?.result, initialX);
}

/** Creates a single-frame AS3 fixture with the named ball instance on its own layer.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function createInstanceScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.library.addNewItem("movie clip", "ball_src"); doc.library.editItem("ball_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "BallLayer"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "ball_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") throw new Error("Could not place ball instance"); instance.name = "ボール"; return "READY"; })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the single-frame ball fixture");
    }
}

/** Reads alpha and filter state from the exact disposable FLA using read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function assertInstanceInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "BallLayer") layer = timeline.layers[i]; if (!layer || timeline.frameCount !== 1 || layer.frames.length !== 1) throw new Error("Expected the single-frame BallLayer fixture"); var frame = layer.frames[0], elements = frame.elements || []; if (frame.startFrame !== 0 || frame.duration !== 1 || elements.length !== 1) throw new Error("Expected one ball instance on frame 1"); var instance = elements[0], filters = instance.filters || [], blur = null; for (i = 0; i < filters.length; i++) if (filters[i].name === "blurFilter") blur = filters[i]; return [layer.name, String(frame.startFrame), String(frame.duration), instance.name || "", instance.elementType || "", instance.colorMode || "none", String(instance.colorAlphaPercent), String(filters.length), blur ? blur.name : "", blur ? String(blur.enabled !== false) : "", blur ? String(blur.blurX) : "", blur ? String(blur.blurY) : "", blur ? String(blur.quality) : ""].join(String.fromCharCode(9)); })()`,
    });
    if (result.isError) {
        throw new Error("Trusted instance verification failed");
    }
    assertBallInstance(result.structuredContent?.result);
}

/** Creates a single-frame fixture with one raw oval on layer ボール.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function createSymbolScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) return "FIXTURE_ERROR:timeline"; timeline.layers[0].name = "ボール"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.addNewOval({ left: 100, top: 100, right: 160, bottom: 160 }, 0); var elements = timeline.layers[0].frames[0].elements || []; if (elements.length !== 1 || elements[0].elementType !== "shape") return "FIXTURE_ERROR:raw-oval"; return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the single-frame raw-oval symbol fixture");
    }
}

/** Reads the converted library item and stage instance from the exact disposable FLA.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function assertSymbolInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "READ_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) return "READ_ERROR:document"; var item = null; for (i = 0; i < doc.library.items.length; i++) if (doc.library.items[i].name === "ball_mc") item = doc.library.items[i]; var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "ボール") layer = timeline.layers[i]; if (!layer || !layer.frames[0]) return "READ_ERROR:layer"; var frame = layer.frames[0], elements = frame.elements || [], instance = elements.length === 1 ? elements[0] : null, looseShapes = 0; for (i = 0; i < timeline.layers.length; i++) { var targetFrame = timeline.layers[i].frames[0], stageElements = targetFrame && targetFrame.elements || []; for (var j = 0; j < stageElements.length; j++) if (stageElements[j].elementType === "shape") looseShapes++; } return [item ? item.name : "", item ? item.itemType : "", layer.name, String(frame.startFrame), String(frame.duration), String(elements.length), instance ? instance.elementType : "", instance && instance.libraryItem ? instance.libraryItem.name : "", instance ? instance.symbolType : "", String(looseShapes)].join(String.fromCharCode(9)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted symbol verification failed");
    }
    const report = result.structuredContent?.result;
    if (typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted symbol verification failed");
    }
    assertBallSymbol(report);
}

/** Prepares the disposable fixtures owned by a timeline scenario.
 * @param scenario Selected scenario name.
 * @param context Fixture setup dependencies.
 * @param state Mutable scenario-specific state.
 */
export async function prepareTimelineScenario(scenario, context, state) {
    if (scenario === "text") {
        await createTextScenarioLayer(context.runJsfl, context.pathURI);
    } else if (scenario === "tween") {
        state.tweenInitialX = await createTweenScenarioFixture(context.runJsfl, context.pathURI);
    } else if (scenario === "instance") {
        await createInstanceScenarioFixture(context.runJsfl, context.pathURI);
    } else if (scenario === "symbol") {
        await createSymbolScenarioFixture(context.runJsfl, context.pathURI);
    } else if (scenario === "inspect") {
        const document = (await context.status({})).structuredContent?.documents?.[0];
        if (!document || document.path !== context.pathURI) {
            throw new Error("Safety check failed: the inspect fixture document is not open.");
        }
        await createInspectScenarioFixture(context.runJsfl, context.editTween, context.pathURI, document.name);
        state.inspectBefore = await readInspectDocumentState(context.runJsfl, context.status, context.pathURI);
    }
}

/** Validates a timeline scenario's tool trace and trusted readback.
 * @param scenario Selected scenario name.
 * @param context Scenario run inputs and Animate handlers.
 */
export async function verifyTimelineScenario(scenario, context) {
    const { trace, claudeResult, runJsfl, status, pathURI, state, inspectTimeline, getDocumentInfo } = context;
    if (scenario === "stage") {
        assertSuccessfulStageEdit(trace);
        const documents = (await status({})).structuredContent?.documents ?? [];
        if (documents.length !== 1 || documents[0].path !== pathURI) {
            throw new Error("Safety check failed: the disposable FLA is not the only open document.");
        }
        assertStageProperties((await getDocumentInfo({})).structuredContent);
    } else if (scenario === "text") {
        assertSuccessfulTextEdit(trace);
        await assertTextInDocument(runJsfl, status, pathURI);
    } else if (scenario === "tween") {
        assertSuccessfulTweenEdit(trace);
        await assertTweenInDocument(runJsfl, status, pathURI, state.tweenInitialX);
    } else if (scenario === "instance") {
        assertSuccessfulInstanceEdit(trace);
        await assertInstanceInDocument(runJsfl, status, pathURI);
    } else if (scenario === "symbol") {
        assertSuccessfulSymbolConversion(trace);
        await assertSymbolInDocument(runJsfl, status, pathURI);
    } else if (scenario === "inspect") {
        assertSuccessfulTimelineInspection(trace);
        assertTimelineInspectionReply(claudeResult);
        assertInspectDocumentUnchanged(state.inspectBefore, await readInspectDocumentState(runJsfl, status, pathURI));
    } else {
        assertSuccessfulEdit(trace);
        if (scenario === "layer") {
            const documents = (await status({})).structuredContent?.documents ?? [];
            if (documents.length !== 1 || documents[0].path !== pathURI) {
                throw new Error("Safety check failed: the disposable FLA is not the only open document.");
            }
            const result = await inspectTimeline({ document: documents[0].name, timeline: 0, frame: 24 });
            if (result.isError) {
                throw new Error("Timeline inspection failed");
            }
            assertBackground24(result.structuredContent?.layers ?? []);
        }
    }
}

/** Verifies the timeline scenario after save and reopen.
 * @param scenario Selected scenario name.
 * @param context Reopened document dependencies.
 */
export async function verifyTimelinePersistence(scenario, context) {
    const { runJsfl, status, pathURI, state, inspectTimeline, getDocumentInfo } = context;
    if (scenario === "stage") {
        const documents = (await status({})).structuredContent?.documents ?? [];
        if (documents.length !== 1 || documents[0].path !== pathURI) {
            throw new Error("Safety check failed: the disposable FLA is not the only open document.");
        }
        assertStageProperties((await getDocumentInfo({})).structuredContent);
    } else if (scenario === "text") {
        await assertTextInDocument(runJsfl, status, pathURI);
    } else if (scenario === "tween") {
        await assertTweenInDocument(runJsfl, status, pathURI, state.tweenInitialX);
    } else if (scenario === "instance") {
        await assertInstanceInDocument(runJsfl, status, pathURI);
    } else if (scenario === "symbol") {
        await assertSymbolInDocument(runJsfl, status, pathURI);
    } else if (scenario === "inspect") {
        assertInspectDocumentUnchanged(state.inspectBefore, await readInspectDocumentState(runJsfl, status, pathURI));
    } else {
        const documents = (await status({})).structuredContent?.documents ?? [];
        if (documents.length !== 1 || documents[0].path !== pathURI) {
            throw new Error("Safety check failed: the disposable FLA is not the only open document.");
        }
        const result = await inspectTimeline({ document: documents[0].name, timeline: 0, frame: 24 });
        if (result.isError) {
            throw new Error("Timeline inspection failed");
        }
        assertBackground24(result.structuredContent?.layers ?? []);
    }
}

/** Returns whether a timeline scenario is read-only and skips save/reopen.
 * @param scenario Selected scenario name.
 * @returns True for the inspect scenario.
 */
export function timelineScenarioIsReadOnly(scenario) {
    return scenario === "inspect";
}

/** Returns the completion message for a timeline scenario.
 * @param scenario Selected scenario name.
 * @returns Completion message.
 */
export function timelineScenarioMessage(scenario) {
    if (scenario === "stage") {
        return "PASS: set_document_properties succeeded; stage properties persisted after save and reopen.";
    }
    if (scenario === "text") {
        return "PASS: edit_text added GAME OVER at 48pt bold on テキスト frame 30; text persisted after save and reopen.";
    }
    if (scenario === "tween") {
        return "PASS: edit_tween created a 24-frame backOut motion tween; motion and easing persisted after save and reopen.";
    }
    if (scenario === "instance") {
        return "PASS: edit_elements set ボール alpha to 50% and added a blur filter; both persisted after save and reopen.";
    }
    if (scenario === "symbol") {
        return "PASS: convert_to_symbol created ball_mc as a movie clip; the converted instance persisted after save and reopen.";
    }
    if (scenario === "inspect") {
        return "PASS: inspect_timeline reported hero and its tween; timeline state was unchanged (dirty flag check skipped).";
    }
    return "PASS: edit_timeline succeeded; 背景 spans through frame 24 after save and reopen.";
}
