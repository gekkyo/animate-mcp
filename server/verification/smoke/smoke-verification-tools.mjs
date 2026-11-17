// Disposable real-Animate verification smoke test (not in CI): `npm run build && node server/verification/smoke/smoke-verification-tools.mjs`.
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { isAnimateRunning } from "../../dist/runtime/animate-launcher.js";
import { registerAuditDocument } from "../../dist/tools/document/audit-document.js";
import { registerOpenDocument } from "../../dist/tools/document/open-document.js";
import { registerSaveDocument } from "../../dist/tools/document/save-document.js";
import { registerCaptureFrame } from "../../dist/tools/output/capture-frame.js";
import { registerDiffCaptures } from "../../dist/tools/output/diff-captures.js";
import { registerVerifyCanvasOutput } from "../../dist/tools/output/verify-canvas-output.js";
import { registerRunJsfl } from "../../dist/tools/run-jsfl.js";
import { toolHandler } from "./smoke-lib.mjs";

assert.equal(await isAnimateRunning(), true, "Animate must already be running; refusing to launch it");

const openDocument = toolHandler(registerOpenDocument);
const saveDocument = toolHandler(registerSaveDocument);
const auditDocument = toolHandler(registerAuditDocument);
const verifyCanvasOutput = toolHandler(registerVerifyCanvasOutput);
const captureFrame = toolHandler(registerCaptureFrame);
const diffCaptures = toolHandler(registerDiffCaptures);
const runJsfl = toolHandler(registerRunJsfl);
const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-verification-tools-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
let savedPath = "";
let documentName = "";
const generatedPaths = new Set();
let failure;

/** Extracts the first text result from a tool response.
 * @param result Tool response.
 * @returns The first text result or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts success and returns the structured tool payload.
 * @param result Tool response.
 * @param description Operation description.
 * @returns The structured tool payload.
 */
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
/** Runs JSFL and returns its result after checking for tool errors.
 * @param code JSFL source.
 * @param description Operation description.
 * @returns The JSFL result value.
 */
const runValue = async (code, description) => {
    const result = await runJsfl({ code });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent?.result;
};
/** Asserts that a path does not exist.
 * @param path Path expected to be absent.
 * @returns Nothing.
 */
const missing = async (path) => {
    await assert.rejects(access(path), { code: "ENOENT" });
};

