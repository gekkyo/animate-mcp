// Disposable real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-edit-library.mjs`.
// Creates and closes a temporary AS3 document without saving or publishing it; Animate must be running.
import assert from "node:assert/strict";
import { registerEditLibrary } from "../dist/tools/edit-library.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const editLibrary = toolHandler(registerEditLibrary);
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
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
if (setup.isError) throw new Error(`Could not prepare linkage smoke document: ${message(setup)}`);
const documentName = setup.structuredContent?.result;
if (!documentName) throw new Error(`Setup did not return a document name: ${message(setup)}`);

const selected = await runJsfl({
    code: `var __smokeName = ${JSON.stringify(documentName)}; var __smokeDoc = null; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __smokeName) __smokeDoc = fl.documents[__index]; __smokeDoc.library.selectNone(); __smokeDoc.library.selectItem("EditLibrarySelectionSmokeSymbol"); __smokeDoc.name;`,
});
if (selected.isError) throw new Error(`Could not prepare Library selection: ${message(selected)}`);

const assertSelectionPreserved = async (description) => {
    const result = await runJsfl({
        code: `var __smokeName = ${JSON.stringify(documentName)}; var __smokeDoc = null; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __smokeName) __smokeDoc = fl.documents[__index]; var __selected = __smokeDoc.library.getSelectedItems(); __selected.length === 1 ? __selected[0].name : "selection count: " + __selected.length;`,
    });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.equal(result.structuredContent?.result, "EditLibrarySelectionSmokeSymbol", `${description} changed Library selection`);
};

try {
    const initial = verifyTool(
        await editLibrary({ document: documentName, ops: [{ op: "getLinkage", item: "EditLibraryLinkageSmokeSymbol" }] }),
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
} finally {
    const cleanup = await runJsfl({
        code: `var __closeName = ${JSON.stringify(documentName)}; for (var __index = 0; __index < fl.documents.length; __index++) if (fl.documents[__index].name === __closeName) { fl.documents[__index].close(false); break; } true;`,
    });
    if (cleanup.isError) throw new Error(`Could not close disposable linkage smoke document: ${message(cleanup)}`);
}
