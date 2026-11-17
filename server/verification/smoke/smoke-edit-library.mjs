// Disposable real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/smoke-edit-library.mjs`.
// Creates and closes a temporary AS3 document without saving or publishing it; Animate must be running.
import assert from "node:assert/strict";
import { registerEditLibrary } from "../../dist/tools/library/edit-library.js";
import { registerRunJsfl } from "../../dist/tools/run-jsfl.js";
import { toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const editLibrary = toolHandler(registerEditLibrary);
/** Extracts the first text result from a tool response.
 * @param result Tool response.
 * @returns Text content or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts tool success and that no operation failed.
 * @param result Tool response.
 * @param description Operation description for assertion errors.
 * @returns Structured tool response.
 */
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    const content = result.structuredContent;
    assert.equal(content.failed, null, `${description}: ${JSON.stringify(content)}`);
    return content;
};

const setup = await runJsfl({
    code: `var __smokeDoc = null;
try {
  fl.createDocument("timeline", 550, 400, 24);
  __smokeDoc = fl.getDocumentDOM();
  if (__smokeDoc.type !== "Flash" || String(__smokeDoc.asVersion).indexOf("3") < 0) throw new Error("Could not create a Flash/AS3 smoke document");
  __smokeDoc.library.addNewItem("movie clip", "EditLibraryLinkageSmokeSymbol");
  __smokeDoc.library.addNewItem("movie clip", "EditLibrarySelectionSmokeSymbol");
  fl.setActiveWindow(__smokeDoc);
  __smokeDoc.name;
} catch (__error) {
  if (__smokeDoc) __smokeDoc.close(false);
  throw __error;
}`,
});
if (setup.isError) {
    throw new Error(`Could not prepare linkage smoke document: ${message(setup)}`);
}
const documentName = setup.structuredContent?.result;
if (!documentName) {
    throw new Error(`Setup did not return a document name: ${message(setup)}`);
}

const selected = await runJsfl({
    code: `var __smokeName = ${JSON.stringify(documentName)}; var __smokeDoc = null; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __smokeName) __smokeDoc = fl.documents[__index]; __smokeDoc.library.selectNone(); __smokeDoc.library.selectItem("EditLibrarySelectionSmokeSymbol"); __smokeDoc.name;`,
});
if (selected.isError) {
    throw new Error(`Could not prepare Library selection: ${message(selected)}`);
}

/** Verifies an operation preserved the selected Library item.
 * @param description Operation description for assertion errors.
 */
const assertSelectionPreserved = async (description) => {
    const result = await runJsfl({
        code: `var __smokeName = ${JSON.stringify(documentName)}; var __smokeDoc = null; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __smokeName) __smokeDoc = fl.documents[__index]; var __selected = __smokeDoc.library.getSelectedItems(); __selected.length === 1 ? __selected[0].name : "selection count: " + __selected.length;`,
    });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.equal(
        result.structuredContent?.result,
        "EditLibrarySelectionSmokeSymbol",
        `${description} changed Library selection`,
    );
};

