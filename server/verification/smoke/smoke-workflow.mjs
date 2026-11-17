// Disposable real-Animate workflow smoke test (not in CI): `npm run build && node server/verification/smoke/smoke-workflow.mjs`.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerCloseDocument } from "../../dist/tools/document/close-document.js";
import { registerOpenDocument } from "../../dist/tools/document/open-document.js";
import { registerSaveDocument } from "../../dist/tools/document/save-document.js";
import { registerRunJsfl } from "../../dist/tools/run-jsfl.js";
import { registerApplyScripts } from "../../dist/tools/scripts/apply-scripts.js";
import { registerExportScripts } from "../../dist/tools/scripts/export-scripts.js";
import { registerEditTimeline } from "../../dist/tools/timeline/edit-timeline.js";
import { registerInspectTimeline } from "../../dist/tools/timeline/inspect-timeline.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const openDocument = toolHandler(registerOpenDocument);
const saveDocument = toolHandler(registerSaveDocument);
const closeDocument = toolHandler(registerCloseDocument);
const exportScripts = toolHandler(registerExportScripts);
const applyScripts = toolHandler(registerApplyScripts);
const editTimeline = toolHandler(registerEditTimeline);
const inspectTimeline = toolHandler(registerInspectTimeline);

/** Extracts the first text result from a tool response.
 * @param result Tool response.
 * @returns Text content or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts a successful tool response and returns its structured payload.
 * @param result Tool response.
 * @param step Workflow step description.
 * @returns Structured tool response.
 */
const verifyTool = (result, step) => {
    assert.equal(result.isError, undefined, `${step}: ${message(result)}`);
    assert.ok(result.structuredContent, `${step} returned no structured content`);
    return result.structuredContent;
};
/** Reads the disposable document's frame-one script from Animate.
 * @param pathURI Exact document path URI.
 * @returns Promise resolving to the frame script source.
 */
const readFrameScript = async (pathURI) => {
    const result = await runJsfl({
        code: `(function () { var __docs = fl.documents || [], __doc = null; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === ${JSON.stringify(pathURI)}) __doc = __docs[__i]; if (!__doc) throw new Error("Workflow FLA is not open"); var __layers = __doc.getTimeline().layers, __scripts = []; for (__i = 0; __i < __layers.length; __i++) __scripts.push(String(__layers[__i].frames[0].actionScript || "")); return __scripts.join("\\n"); })()`,
    });
    assert.equal(result.isError, undefined, `read frame script: ${message(result)}`);
    return result.structuredContent?.result;
};

const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-workflow-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
const exportDir = join(outDir, "export");
const initialScript = 'trace("workflow initial");';
const editedScript = 'trace("workflow edited");';
let savedPath = "";
let documentOpen = false;
let failure;

try {
    const created = await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, initialScript);
    savedPath = created.pathURI;
    documentOpen = true;
    console.log(`PASS create saved disposable AS3 FLA: ${created.name}`);

    const exported = verifyTool(
        await exportScripts({ document: created.name, dir: exportDir, force: true }, { _meta: {} }),
        "export_scripts",
    );
    assert.deepEqual(exported.failed, [], `export_scripts failures: ${JSON.stringify(exported.failed)}`);
    const manifest = JSON.parse(await readFile(join(exportDir, ".export.json"), "utf8"));
    const [relativeScript] =
        Object.entries(manifest.files).find(([, entry]) => entry.scene === 0 && entry.script.includes(initialScript)) ??
        [];
    assert.ok(relativeScript, "exported scene's frame script was not found");
    const scriptFile = join(exportDir, relativeScript);
    const source = await readFile(scriptFile, "utf8");
    assert.ok(source.includes(initialScript), "exported frame script did not contain the initial marker");
    await writeFile(scriptFile, source.replace(initialScript, editedScript));
    console.log("PASS export_scripts -> edit exported frame script");

    const applied = verifyTool(
        await applyScripts({ dir: exportDir, document: created.name }, { _meta: {} }),
        "apply_scripts",
    );
    assert.deepEqual(applied.failed, [], `apply_scripts failures: ${JSON.stringify(applied.failed)}`);
    assert.ok(
        (await readFrameScript(savedPath)).includes(editedScript),
        "applied script was not read back from Animate",
    );
    console.log("PASS apply_scripts -> verify applied frame script");

    const layerName = "WorkflowPersistedLayer";
    const edited = verifyTool(
        await editTimeline({
            document: created.name,
            timeline: 0,
            ops: [{ op: "addLayer", name: layerName }],
        }),
        "edit_timeline add layer",
    );
    assert.equal(edited.failed, null, `edit_timeline failed: ${JSON.stringify(edited.failed)}`);
    const layers = verifyTool(
        await inspectTimeline({ document: created.name, timeline: 0, frame: 1 }),
        "inspect edited timeline",
    ).layers;
    assert.ok(
        layers.some((entry) => entry.name === layerName),
        "timeline edit was not visible",
    );
    console.log("PASS edit_timeline -> inspect_timeline");

    verifyTool(await saveDocument({ document: savedPath, path: flaPath, confirm: true }), "save_document");
    assert.ok((await stat(flaPath)).size > 0, "saved FLA is empty");
    verifyTool(
        await closeDocument({ document: savedPath, discardUnsavedChanges: true }),
        "close_document before reopen",
    );
    documentOpen = false;
    console.log("PASS save_document -> close_document");

    const reopened = verifyTool(await openDocument({ path: flaPath }), "reopen_document");
    assert.ok(reopened.name && reopened.path, "reopened document details are missing");
    savedPath = reopened.path;
    documentOpen = true;
    assert.ok((await readFrameScript(savedPath)).includes(editedScript), "frame script did not persist after reopen");
    const reopenedLayers = verifyTool(
        await inspectTimeline({ document: reopened.name, timeline: 0, frame: 1 }),
        "inspect reopened timeline",
    ).layers;
    assert.ok(
        reopenedLayers.some((entry) => entry.name === layerName),
        "timeline edit did not persist after reopen",
    );
    console.log("PASS reopen -> verify persisted script and timeline edit");
    verifyTool(
        await closeDocument({ document: savedPath, discardUnsavedChanges: true }),
        "close reopened disposable FLA",
    );
    documentOpen = false;
    console.log("PASS close reopened disposable FLA");
} catch (error) {
    failure = error;
} finally {
    if (savedPath && documentOpen) {
        try {
            await closeDocumentByPath(runJsfl, savedPath);
        } catch (error) {
            console.error("Disposable FLA cleanup failed:", error);
            failure = failure ? new AggregateError([failure, error], "Workflow and cleanup both failed") : error;
        }
    }
    try {
        await rm(outDir, { recursive: true, force: true });
        await assert.rejects(stat(outDir), { code: "ENOENT" });
        console.log(`Cleaned temporary workflow directory: ${outDir}`);
    } catch (error) {
        console.error("Temporary directory cleanup failed:", error);
        failure = failure ? new AggregateError([failure, error], "Workflow and file cleanup both failed") : error;
    }
}

if (failure) {
    throw failure;
}
console.log(`Workflow smoke passed (disposable FLA: ${flaPath})`);
