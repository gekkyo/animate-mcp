// Disposable real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-air-descriptor.mjs`.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAnimateRunning } from "../dist/runtime/animate-launcher.js";
import { registerOpenDocument } from "../dist/tools/document/open-document.js";
import { registerGetAirDescriptor } from "../dist/tools/output/get-air-descriptor.js";
import { registerSetAirDescriptor } from "../dist/tools/output/set-air-descriptor.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { closeDocumentByPath, toolHandler } from "./smoke-lib.mjs";

assert.equal(await isAnimateRunning(), true, "Animate must already be running; refusing to launch it");

const source = join(process.cwd(), "air-sample");
const openDocument = toolHandler(registerOpenDocument);
const getAirDescriptor = toolHandler(registerGetAirDescriptor);
const setAirDescriptor = toolHandler(registerSetAirDescriptor);
const runJsfl = toolHandler(registerRunJsfl);
/** Returns the first text response from a tool.
 * @param result Tool response.
 * @returns Response text or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Checks a tool response and returns its structured payload.
 * @param result Tool response.
 * @param description Operation description.
 * @returns Structured tool payload.
 */
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-air-descriptor-"));
const flaPath = join(outDir, "desktop.fla");
const descriptorPath = join(outDir, "desktop-app.xml");
const iconPath = join(outDir, "icon", "icon128.png");
let documentPathURI;
let failure;

try {
    await copyFile(join(source, "desktop.fla"), flaPath);
    await copyFile(join(source, "desktop-app.xml"), descriptorPath);
    await mkdir(join(outDir, "icon"));
    await copyFile(join(source, "icon", "icon128.png"), iconPath);

    const original = await readFile(descriptorPath);
    const opened = verifyTool(await openDocument({ path: flaPath }), "open disposable AIR FLA");
    assert.ok(opened.name, "open_document returned no document name");
    documentPathURI = opened.path;
    assert.ok(documentPathURI, "Animate did not return a normalized pathURI");

    const before = verifyTool(await getAirDescriptor({ document: opened.name }), "get descriptor before edit");
    assert.equal(before.id, "test-desktop");
    const dryRun = verifyTool(
        await setAirDescriptor({ document: opened.name, versionLabel: "Smoke", dryRun: true }),
        "dryRun descriptor edit",
    );
    assert.equal(dryRun.dryRun, true);
    assert.deepEqual(await readFile(descriptorPath), original, "dryRun changed the descriptor");
    await stat(`${descriptorPath}.bak`).then(
        () => assert.fail("dryRun unexpectedly created a backup"),
        (error) => assert.equal(error.code, "ENOENT"),
    );

    const written = verifyTool(
        await setAirDescriptor({ document: opened.name, versionLabel: "Smoke" }),
        "write descriptor edit",
    );
    assert.equal(written.dryRun, false);
    assert.deepEqual(await readFile(`${descriptorPath}.bak`), original, "backup does not match original descriptor");
    const after = verifyTool(await getAirDescriptor({ document: opened.name }), "get descriptor after edit");
    assert.equal(after.versionLabel, "Smoke", "written value did not round-trip");
    console.log(`AIR descriptor get/set smoke passed (${documentPathURI}).`);
} catch (error) {
    failure = error;
} finally {
    if (documentPathURI) {
        try {
            await closeDocumentByPath(runJsfl, documentPathURI);
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
console.log("Disposable AIR FLA closed by exact pathURI; temp directory removed.");