let failure;
try {
    const createdSymbols = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [
                { op: "createSymbol", type: "movie clip", name: "EditLibraryCreatedMovieClipSmokeSymbol" },
                { op: "createSymbol", type: "button", name: "EditLibraryCreatedButtonSmokeSymbol" },
                { op: "createSymbol", type: "graphic", name: "EditLibraryCreatedGraphicSmokeSymbol" },
            ],
        }),
        "create symbols",
    );
    assert.deepEqual(
        createdSymbols.results.map(({ result }) => result),
        [
            { name: "EditLibraryCreatedMovieClipSmokeSymbol", type: "movie clip" },
            { name: "EditLibraryCreatedButtonSmokeSymbol", type: "button" },
            { name: "EditLibraryCreatedGraphicSmokeSymbol", type: "graphic" },
        ],
    );
    await assertSelectionPreserved("create symbols");

    const duplicated = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [
                {
                    op: "duplicateItem",
                    item: "EditLibraryCreatedMovieClipSmokeSymbol",
                    newName: "EditLibraryDuplicatedSmokeSymbol",
                },
            ],
        }),
        "duplicate item",
    );
    assert.deepEqual(duplicated.results[0].result, {
        name: "EditLibraryDuplicatedSmokeSymbol",
        itemType: "movie clip",
    });
    await assertSelectionPreserved("duplicate item");

    const usages = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [{ op: "findUsages", item: "EditLibraryCreatedMovieClipSmokeSymbol" }],
        }),
        "find unused symbol usages",
    );
    assert.deepEqual(usages.results[0].result, {
        item: "EditLibraryCreatedMovieClipSmokeSymbol",
        usages: [],
    });
    await assertSelectionPreserved("findUsages");
    console.log("symbol creation, duplication, and usage scan: passed");

    const initial = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [{ op: "getLinkage", item: "EditLibraryLinkageSmokeSymbol" }],
        }),
        "read default linkage",
    );
    assert.deepEqual(initial.results[0].result, {
        name: "EditLibraryLinkageSmokeSymbol",
        exportForAS: false,
        className: "",
        baseClass: "",
        exportInFirstFrame: false,
    });
    await assertSelectionPreserved("getLinkage");

    const updated = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [
                {
                    op: "setLinkage",
                    item: "EditLibraryLinkageSmokeSymbol",
                    exportForAS: true,
                    className: "com.example.LinkageSmokeSymbol",
                    baseClass: "flash.display.Sprite",
                    exportInFirstFrame: true,
                },
            ],
        }),
        "update linkage",
    );
    assert.deepEqual(updated.results[0].result, {
        name: "EditLibraryLinkageSmokeSymbol",
        exportForAS: true,
        className: "com.example.LinkageSmokeSymbol",
        baseClass: "flash.display.Sprite",
        exportInFirstFrame: true,
    });
    await assertSelectionPreserved("setLinkage");

    const repeatedEnable = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [{ op: "setLinkage", item: "EditLibraryLinkageSmokeSymbol", exportForAS: true }],
        }),
        "repeat linkage export enable",
    );
    assert.deepEqual(repeatedEnable.results[0].result, updated.results[0].result);
    await assertSelectionPreserved("repeat setLinkage");

    const disabled = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [{ op: "setLinkage", item: "EditLibraryLinkageSmokeSymbol", exportForAS: false }],
        }),
        "disable linkage export",
    );
    assert.deepEqual(disabled.results[0].result, {
        name: "EditLibraryLinkageSmokeSymbol",
        exportForAS: false,
        className: "",
        baseClass: "",
        exportInFirstFrame: false,
    });
    await assertSelectionPreserved("disable linkage");
    const repeatedDisable = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [{ op: "setLinkage", item: "EditLibraryLinkageSmokeSymbol", exportForAS: false }],
        }),
        "repeat linkage export disable",
    );
    assert.deepEqual(repeatedDisable.results[0].result, disabled.results[0].result);
    await assertSelectionPreserved("repeat disable linkage");
    const disabledFirstFrame = verifyTool(
        await editLibrary({
            document: documentName,
            ops: [
                {
                    op: "setLinkage",
                    item: "EditLibraryLinkageSmokeSymbol",
                    exportForAS: false,
                    exportInFirstFrame: false,
                },
            ],
        }),
        "set first-frame export false while linkage is disabled",
    );
    assert.deepEqual(disabledFirstFrame.results[0].result, disabled.results[0].result);
    await assertSelectionPreserved("disabled first-frame linkage");
    console.log("AS3 linkage read, write, read-back, and disabled defaults: passed");
} catch (error) {
    failure = error;
} finally {
    try {
        const cleanup = await runJsfl({
            code: `var __closeName = ${JSON.stringify(documentName)}; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __closeName) { fl.documents[__index].close(false); break; } true;`,
        });
        if (cleanup.isError) {
            const error = new Error(`Could not close disposable linkage smoke document: ${message(cleanup)}`);
            failure = failure ? new AggregateError([failure, error], "Smoke test and document cleanup failed") : error;
        }
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke test and document cleanup failed") : error;
    }
}
if (failure) {
    throw failure;
}
