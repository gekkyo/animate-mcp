import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { ASSET_LIBRARY_NAMES } from "./scenarios.mjs";

/** Requires the final response to list only the unused fixture item.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertLibraryReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.match(result, /(?<![A-Za-z0-9_])unused_mc(?![A-Za-z0-9_])/, "Claude final result omitted the unused item");
    assert.doesNotMatch(
        result,
        /(?<![A-Za-z0-9_])used_mc(?![A-Za-z0-9_])/,
        "Claude final result included the used item",
    );
}

/** Requires a successful listUnused operation and no other library/write operation.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulLibraryListing(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No library tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "edit_library"),
        "A non-library tool was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_library" && succeeded),
        "Claude did not successfully list library items",
    );
}

/** Rejects every import request except the exact disposable PNG/MP3 pair.
 * @param paths Paths supplied to import_assets.
 * @param pinnedPaths Exact fixture paths created by this E2E run.
 * @returns The pinned paths in canonical order.
 */
export function assertPinnedAssetPaths(paths, pinnedPaths) {
    if (
        !Array.isArray(paths) ||
        !Array.isArray(pinnedPaths) ||
        paths.length !== 2 ||
        pinnedPaths.length !== 2 ||
        paths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
        pinnedPaths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
        new Set(paths).size !== paths.length ||
        new Set(pinnedPaths).size !== pinnedPaths.length ||
        paths.some((path) => !pinnedPaths.includes(path))
    ) {
        throw new Error("Safety check failed: import_assets must use exactly the pinned PNG and MP3 fixture paths.");
    }
    return [...pinnedPaths];
}

/** Requires one successful import_assets call and no other document tools.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulAssetsImport(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const imports = entries.filter(({ targetTool }) => targetTool === "import_assets");
    assert.ok(entries.length > 0, "No assets tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "import_assets"),
        "A tool outside the assets import workflow was traced",
    );
    assert.equal(imports.length, 1, "Expected exactly one import_assets call");
    assert.equal(imports[0].succeeded, true, "Claude did not successfully call import_assets");
}

/** Refuses fixture-name collisions before Claude can trigger Animate's import modal.
 * @param report Trusted JSFL state before importing.
 */
export function assertAssetsFixtureAvailable(report) {
    const { libraryNames } = parseAssetsDocumentState(report);
    assert.ok(
        ASSET_LIBRARY_NAMES.every((name) => !libraryNames.includes(name)),
        "Disposable FLA already contains a fixture Library item name",
    );
}

/** Requires exactly the two imported fixture names and an unchanged stage.
 * @param before Trusted JSFL state before importing.
 * @param after Trusted JSFL state after importing or reopening.
 */
export function assertAssetsImported(before, after) {
    const initial = parseAssetsDocumentState(before);
    const current = parseAssetsDocumentState(after);
    assertAssetsFixtureAvailable(before);
    assert.deepEqual(
        current.libraryNames,
        [...initial.libraryNames, ...ASSET_LIBRARY_NAMES].sort(),
        "Imported Library items do not match the two fixtures",
    );
    assert.equal(current.stage, initial.stage, "Import changed the stage");
}

/** Parses a trusted JSFL snapshot of Library names and stage state.
 * @param report JSFL report.
 * @returns Parsed Library names and stage snapshot.
 */
function parseAssetsDocumentState(report) {
    assert.equal(typeof report, "string", "Trusted assets verification returned no report");
    const [metadata, libraryAndStage] = report.split("\n--LIBRARY--\n");
    const [libraryText, stage] = (libraryAndStage ?? "").split("\n--STAGE--\n");
    assert.ok(metadata !== undefined && libraryText !== undefined && stage !== undefined);
    return {
        libraryNames: libraryText ? libraryText.split("\n") : [],
        stage: `${metadata}\n${stage}`,
    };
}

/** Requires the independent fixture readback to contain exactly the expected unused item.
 * @param report Trusted JSFL library/timeline snapshot.
 */
export function assertLibraryFixture(report) {
    assert.equal(typeof report, "string", "Trusted library verification returned no report");
    const [itemCount, instanceCount, names, unused] = report.split("\n");
    assert.ok(names !== undefined && unused !== undefined, "Trusted library verification returned an invalid report");
    assert.deepEqual(names.split("\t"), ["unused_mc", "used_mc"]);
    assert.deepEqual(unused.split("\t"), ["unused_mc"]);
    assert.equal(Number(itemCount), 2);
    assert.equal(Number(instanceCount), 1);
}

/** Requires identical library names/count and timeline instance count before and after listing.
 * @param before Trusted pre-listing JSFL snapshot.
 * @param after Trusted post-listing JSFL snapshot.
 */
export function assertLibraryDocumentUnchanged(before, after) {
    /** Parses a value-free library snapshot.
     * @param report Trusted JSFL snapshot.
     * @returns Parsed library names and counts.
     */
    const parse = (report) => {
        assert.equal(typeof report, "string", "Trusted library verification returned no report");
        const [itemCount, instanceCount, names] = report.split("\n");
        assert.ok(names !== undefined && [itemCount, instanceCount].every((value) => Number.isFinite(Number(value))));
        return { itemCount: Number(itemCount), instanceCount: Number(instanceCount), names: names.split("\t") };
    };
    assert.deepEqual(parse(after), parse(before), "Read-only library listing changed the disposable document");
}

/** Reads Library names and a complete stage snapshot from the disposable FLA.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Delimited Library and stage state.
 */