try {
    const created = verifyTool(await openDocument({ type: "htmlcanvas" }), "create disposable Canvas document");
    assert.equal(created.path, null);
    assert.ok(created.name, "open_document returned no document name");
    const saved = verifyTool(
        await saveDocument({ document: created.name, path: flaPath }),
        "save disposable Canvas FLA",
    );
    savedPath = saved.path;
    assert.ok(savedPath, "save_document returned no path");
    documentName = await runValue(
        `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length !== 1 || __matches[0].type !== "htmlcanvas") throw new Error("Expected exactly one saved Canvas document"); return __matches[0].name; })()`,
        "locate saved disposable Canvas document",
    );
    assert.ok(documentName, "saved Canvas document has no name");
    const savedFile = await stat(flaPath);
    assert.ok(savedFile.isFile() && savedFile.size > 0, "saved disposable Canvas FLA is empty");

    // Animate applies setActiveWindow after the Run returns, so activate separately before active-document tools.
    await runValue(
        `(function () { var __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) { fl.setActiveWindow(__docs[__i]); return true; } throw new Error("Disposable Canvas document not found"); })()`,
        "activate disposable Canvas document",
    );

    const audit = verifyTool(await auditDocument({ document: documentName }), "audit disposable Canvas document");
    assert.equal(typeof audit.document, "string", "audit_document returned no document identity");
    assert.ok(Array.isArray(audit.warnings), "audit_document warnings are not an array");
    for (const category of ["unusedLibraryItems", "emptyKeyframes", "defaultNames"]) {
        assert.ok(Array.isArray(audit.findings?.[category]), `audit_document ${category} is not an array`);
    }
    console.log(`PASS audit_document structured response for ${audit.document}.`);

    const browserResult = await verifyCanvasOutput({ document: documentName });
    const browser = verifyTool(browserResult, "publish and verify disposable Canvas browser output");
    assert.ok(browser.buildResult, "verify_canvas_output returned no publish result");
    assert.equal(
        browser.browserOutput?.ok,
        true,
        `Canvas browser output reported errors: ${JSON.stringify(browser.browserOutput)}`,
    );
    assert.deepEqual(browser.browserOutput.consoleErrors, []);
    assert.deepEqual(browser.browserOutput.pageErrors, []);
    assert.deepEqual(browser.browserOutput.failedRequests, []);
    assert.ok(resultHasScreenshot(browserResult), "verify_canvas_output returned no browser screenshot");
    console.log(`PASS verify_canvas_output: ${browser.htmlPath}; browser output clean.`);

    const captureDir = join(homedir(), ".animate-mcp", "captures");
    const safeName = basename(flaPath, ".fla");
    await missing(join(captureDir, safeName));
    await runValue(
        `(function () { var __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) { fl.setActiveWindow(__docs[__i]); return true; } throw new Error("Disposable Canvas document not found"); })()`,
        "activate disposable Canvas document before capture",
    );
    const firstCapture = verifyTool(await captureFrame({ frame: 1 }), "capture initial Canvas frame");
    generatedPaths.add(firstCapture.path);
    assert.equal(firstCapture.frame, 1);
    assert.ok(
        firstCapture.path.startsWith(`${join(captureDir, safeName)}/`),
        "capture_frame did not use its default path",
    );
    const firstInfo = await stat(firstCapture.path);
    assert.ok(firstInfo.isFile() && firstInfo.size > 0, "first capture is empty");

    const shapeCount = await runValue(
        `(function () { var __docs = fl.documents || [], __doc = null; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __doc = __docs[__i]; if (!__doc || __doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); var __timeline = __doc.getTimeline(); __timeline.currentLayer = 0; __timeline.currentFrame = 0; __doc.addNewRectangle({ left: 30, top: 30, right: 180, bottom: 160 }, 0); if (__doc.selectNone) __doc.selectNone(); return __timeline.layers[0].frames[0].elements.length; })()`,
        "add visible shape to disposable Canvas document",
    );
    assert.equal(shapeCount, 1, "disposable Canvas document did not contain the new shape");
    await runValue(
        `(function () { var __docs = fl.documents || []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) { fl.setActiveWindow(__docs[__i]); return true; } throw new Error("Disposable Canvas document not found"); })()`,
        "reactivate disposable Canvas document before capture",
    );
    const secondCapture = verifyTool(await captureFrame({ frame: 1 }), "capture changed Canvas frame");
    generatedPaths.add(secondCapture.path);
    assert.equal(secondCapture.frame, 1);
    assert.ok(
        secondCapture.path.startsWith(`${join(captureDir, safeName)}/`),
        "second capture did not use default path",
    );
    assert.notEqual(secondCapture.path, firstCapture.path);
    const secondInfo = await stat(secondCapture.path);
    assert.ok(secondInfo.isFile() && secondInfo.size > 0, "second capture is empty");

    const diff = verifyTool(
        await diffCaptures({ before: firstCapture.path, after: secondCapture.path, tolerance: 8 }),
        "diff Canvas captures",
    );
    generatedPaths.add(diff.path);
    assert.ok(diff.changedPixels > 0, "diff_captures found no pixel changes");
    assert.ok(
        diff.boundingBox &&
            diff.boundingBox.width > 0 &&
            diff.boundingBox.height > 0 &&
            diff.boundingBox.x >= 0 &&
            diff.boundingBox.y >= 0,
        "diff_captures returned an invalid changed-pixel bounding box",
    );
    const diffFile = await stat(diff.path);
    assert.ok(diffFile.isFile() && diffFile.size > 0, "diff_captures did not write its red-highlight PNG");
    const diffImage = await readFile(diff.path);
    const decodedDiff = PNG.sync.read(diffImage);
    let hasRedPixel = false;
    for (let offset = 0; offset < decodedDiff.data.length; offset += 4) {
        if (
            decodedDiff.data[offset] === 255 &&
            decodedDiff.data[offset + 1] === 0 &&
            decodedDiff.data[offset + 2] === 0 &&
            decodedDiff.data[offset + 3] === 255
        ) {
            hasRedPixel = true;
            break;
        }
    }
    assert.equal(hasRedPixel, true, "diff PNG contains no opaque red changed pixel");
    console.log(
        `PASS capture_frame/diff_captures: ${firstCapture.path} -> ${secondCapture.path}; ${diff.changedPixels} changed pixels in ${JSON.stringify(diff.boundingBox)}; diff ${diff.path}.`,
    );
} catch (error) {
    failure = error;
} finally {
    if (savedPath) {
        try {
            await runValue(
                `(function () { var __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(savedPath)}) __matches.push(__docs[__i]); if (__matches.length > 1) throw new Error("Multiple documents match disposable path"); if (__matches.length) __matches[0].close(false); for (__i = 0; __i < (fl.documents || []).length; __i++) if (fl.documents[__i].pathURI === ${JSON.stringify(savedPath)}) throw new Error("Disposable document remained open"); return true; })()`,
                "close exact disposable Canvas FLA",
            );
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke and document cleanup failed") : error;
        }
    }
    for (const path of generatedPaths) {
        try {
            await unlink(path);
        } catch (error) {
            failure = failure ? new AggregateError([failure, error], "Smoke and capture cleanup failed") : error;
        }
    }
    try {
        await rm(outDir, { recursive: true });
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], "Smoke and temp cleanup failed") : error;
    }
}

if (failure) {
    throw failure;
}
console.log(`Verification tools smoke passed; disposable FLA ${flaPath} closed and temporary directory removed.`);

/** Checks that a tool response includes a PNG screenshot.
 * @param result Tool response.
 * @returns Whether a non-empty PNG image result exists.
 */
function resultHasScreenshot(result) {
    return result.content?.some((item) => item.type === "image" && item.mimeType === "image/png" && item.data);
}
