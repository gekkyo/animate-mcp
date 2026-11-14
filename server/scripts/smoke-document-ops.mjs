// Disposable real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-document-ops.mjs`.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerCloseDocument } from "../dist/tools/close-document.js";
import { registerConvertToSymbol } from "../dist/tools/convert-to-symbol.js";
import { registerOpenDocument } from "../dist/tools/open-document.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { registerSaveDocument } from "../dist/tools/save-document.js";
import { closeDocumentByPath, toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const openDocument = toolHandler(registerOpenDocument);
const saveDocument = toolHandler(registerSaveDocument);
const closeDocument = toolHandler(registerCloseDocument);
const convertToSymbol = toolHandler(registerConvertToSymbol);
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
const expectRefusal = (result, description, expectedMessage) => {
    assert.equal(result.isError, true, `${description} was not refused`);
    assert.match(message(result), expectedMessage, `${description} returned an unexpected error`);
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

const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-document-ops-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
const flaUri = pathToFileURL(flaPath).href;
let initialDocuments;
let documentName;
let failure;
let finalCount = "unknown";

try {
    initialDocuments = await documentRows("read initial document list");
    assert.ok(initialDocuments.length > 0, "Animate must already have the user's documents open; refusing to run in an empty session");
    console.log(`Initial documents (${initialDocuments.length}): ${initialDocuments.join(" | ")}`);

    const created = verifyTool(await openDocument({ type: "timeline" }), "create disposable timeline document");
    assert.equal(created.path, null, "new timeline document unexpectedly has a saved path");
    assert.ok(created.name, "open_document returned no document name");
    assert.ok(!initialDocuments.some((row) => row.startsWith(`${created.name}\t`)), "new document name conflicts with an existing open document");
    documentName = created.name;
    const afterCreate = await documentRows("verify created document");
    assert.deepEqual(withoutRows(afterCreate, initialDocuments), [`${documentName}\t`], "open_document did not create exactly the expected unsaved document");
    console.log(`Created disposable document: ${documentName}`);

    const activated = await runValue(
        `(function () { var __name = ${JSON.stringify(documentName)}, __matches = [], __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].name === __name && !__docs[__i].pathURI) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one new unsaved document; found " + __matches.length); fl.setActiveWindow(__matches[0]); return __matches[0].name; })()`,
        "activate disposable document",
    );
    assert.equal(activated, documentName);

    const shapeState = await runValue(
        `(function () { var __name = ${JSON.stringify(documentName)}, __doc = fl.getDocumentDOM(); if (!__doc || __doc.name !== __name || __doc.pathURI) throw new Error("The disposable document is not active"); var __timeline = __doc.getTimeline(); __timeline.currentLayer = 0; __timeline.currentFrame = 0; __doc.addNewRectangle({ left: 20, top: 20, right: 120, bottom: 120 }, 0); if (__doc.selectNone) __doc.selectNone(); var __layer = __timeline.layers[0], __elements = __layer.frames[0].elements || []; if (__elements.length !== 1 || __elements[0].elementType !== "shape") throw new Error("Expected one rectangle shape on frame 1"); __layer.locked = true; return [String(__layer.locked), String(__timeline.currentLayer), String(__timeline.currentFrame), String((__doc.selection || []).length), __elements[0].elementType].join("\\t"); })()`,
        "draw rectangle on disposable document",
    );
    assert.equal(shapeState, "true\t0\t0\t0\tshape", "rectangle setup did not reach the expected state");
    console.log("Active-window timing: separate activation Run succeeded; rectangle added only to the disposable document.");

    const converted = verifyTool(
        await convertToSymbol({
            timeline: 0,
            document: documentName,
            frame: 1,
            elements: [{ layer: 0, element: 0 }],
            name: "SmokeSymbol",
            type: "movie clip",
            registrationPoint: "center",
        }),
        "convert rectangle to symbol",
    );
    assert.deepEqual(converted, { name: "SmokeSymbol", type: "movie clip", registrationPoint: "center" });
    const convertedState = await runValue(
        `(function () { var __name = ${JSON.stringify(documentName)}, __doc = null, __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].name === __name && !__docs[__i].pathURI) __doc = __docs[__i]; if (!__doc) throw new Error("Disposable document not found"); var __item = null; for (__i = 0; __i < __doc.library.items.length; __i++) if (__doc.library.items[__i].name === "SmokeSymbol") __item = __doc.library.items[__i]; var __timeline = __doc.getTimeline(), __layer = __timeline.layers[0], __elements = __layer.frames[0].elements || [], __selection = __doc.selection || []; if (!__item) throw new Error("SmokeSymbol is missing from the Library"); if (__elements.length !== 1 || __elements[0].elementType !== "instance" || !__elements[0].libraryItem || __elements[0].libraryItem.name !== "SmokeSymbol") throw new Error("Converted frame does not contain a SmokeSymbol instance"); return [__item.name, __elements[0].elementType, String(__layer.locked), String(__timeline.currentLayer), String(__timeline.currentFrame), String(__selection.length)].join("\\t"); })()`,
        "verify symbol and restored edit state",
    );
    assert.equal(convertedState, "SmokeSymbol\tinstance\ttrue\t0\t0\t0", "symbol conversion or edit-state restoration differed from expected");
    console.log("convertToSymbol: Library item and frame instance verified; original layer lock, frame, layer, and empty selection were restored.");

    const unsavedSave = await saveDocument({ document: documentName });
    expectRefusal(unsavedSave, "save unsaved document without a path", /unsaved; provide a save-as path/i);

    const saved = verifyTool(await saveDocument({ document: documentName, path: flaPath }), "save disposable document");
    assert.ok(saved.path, "save_document returned no Animate path");
    const savedPath = saved.path;
    const file = await stat(flaPath);
    assert.ok(file.isFile() && file.size > 0, "saved disposable FLA is empty");
    console.log(`Path normalization: input ${flaUri}; Animate returned ${savedPath}${savedPath === flaUri ? " (unchanged)" : " (normalized)"}.`);

    const overwriteRefused = await saveDocument({ document: savedPath, path: flaPath });
    expectRefusal(overwriteRefused, "overwrite existing disposable FLA without confirmation", /requires confirm: true/i);
    verifyTool(await saveDocument({ document: savedPath, path: flaPath, confirm: true }), "confirm save to existing disposable FLA");
    console.log("Save gates: unsaved-without-path and overwrite-without-confirm were refused; confirmed save succeeded.");

    const closeRefused = await closeDocument({ document: savedPath });
    expectRefusal(closeRefused, "close without discard consent", /discardUnsavedChanges: true/i);
    const closed = verifyTool(
        await closeDocument({ document: savedPath, discardUnsavedChanges: true }),
        "close saved disposable document",
    );
    assert.equal(closed.path, savedPath, "close_document returned a different path");
    const afterClose = await documentRows("verify first close");
    assert.deepEqual(afterClose, initialDocuments, "closing the disposable document changed the existing document list");
    console.log("close_document: discard consent gate and exact-path close verified.");

    const reopened = verifyTool(await openDocument({ path: flaPath }), "reopen saved disposable FLA");
    assert.ok(reopened.name && reopened.path, "open_document did not return reopened document details");
    const afterReopen = await documentRows("verify reopened FLA");
    assert.deepEqual(withoutRows(afterReopen, initialDocuments), [`${reopened.name}\t${reopened.path}`], "reopen did not add exactly the disposable FLA");
    verifyTool(
        await closeDocument({ document: reopened.path, discardUnsavedChanges: true }),
        "close reopened disposable FLA",
    );
    assert.deepEqual(await documentRows("verify final close"), initialDocuments, "final close changed the existing document list");
    console.log("Reopen and exact-path close verified.");
} catch (error) {
    failure = error;
} finally {
    if (initialDocuments) {
        try {
            const ownedPath = await runValue(
                `(function () { var __wantedUri = FLfile.platformPathToURI(${JSON.stringify(flaPath)}), __wantedName = ${JSON.stringify(documentName ?? "")}, __matches = [], __docs = fl.documents || []; function __normalize(path) { return FLfile.platformPathToURI(/^file:\\/\\//i.test(path) ? FLfile.uriToPlatformPath(path) : path); } for (var __i = 0; __i < __docs.length; __i++) { var __doc = __docs[__i], __isOwnedPath = false; if (__doc.pathURI) { try { __isOwnedPath = __normalize(__doc.pathURI) === __wantedUri; } catch (__error) {} } if (__isOwnedPath || (!__doc.pathURI && __wantedName && __doc.name === __wantedName)) __matches.push(__doc); } if (__matches.length > 1) throw new Error("Found multiple matching disposable documents: " + __matches.length); if (!__matches.length) return ""; if (__matches[0].pathURI) return __matches[0].pathURI; __matches[0].close(false); for (var __j = 0; __j < (fl.documents || []).length; __j++) if (fl.documents[__j] === __matches[0]) throw new Error("Disposable document remained open after cleanup"); return ""; })()`,
                "locate disposable document for cleanup",
            );
            if (ownedPath) await closeDocumentByPath(runJsfl, ownedPath);
        } catch (error) {
            console.error("Disposable document cleanup failed:", error);
            failure = failure ? new AggregateError([failure, error], "Smoke test and cleanup both failed") : error;
        }

        try {
            const finalDocuments = await documentRows("read final document list");
            finalCount = finalDocuments.length;
            assert.deepEqual(finalDocuments, initialDocuments, "existing open documents changed or a disposable document remains open");
        } catch (error) {
            console.error("Final document-state verification failed:", error);
            failure = failure ? new AggregateError([failure, error], "Smoke test and final-state verification failed") : error;
        }
    }

    try {
        await rm(outDir, { recursive: true, force: true });
        await assert.rejects(stat(outDir), { code: "ENOENT" });
    } catch (error) {
        console.error("Temporary directory cleanup failed:", error);
        failure = failure ? new AggregateError([failure, error], "Smoke test and temporary cleanup both failed") : error;
    }
    console.log(`Document count: initial ${initialDocuments?.length ?? "unknown"}; final ${finalCount}.`);
    console.log(`Leftover state: temporary directory ${outDir} removed; disposable document ${finalCount === initialDocuments?.length ? "closed" : "may remain open"}.`);
}

if (failure) throw failure;
console.log(`document operations smoke passed (disposable FLA: ${flaPath})`);
