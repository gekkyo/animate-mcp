// Disposable real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-canvas.mjs`.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerApplyScripts } from "../dist/tools/apply-scripts.js";
import { registerCaptureFrame } from "../dist/tools/capture-frame.js";
import { registerCloseDocument } from "../dist/tools/close-document.js";
import { registerConvertToSymbol } from "../dist/tools/convert-to-symbol.js";
import { registerEditElements } from "../dist/tools/edit-elements.js";
import { registerEditLibrary } from "../dist/tools/edit-library.js";
import { registerEditTimeline } from "../dist/tools/edit-timeline.js";
import { registerEditTween } from "../dist/tools/edit-tween.js";
import { registerExportScripts } from "../dist/tools/export-scripts.js";
import { registerGetDocumentInfo } from "../dist/tools/get-document-info.js";
import { registerInspectTimeline } from "../dist/tools/inspect-timeline.js";
import { registerInstallGreensock } from "../dist/tools/install-greensock.js";
import { registerOpenDocument } from "../dist/tools/open-document.js";
import { registerPublish } from "../dist/tools/publish.js";
import { registerReadOutput } from "../dist/tools/read-output.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { registerSaveDocument } from "../dist/tools/save-document.js";
import { registerTestMovie } from "../dist/tools/test-movie.js";
import { closeDocumentByPath, toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const openDocument = toolHandler(registerOpenDocument);
const saveDocument = toolHandler(registerSaveDocument);
const closeDocument = toolHandler(registerCloseDocument);
const getDocumentInfo = toolHandler(registerGetDocumentInfo);
const editTimeline = toolHandler(registerEditTimeline);
const editElements = toolHandler(registerEditElements);
const convertToSymbol = toolHandler(registerConvertToSymbol);
const editLibrary = toolHandler(registerEditLibrary);
const editTween = toolHandler(registerEditTween);
const inspectTimeline = toolHandler(registerInspectTimeline);
const exportScripts = toolHandler(registerExportScripts);
const applyScripts = toolHandler(registerApplyScripts);
const captureFrame = toolHandler(registerCaptureFrame);
const publish = toolHandler(registerPublish);
const readOutput = toolHandler(registerReadOutput);
const testMovie = toolHandler(registerTestMovie);
const installGreensock = toolHandler(registerInstallGreensock);

const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
const expectRefusal = (result, description, expectedMessage) => {
    assert.equal(result.isError, true, `${description} was not refused`);
    const text = message(result);
    assert.match(text, expectedMessage, `${description} returned an unexpected error`);
    console.log(`PASS ${description}: ${text}`);
    return text;
};
const expectLibraryRefusal = (result, description) => {
    let text;
    if (result.isError) {
        text = message(result);
    } else {
        const failure = result.structuredContent?.failed;
        assert.ok(failure, `${description} was not refused`);
        text = failure.error;
    }
    assert.equal(text, "AS3 linkage is supported only for Flash/AS3 documents", `${description} returned an unexpected error`);
    console.log(`PASS ${description}: ${text}`);
    return text;
};
const runValue = async (code, description) => {
    const result = await runJsfl({ code });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent?.result;
};
const documentRows = async (description) => {
    const result = await runValue(
        `var __smokeDocuments = fl.documents || []; var __smokeRows = []; for (var __i = 0; __i < __smokeDocuments.length; __i++) __smokeRows.push(__smokeDocuments[__i].name + "\\t" + (__smokeDocuments[__i].pathURI || "")); __smokeRows.join("\\n");`,
        description,
    );
    assert.equal(typeof result, "string", `${description} returned invalid document details`);
    return result ? result.split("\n").sort() : [];
};
const withoutRows = (rows, expected) => {
    const remaining = [...rows];
    for (const row of expected) {
        const index = remaining.indexOf(row);
        assert.notEqual(index, -1, `An existing document disappeared: ${row}`);
        remaining.splice(index, 1);
    }
    return remaining.sort();
};
const findFiles = async (directory) => {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await findFiles(path)));
        else if (entry.isFile()) files.push(path);
    }
    return files;
};
const inspect = async (document, layer, frame) =>
    verifyTool(
        await inspectTimeline({ timeline: 0, document, layers: [layer], frame }),
        `inspect ${layer} frame ${frame}`,
    ).layers[0];