export async function readAssetsDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) throw new Error("Disposable document not found"); var names = [], items = doc.library.items || []; for (i = 0; i < items.length; i++) names.push(String(items[i].name)); names.sort(); var timeline = doc.getTimeline(), stage = [[String(doc.width), String(doc.height), String(doc.frameRate), String(doc.backgroundColor)].join("\\t")]; for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) { var layer = timeline.layers[layerIndex]; for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) { var frame = layer.frames[frameIndex]; if (!frame || frame.startFrame !== frameIndex) continue; var elements = frame.elements || [], row = [String(layerIndex), String(frameIndex), String(layer.name), String(frame.startFrame), String(frame.duration), String(frame.tweenType || ""), String(elements.length)]; for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) { var element = elements[elementIndex], item = element.libraryItem; row.push(String(element.elementType), item ? String(item.name) : "", String(element.x), String(element.y), String(element.width), String(element.height), String(element.rotation), String(element.scaleX), String(element.scaleY)); } stage.push(row.join(String.fromCharCode(9))); } } return [stage.shift(), "--LIBRARY--", names.join(String.fromCharCode(10)), "--STAGE--", stage.join(String.fromCharCode(10))].join(String.fromCharCode(10)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted assets verification failed");
    }
    return report;
}

/** Creates used_mc and unused_mc movie clips in the exact disposable AS3 document.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable FLA URI.
 */
export async function createLibraryScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; var names = ["used_mc", "unused_mc"]; for (i = 0; i < names.length; i++) { if (doc.library.itemExists(names[i]) || !doc.library.addNewItem("movie clip", names[i])) return "FIXTURE_ERROR:library-item"; doc.library.editItem(names[i]); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); } var timeline = doc.getTimeline(); if (timeline.layers.length !== 1 || !doc.library.addItemToDocument({ x: 50, y: 50 }, "used_mc")) return "FIXTURE_ERROR:stage-instance"; var elements = timeline.layers[0].frames[0].elements || []; if (elements.length !== 1 || elements[0].elementType !== "instance" || elements[0].libraryItem.name !== "used_mc") return "FIXTURE_ERROR:stage-instance"; return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the library listing fixture");
    }
}

/** Independently computes unused library items by scanning all scene and symbol timelines.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab/newline-delimited library and timeline snapshot.
 */
export async function readLibraryDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "READ_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) return "READ_ERROR:document"; var items = doc.library.items, names = [], used = {}, instanceCount = 0; for (i = 0; i < items.length; i++) names.push(items[i].name); names.sort(); function scan(timeline) { for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) { var layer = timeline.layers[layerIndex]; if (layer.layerType === "folder") continue; for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) { var frame = layer.frames[frameIndex]; if (!frame || frame.startFrame !== frameIndex) continue; var elements = frame.elements || []; for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) { var element = elements[elementIndex]; if (element.elementType === "instance" && element.libraryItem) { used[element.libraryItem.name] = true; instanceCount++; } } } } } for (i = 0; i < doc.timelines.length; i++) scan(doc.timelines[i]); for (i = 0; i < items.length; i++) if (items[i].timeline) scan(items[i].timeline); var unused = []; for (i = 0; i < names.length; i++) if (!used[names[i]]) unused.push(names[i]); return [String(names.length), String(instanceCount), names.join(String.fromCharCode(9)), unused.join(String.fromCharCode(9))].join(String.fromCharCode(10)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted library verification failed");
    }
    return report;
}

/** Prepares Library and asset-import fixtures for document scenarios.
 * @param scenario Selected scenario name.
 * @param context Fixture setup dependencies.
 * @param state Mutable scenario-specific state.
 */
export async function prepareDocumentScenario(scenario, context, state) {
    if (scenario === "library") {
        await createLibraryScenarioFixture(context.runJsfl, context.pathURI);
        state.libraryBefore = await readLibraryDocumentState(context.runJsfl, context.status, context.pathURI);
        assertLibraryFixture(state.libraryBefore);
    } else if (scenario === "assets") {
        state.assetsBefore = await readAssetsDocumentState(context.runJsfl, context.status, context.pathURI);
        assertAssetsFixtureAvailable(state.assetsBefore);
    }
}

/** Validates a document scenario's tool trace and trusted readback.
 * @param scenario Selected scenario name.
 * @param context Scenario run inputs and Animate handlers.
 */
export async function verifyDocumentScenario(scenario, context) {
    const { trace, claudeResult, runJsfl, status, pathURI, state } = context;
    if (scenario === "library") {
        assertSuccessfulLibraryListing(trace);
        assertLibraryReply(claudeResult);
        assertLibraryDocumentUnchanged(state.libraryBefore, await readLibraryDocumentState(runJsfl, status, pathURI));
    } else if (scenario === "assets") {
        assertSuccessfulAssetsImport(trace);
    }
}

/** Verifies that asset imports persist after save and reopen.
 * @param scenario Selected scenario name.
 * @param context Reopened document dependencies.
 */
export async function verifyDocumentPersistence(scenario, context) {
    if (scenario === "assets") {
        const { runJsfl, status, pathURI, state } = context;
        assertAssetsImported(state.assetsBefore, await readAssetsDocumentState(runJsfl, status, pathURI));
    }
}

/** Returns whether a document scenario is read-only and skips save/reopen.
 * @param scenario Selected scenario name.
 * @returns True for the Library listing scenario.
 */
export function documentScenarioIsReadOnly(scenario) {
    return scenario === "library";
}

/** Returns the completion message for a document scenario.
 * @param scenario Selected scenario name.
 * @returns Completion message.
 */
export function documentScenarioMessage(scenario) {
    if (scenario === "library") {
        return "PASS: edit_library listed the independently verified unused item; library and timeline state were unchanged.";
    }
    if (scenario === "assets") {
        return "PASS: import_assets imported hero.png and bgm.mp3; Library names persisted and the stage remained unchanged after save and reopen.";
    }
    return "";
}
