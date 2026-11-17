// Disposable real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-isolated-publish.mjs`.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isAnimateRunning } from "../../../dist/runtime/animate-launcher.js";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerOpenDocument } from "../../../dist/tools/document/open-document.js";
import { registerSaveDocument } from "../../../dist/tools/document/save-document.js";
import { registerPublish } from "../../../dist/tools/output/publish.js";
import { closeDocumentByPath, toolHandler } from "../lib/smoke-lib.mjs";

assert.equal(await isAnimateRunning(), true, "Animate must already be running; refusing to launch it");

const openDocument = toolHandler(registerOpenDocument);
const saveDocument = toolHandler(registerSaveDocument);
const publish = toolHandler(registerPublish);
const runJsfl = toolHandler(registerRunJsfl);
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
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
/** Runs JSFL and returns its result after checking for tool errors.
 * @param code JSFL source to execute.
 * @param description Operation description for assertion errors.
 * @returns JSFL result value.
 */
const runValue = async (code, description) => {
    const result = await runJsfl({ code });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent?.result;
};
/** Recursively lists files under a directory using relative paths.
 * @param directory Root directory to scan.
 * @param relative Relative subdirectory to scan.
 * @returns Promise resolving to sorted relative file paths.
 */
const listFiles = async (directory, relative = "") => {
    const files = [];
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
        const path = join(relative, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFiles(directory, path)));
        } else {
            files.push(path);
        }
    }
    return files.sort();
};

const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-isolated-publish-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
let documentName = "";
let savedPath = "";
let failure;

try {
    const created = verifyTool(await openDocument({ type: "htmlcanvas" }), "create HTML5 Canvas document");
    assert.equal(created.path, null, "new Canvas document unexpectedly has a saved path");
    assert.ok(created.name, "open_document returned no document name");
    documentName = created.name;

    const saved = verifyTool(
        await saveDocument({ document: documentName, path: flaPath }),
        "save disposable Canvas FLA",
    );
    savedPath = saved.path;
    assert.ok(savedPath, "save_document returned no path");
    const fla = await stat(flaPath);
    assert.ok(fla.isFile() && fla.size > 0, "saved disposable Canvas FLA is empty");
    documentName = await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one saved Canvas document"); return __matches[0].name; })()`,
        "locate saved disposable document",
    );

    const libraryItem = await runValue(
        `(function () { var __docs = fl.documents || [], __doc = null; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __doc = __docs[__i]; if (!__doc || __doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); if (!__doc.library.addNewItem("graphic", "IsolatedPublishSmokeSymbol")) throw new Error("Could not create smoke Library symbol"); return __doc.library.itemExists("IsolatedPublishSmokeSymbol"); })()`,
        "create bitmap/font-free Library symbol",
    );
    assert.equal(libraryItem, true, "smoke Library symbol was not created");

    const published = verifyTool(await publish({ document: documentName }), "publish disposable Canvas document");
    assert.equal(published.ok, true, "publish did not report ok:true");
    assert.equal(published.compilerOutput, "not_checked", "Canvas compilerOutput differs from expected behavior");
    const compilerErrors = await runValue(
        `(function () { return typeof fl.compilerErrors + "\\t" + (fl.compilerErrors ? typeof fl.compilerErrors.save : "unavailable"); })()`,
        "inspect fl.compilerErrors availability",
    );
    const files = await listFiles(outDir);
    console.log(`Publish result: ${JSON.stringify(published)}`);
    console.log(`fl.compilerErrors: ${compilerErrors}`);
    console.log("Output files:");
    for (const file of files) {
        console.log(file);
    }
    assert.ok(
        files.some((file) => file.toLowerCase().endsWith(".html")),
        "publish produced no HTML output",
    );
} catch (error) {
    failure = error;
} finally {
    if (savedPath || documentName) {
        try {
            if (savedPath) {
                await closeDocumentByPath(runJsfl, savedPath);
            } else {
                await runValue(
                    `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].name === ${JSON.stringify(documentName)} && !__docs[__i].pathURI) __matches.push(__docs[__i]); if (__matches.length > 1) throw new Error("Multiple matching disposable documents found"); if (__matches.length) __matches[0].close(false); return __matches.length; })()`,
                    "close disposable document without saving",
                );
            }
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke and document cleanup failed") : error;
        }
    }
    try {
        await rm(outDir, { recursive: true, force: true });
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke and temp cleanup failed") : error;
    }
}

if (failure) {
    throw failure;
}
console.log("Isolated publish smoke passed; disposable document closed without saving and temp directory removed.");