const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-canvas-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
const flaUri = pathToFileURL(flaPath).href;
const exportDir = join(outDir, "export");
const captureDir = join(outDir, "captures");
const documentNameForCleanup = { value: "" };
let initialDocuments;
let savedPath = "";
let failure;
let finalCount = "unknown";
let tweenApplied = false;

try {
    initialDocuments = await documentRows("read initial document list");
    assert.ok(initialDocuments.length > 0, "Animate must already have the user's documents open; refusing to run in an empty session");
    console.log(`Initial documents (${initialDocuments.length}): ${initialDocuments.join(" | ")}`);

    const created = verifyTool(await openDocument({ type: "htmlcanvas" }), "create disposable HTML5 Canvas document");
    assert.equal(created.path, null, "new Canvas document unexpectedly has a saved path");
    assert.ok(created.name, "open_document returned no document name");
    assert.ok(!initialDocuments.some((row) => row.startsWith(`${created.name}\t`)), "new document name conflicts with an existing open document");
    documentNameForCleanup.value = created.name;
    assert.deepEqual(withoutRows(await documentRows("verify created Canvas document"), initialDocuments), [`${created.name}\t`]);

    const saved = verifyTool(await saveDocument({ document: created.name, path: flaPath }), "save disposable Canvas FLA");
    savedPath = saved.path;
    assert.ok(savedPath, "save_document returned no path");
    const savedFile = await stat(flaPath);
    assert.ok(savedFile.isFile() && savedFile.size > 0, "saved disposable Canvas FLA is empty");
    const documentName = await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one saved Canvas document"); return __matches[0].name; })()`,
        "read saved Canvas document name",
    );
    assert.equal(typeof documentName, "string");
    documentNameForCleanup.value = documentName;
    console.log(`PASS open_document -> save_document: ${documentName}; Animate path ${savedPath} (input ${flaUri}).`);

    await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one saved Canvas document"); fl.setActiveWindow(__matches[0]); return __matches[0].type; })()`,
        "activate Canvas document before get_document_info",
    );
    const info = verifyTool(await getDocumentInfo(), "get_document_info for Canvas");
    assert.equal(info.asVersion, null, "Canvas document should report asVersion null");
    const initialType = await runValue(
        `(function () { var __doc = fl.getDocumentDOM(); if (!__doc || __doc.pathURI !== ${JSON.stringify(savedPath)}) throw new Error("The disposable Canvas document is not active"); return String(__doc.type); })()`,
        "verify Canvas document type",
    );
    assert.equal(initialType, "htmlcanvas", "get_document_info target is not HTML5 Canvas");
    console.log(`PASS get_document_info/type: type=${initialType}, asVersion=${info.asVersion}.`);

    const tweenLayerName = "CanvasSmokeTween";
    const actionsLayerName = "CanvasSmokeActions";
    const layerEdit = verifyTool(
        await editTimeline({
            timeline: 0,
            document: documentName,
            ops: [
                { op: "addLayer", name: tweenLayerName },
                { op: "addLayer", name: actionsLayerName },
            ],
        }),
        "edit_timeline add Canvas layers",
    );
    assert.equal(layerEdit.failed, null, `edit_timeline addLayer failed: ${JSON.stringify(layerEdit.failed)}`);
    const initialLayers = verifyTool(
        await inspectTimeline({ timeline: 0, document: documentName, frame: 1 }),
        "inspect initial Canvas layers",
    ).layers;
    assert.ok(initialLayers.some((layer) => layer.name === tweenLayerName), "tween layer was not added");
    assert.ok(initialLayers.some((layer) => layer.name === actionsLayerName), "actions layer was not added");
    const tweenLayer = initialLayers.find((layer) => layer.name === tweenLayerName);
    assert.ok(tweenLayer, "could not locate the new tween layer");

    const drawn = await runValue(
        `(function () { var __doc = fl.getDocumentDOM(), __timeline = __doc && __doc.getTimeline(), __index = -1; if (!__doc || __doc.pathURI !== ${JSON.stringify(savedPath)} || __doc.type !== "htmlcanvas") throw new Error("The disposable Canvas document is not active"); for (var __i = 0; __i < __timeline.layers.length; __i++) if (__timeline.layers[__i].name === ${JSON.stringify(tweenLayerName)}) __index = __i; if (__index < 0) throw new Error("Canvas tween layer not found"); __timeline.currentLayer = __index; __timeline.currentFrame = 0; __doc.addNewRectangle({ left: 20, top: 20, right: 100, bottom: 100 }, 0); if (__doc.selectNone) __doc.selectNone(); var __elements = __timeline.layers[__index].frames[0].elements || []; if (__elements.length !== 1 || __elements[0].elementType !== "shape") throw new Error("Expected one rectangle on the disposable Canvas layer"); return String(__index) + "\\t" + __elements[0].elementType; })()`,
        "draw Canvas rectangle on disposable layer",
    );
    assert.equal(typeof drawn, "string");
    const [tweenLayerIndexText, shapeType] = drawn.split("\t");
    const tweenLayerIndex = Number(tweenLayerIndexText);
    assert.equal(shapeType, "shape");
    const converted = verifyTool(
        await convertToSymbol({
            timeline: 0,
            document: documentName,
            frame: 1,
            elements: [{ layer: tweenLayerIndex, element: 0 }],
            name: "CanvasSmokeSymbol",
            type: "movie clip",
            registrationPoint: "center",
        }),
        "convert Canvas rectangle to symbol",
    );
    assert.equal(converted.name, "CanvasSmokeSymbol");
    console.log("PASS convert_to_symbol on Canvas.");

    const elementEdit = verifyTool(
        await editElements({
            timeline: 0,
            document: documentName,
            ops: [
                {
                    layer: tweenLayerName,
                    frame: 1,
                    element: 0,
                    set: { name: "CanvasSmokeInstance", x: 72, y: 88 },
                },
            ],
        }),
        "edit_elements set Canvas instance properties",
    );
    assert.equal(elementEdit.applied, 1, "edit_elements did not apply the instance update");

    const libraryEdit = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [
                { op: "createFolder", path: "CanvasSmokeFolder" },
                { op: "renameItem", item: "CanvasSmokeSymbol", newName: "CanvasSmokeRenamedSymbol" },
            ],
        }),
        "edit_library Canvas folder and rename",
    );
    assert.equal(libraryEdit.failed, null, `edit_library failed: ${JSON.stringify(libraryEdit.failed)}`);
    assert.equal(libraryEdit.applied.length, 2, "Canvas library folder/rename operations were not both applied");
    console.log("PASS edit_library: folder created and symbol renamed on Canvas.");

    const linkageInput = { document: documentName, ops: [{ op: "getLinkage", item: "CanvasSmokeRenamedSymbol" }] };
    expectLibraryRefusal(await editLibrary(linkageInput), "edit_library getLinkage on Canvas");
    expectLibraryRefusal(
        await editLibrary({
            document: documentName,
            ops: [{ op: "setLinkage", item: "CanvasSmokeRenamedSymbol", exportForAS: true }],
        }),
        "edit_library setLinkage on Canvas",
    );

    const frameOps = verifyTool(
        await editTimeline({
            timeline: 0,
            document: documentName,
            ops: [
                { op: "setSpanLength", layer: tweenLayerName, frame: 1, length: 5, ripple: false },
                { op: "insertKeyframe", layer: tweenLayerName, frame: 5 },
                { op: "setSpanLength", layer: actionsLayerName, frame: 1, length: 2, ripple: false },
                { op: "insertKeyframe", layer: actionsLayerName, frame: 2 },
            ],
        }),
        "edit_timeline extend spans and insert keyframes",
    );
    assert.equal(frameOps.failed, null, `edit_timeline frame operations failed: ${JSON.stringify(frameOps.failed)}`);
    assert.equal(frameOps.applied.length, 4, "edit_timeline did not apply all keyframe operations");
    console.log("PASS edit_timeline: both layers extended and frame-2/frame-5 keyframes inserted.");

    const tweenResult = verifyTool(
        await editTween({
            timeline: 0,
            document: documentName,
            ops: [
                {
                    op: "createTween",
                    layer: tweenLayerName,
                    instance: "CanvasSmokeInstance",
                    kind: "classic",
                    keyframes: [
                        { frame: 1, x: 72, y: 88 },
                        { frame: 5, x: 162, y: 88 },
                    ],
                },
            ],
        }),
        "edit_tween classic Canvas instance",
    );
    if (tweenResult.failed) {
        console.log(`PASS edit_tween refusal recorded: ${tweenResult.failed.error}`);
    } else {
        assert.equal(tweenResult.applied.length, 1, "edit_tween returned neither success nor a refusal");
        tweenApplied = true;
        console.log("PASS edit_tween: classic tween created on Canvas.");
    }

    const tweenFrame1 = await inspect(documentName, tweenLayerName, 1);
    assert.equal(tweenFrame1.elements.length, 1, "Canvas tween layer frame 1 has no instance");
    assert.equal(tweenFrame1.elements[0].name, "CanvasSmokeInstance");
    assert.equal(tweenFrame1.elements[0].libraryItem, "CanvasSmokeRenamedSymbol");
    if (tweenApplied) {
        assert.ok(tweenFrame1.spans.some((span) => span.tweenType === "classic"), "Canvas classic tween is absent from inspection");
    }
    const actionsFrame2 = await inspect(documentName, actionsLayerName, 2);
    assert.ok(actionsFrame2.spans.some((span) => span.start === 2), "inserted Canvas actions keyframe is missing");
    console.log("PASS inspect_timeline: Canvas instance, renamed Library item, and keyframes verified.");

    const exported = verifyTool(
        await exportScripts({ document: documentName, dir: exportDir, force: true }, { _meta: {} }),
        "export_scripts for Canvas",
    );
    assert.deepEqual(exported.failed, [], `export_scripts failed: ${JSON.stringify(exported.failed)}`);
    const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
    const scene = manifest.timelines.find((timeline) => timeline.scene === 0 && !timeline.item);
    assert.ok(scene, "Canvas scene timeline was not exported");
    const actionsMapping = scene.layers.find((layer) => layer.name === actionsLayerName);
    assert.ok(actionsMapping, "Canvas actions layer was not exported");
    const actionScript = 'console.log("Canvas smoke frame script");';
    const scriptFile = join(exportDir, scene.dir, actionsMapping.dir, "1.js");
    await mkdir(dirname(scriptFile), { recursive: true });
    await writeFile(scriptFile, actionScript);
    const applied = verifyTool(await applyScripts({ dir: exportDir, document: documentName }, { _meta: {} }), "apply_scripts Canvas frame script");
    assert.deepEqual(applied.failed, [], `apply_scripts failed: ${JSON.stringify(applied.failed)}`);
    const actionScriptCheck = await runValue(
        `(function () { var __doc = null, __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __doc = __docs[__i]; if (!__doc || __doc.type !== "htmlcanvas") throw new Error("Saved Canvas document not found"); var __timeline = __doc.timelines[0], __found = null; for (__i = 0; __i < __timeline.layers.length; __i++) if (__timeline.layers[__i].name === ${JSON.stringify(actionsLayerName)}) __found = __timeline.layers[__i]; if (!__found || String(__found.frames[0].actionScript) !== ${JSON.stringify(actionScript)}) throw new Error("Canvas frame script did not apply"); return String(__found.frames[0].actionScript); })()`,
        "verify applied Canvas frame script",
    );
    assert.equal(actionScriptCheck, actionScript, "Animate did not retain the applied Canvas frame script");
    console.log(`PASS export_scripts/apply_scripts: ${scriptFile} applied and read back from Animate.`);

    await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one saved Canvas document"); fl.setActiveWindow(__matches[0]); return __matches[0].pathURI; })()`,
        "activate Canvas document before capture_frame",
    );
    const capture = verifyTool(await captureFrame({ frame: 1, dir: captureDir }), "capture_frame Canvas frame 1");
    const captureFile = await stat(capture.path);
    assert.ok(captureFile.isFile() && captureFile.size > 0, "capture_frame did not write a non-empty PNG");
    console.log(`PASS capture_frame: ${capture.path} (${captureFile.size} bytes).`);

    const published = verifyTool(await publish({ document: documentName }), "publish Canvas document");
    assert.equal(published.ok, true, "Canvas publish did not report ok:true");
    assert.equal(published.compilerOutput, "not_checked", "Canvas publish compilerOutput should be not_checked");
    const publishFiles = (await findFiles(outDir)).filter((path) => /\.(?:html|js)$/i.test(path));
    assert.ok(publishFiles.length > 0, "Canvas publish produced no HTML/JS output in the disposable directory");
    console.log(`PASS publish: ok=${published.ok}, compilerOutput=${published.compilerOutput}; outputs: ${publishFiles.join(" | ")}`);

    const output = verifyTool(await readOutput(), "read_output after Canvas publish");
    console.log(`PASS read_output: compiler diagnostics status=${output.compilerDiagnostics.status}.`);

    expectRefusal(await testMovie({ document: documentName }), "test_movie refusal on Canvas", /test_movie supports AS3 documents only/i);
    expectRefusal(
        await installGreensock({ document: documentName }),
        "install_greensock refusal on Canvas",
        /For HTML5 Canvas, use createjs\.Tween instead; GSAP is not supported for Canvas\./,
    );

    const overwrite = verifyTool(
        await saveDocument({ document: savedPath, path: flaPath, confirm: true }),
        "save_document confirmed Canvas overwrite",
    );
    assert.equal(overwrite.path, savedPath, "save_document overwrite returned a different path");
    verifyTool(
        await closeDocument({ document: savedPath, discardUnsavedChanges: true }),
        "close Canvas FLA before reopen",
    );
    assert.deepEqual(await documentRows("verify Canvas close before reopen"), initialDocuments);

    const reopened = verifyTool(await openDocument({ path: flaPath }), "reopen saved Canvas FLA");
    assert.ok(reopened.name && reopened.path, "open_document did not return reopened Canvas document details");
    documentNameForCleanup.value = reopened.name;
    assert.deepEqual(withoutRows(await documentRows("verify reopened Canvas FLA"), initialDocuments), [`${reopened.name}\t${reopened.path}`]);
    await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(reopened.path)}) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one reopened Canvas document"); fl.setActiveWindow(__matches[0]); return __matches[0].type; })()`,
        "activate reopened Canvas document before get_document_info",
    );
    const reopenedInfo = verifyTool(await getDocumentInfo(), "get_document_info after Canvas reopen");
    assert.equal(reopenedInfo.asVersion, null, "reopened Canvas document should report asVersion null");
    const persistedType = await runValue(
        `(function () { var __doc = fl.getDocumentDOM(); if (!__doc || __doc.pathURI !== ${JSON.stringify(reopened.path)}) throw new Error("Reopened Canvas document is not active"); return String(__doc.type); })()`,
        "verify reopened Canvas type",
    );
    assert.equal(persistedType, "htmlcanvas");
    const reopenedTweenFrame1 = await inspect(reopened.name, tweenLayerName, 1);
    const reopenedTweenFrame5 = await inspect(reopened.name, tweenLayerName, 5);
    assert.ok(reopenedTweenFrame1.elements.length === 1 && reopenedTweenFrame1.elements[0].name === "CanvasSmokeInstance");
    assert.equal(reopenedTweenFrame1.elements[0].libraryItem, "CanvasSmokeRenamedSymbol");
    assert.ok(reopenedTweenFrame1.elements[0].x > 0 && reopenedTweenFrame1.elements[0].y > 0, "Canvas instance transform did not persist");
    assert.ok(reopenedTweenFrame5.elements.length === 1, "Canvas tween end-frame instance did not persist");
    if (tweenApplied) {
        assert.ok(reopenedTweenFrame1.spans.some((span) => span.tweenType === "classic"), "Canvas classic tween did not persist after reopen");
        assert.ok(Math.abs(reopenedTweenFrame5.elements[0].x - 162) < 1, `Canvas tween end x did not persist: ${reopenedTweenFrame5.elements[0].x}`);
    }
    const reopenedActions = await inspect(reopened.name, actionsLayerName, 1);
    assert.ok(reopenedActions, "Canvas actions layer did not persist");
    const persistedScript = await runValue(
        `(function () { var __doc = fl.getDocumentDOM(), __item = null, __folder = null, __layer = null; if (!__doc || __doc.pathURI !== ${JSON.stringify(reopened.path)} || __doc.type !== "htmlcanvas") throw new Error("Reopened Canvas document is not active"); for (var __i = 0; __i < __doc.library.items.length; __i++) { var __entry = __doc.library.items[__i]; if (__entry.name === "CanvasSmokeRenamedSymbol") __item = __entry; if (__entry.name === "CanvasSmokeFolder") __folder = __entry; } for (__i = 0; __i < __doc.timelines[0].layers.length; __i++) if (__doc.timelines[0].layers[__i].name === ${JSON.stringify(actionsLayerName)}) __layer = __doc.timelines[0].layers[__i]; if (!__item || !__folder || !__layer || String(__layer.frames[0].actionScript) !== ${JSON.stringify(actionScript)}) throw new Error("Canvas Library or frame script did not persist after reopen"); return [__doc.type, __item.name, __folder.name, String(__layer.frames[0].actionScript)].join("\\t"); })()`,
        "verify persisted Canvas Library and frame script",
    );
    assert.equal(persistedScript, `htmlcanvas\tCanvasSmokeRenamedSymbol\tCanvasSmokeFolder\t${actionScript}`);
    console.log(`PASS reopen persistence: type=${persistedType}, asVersion=${reopenedInfo.asVersion}, layers, symbol, transform, and frame script survived.${tweenApplied ? " Classic tween also survived." : " Tween refusal was recorded above; instance edits survived."}`);

    verifyTool(
        await closeDocument({ document: reopened.path, discardUnsavedChanges: true }),
        "close reopened disposable Canvas FLA",
    );
    assert.deepEqual(await documentRows("verify final Canvas close"), initialDocuments);
    console.log("PASS final open-document list matches the initial list.");
} catch (error) {
    failure = error;
} finally {
    if (initialDocuments) {
        try {
            const ownedPath = await runValue(
                `(function () { var __wantedPath = ${JSON.stringify(savedPath)}, __wantedName = ${JSON.stringify(documentNameForCleanup.value)}, __matches = [], __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) { var __doc = __docs[__i]; if ((__wantedPath && __doc.pathURI === __wantedPath) || (!__doc.pathURI && __wantedName && __doc.name === __wantedName)) __matches.push(__doc); } if (__matches.length > 1) throw new Error("Found multiple matching disposable documents: " + __matches.length); if (!__matches.length) return ""; if (__matches[0].pathURI) return __matches[0].pathURI; __matches[0].close(false); for (var __j = 0; __j < (fl.documents || []).length; __j++) if (fl.documents[__j] === __matches[0]) throw new Error("Disposable Canvas document remained open after cleanup"); return ""; })()`,
                "locate disposable Canvas document for cleanup",
            );
            if (ownedPath) await closeDocumentByPath(runJsfl, ownedPath);
        } catch (error) {
            console.error("Disposable Canvas document cleanup failed:", error);
            failure = failure ? new AggregateError([failure, error], "Smoke test and cleanup both failed") : error;
        }

        try {
            const finalDocuments = await documentRows("read final document list");
            finalCount = finalDocuments.length;
            assert.deepEqual(finalDocuments, initialDocuments, "existing open documents changed or a disposable Canvas document remains open");
        } catch (error) {
            console.error("Final document-state verification failed:", error);
            failure = failure ? new AggregateError([failure, error], "Smoke test and final-state verification failed") : error;
        }
    }

    try {
        await rm(outDir, { recursive: true, force: true });
        await assert.rejects(stat(outDir), { code: "ENOENT" });
    } catch (error) {
        console.error("Temporary Canvas directory cleanup failed:", error);
        failure = failure ? new AggregateError([failure, error], "Smoke test and temporary cleanup both failed") : error;
    }
    console.log(`Document count: initial ${initialDocuments?.length ?? "unknown"}; final ${finalCount}.`);
    console.log(`Leftover state: temporary directory ${outDir} removed; disposable document ${finalCount === initialDocuments?.length ? "closed" : "may remain open"}.`);
}

if (failure) throw failure;
console.log(`Canvas document smoke passed (disposable FLA: ${flaPath})`);
