// Real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-capture-frame.mjs [frame] [dir]` or `--range start:end[:step] [dir]`.
// Creates and closes a temporary saved 5-frame document by exact path; never publishes. Animate must be running.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerCaptureFrame } from "../../../dist/tools/output/capture-frame.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "../lib/smoke-lib.mjs";

const handle = toolHandler(registerCaptureFrame);
const runJsfl = toolHandler(registerRunJsfl);
/** Executes JSFL and returns its result, throwing on tool errors.
 * @param code JSFL source to execute.
 * @returns Promise resolving to the JSFL result.
 */
const executeJsfl = async (code) => {
    const result = await runJsfl({ code });
    if (result.isError) {
        throw new Error(result.content[0]?.type === "text" ? result.content[0].text : "run_jsfl failed");
    }
    return result.structuredContent.result;
};
const args = process.argv.slice(2);
let input, dir;
if (args[0] === "--range") {
    const values = args[1]?.split(":").map(Number) ?? [];
    if (
        (values.length !== 2 && values.length !== 3) ||
        values.some((value) => !Number.isInteger(value) || value < 1) ||
        values[1] < values[0]
    ) {
        throw new Error("Use --range start:end[:step] with positive ascending integers");
    }
    input = { range: { start: values[0], end: values[1], ...(values[2] === undefined ? {} : { step: values[2] }) } };
    dir = args[2];
} else {
    const [frameArg, dirArg] = args;
    input = frameArg ? { frame: Number(frameArg) } : {};
    dir = dirArg;
}

const disposableDir = dir ? undefined : await mkdtemp(join(tmpdir(), "animate-mcp-capture-smoke-"));
const documentDir = await mkdtemp(join(tmpdir(), "animate-mcp-capture-document-"));
const flaPath = join(documentDir, "capture-frame.fla");
let disposable;
try {
    disposable = await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, "");
    // fl.setActiveWindow takes effect only after the Run returns, so setup is its own Run.
    await executeJsfl(
        `(function () { var __documents = fl.documents || [], __smokeDoc = null; for (var __index = 0; __index < __documents.length; __index++) if (__documents[__index].pathURI === ${JSON.stringify(disposable.pathURI)}) __smokeDoc = __documents[__index]; if (!__smokeDoc) throw new Error("Disposable capture smoke document not found"); __smokeDoc.getTimeline().insertFrames(4, true, 0); fl.setActiveWindow(__smokeDoc); return __smokeDoc.name; })()`,
    );
    if ("range" in input) {
        const originalFrame = Number(await executeJsfl("fl.getDocumentDOM().getTimeline().currentFrame"));
        const frameCount = Number(await executeJsfl("fl.getDocumentDOM().getTimeline().frameCount"));
        if (!Number.isInteger(originalFrame) || !Number.isInteger(frameCount) || frameCount < 2) {
            throw new Error("Smoke document has fewer than two frames");
        }
        const nonDefaultFrame = originalFrame === 0 ? 1 : 0;
        try {
            const setFrame = Number(
                await executeJsfl(
                    `(function () { var timeline = fl.getDocumentDOM().getTimeline(); timeline.currentFrame = ${nonDefaultFrame}; return timeline.currentFrame; })()`,
                ),
            );
            assert.equal(setFrame, nonDefaultFrame, "failed to set a non-default current frame");

            const result = await handle({ ...input, dir: dir ?? disposableDir });
            if (result.isError) {
                throw new Error(result.content[0]?.type === "text" ? result.content[0].text : "capture_frame failed");
            }
            const captures = result.structuredContent.captures;
            const { start, end, step = 1 } = input.range;
            const expectedFrames = [];
            for (let frame = start; frame <= end; frame += step) {
                expectedFrames.push(frame);
            }
            assert.deepEqual(
                captures.map(({ frame }) => frame),
                expectedFrames,
            );
            const images = result.content.filter((item) => item.type === "image");
            const metadata = result.content.filter((item) => item.type === "text");
            assert.equal(images.length, captures.length);
            assert.equal(metadata.length, captures.length);
            for (let index = 0; index < captures.length; index++) {
                assert.deepEqual(JSON.parse(metadata[index].text), captures[index]);
                assert.deepEqual(await readFile(captures[index].path), Buffer.from(images[index].data, "base64"));
            }
            const restoredFrame = Number(await executeJsfl("fl.getDocumentDOM().getTimeline().currentFrame"));
            assert.equal(restoredFrame, nonDefaultFrame, "capture_frame did not restore the pre-capture frame");
            console.log(JSON.stringify(captures));
        } finally {
            await executeJsfl(`fl.getDocumentDOM().getTimeline().currentFrame = ${originalFrame}`);
        }
    } else {
        const result = await handle({ ...input, dir: dir ?? disposableDir });
        if (result.isError) {
            throw new Error(result.content[0]?.type === "text" ? result.content[0].text : "capture_frame failed");
        }
        const image = result.content.find((item) => item.type === "image");
        const text = result.content.find((item) => item.type === "text");
        if (image?.type !== "image" || !text || text.type !== "text") {
            throw new Error("Missing image or metadata content");
        }
        const metadata = JSON.parse(text.text);
        assert.deepEqual(await readFile(metadata.path), Buffer.from(image.data, "base64"));
        console.log(JSON.stringify(metadata));
    }
} finally {
    if (disposableDir) {
        await rm(disposableDir, { recursive: true, force: true });
    }
    if (disposable) {
        await closeDocumentByPath(runJsfl, disposable.pathURI);
    }
    await rm(documentDir, { recursive: true, force: true });
}
