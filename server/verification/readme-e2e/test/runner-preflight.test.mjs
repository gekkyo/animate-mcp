import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { aggregateFailure, prepareReadmeE2eScenario, runFixturePreflight } from "../runner.mjs";
import { CANVAS_FRAME_SCRIPT } from "../scenarios/scenarios.mjs";

/** Returns a fake status handler scoped to one disposable document.
 * @param pathURI Disposable document URI.
 * @returns Status handler for fixture preparation.
 */
function statusFor(pathURI) {
    return async () => ({
        structuredContent: { documents: [{ path: pathURI, name: "preflight.fla" }] },
    });
}

/** Creates a fake JSFL handler that returns the supplied fixture responses in order.
 * @param pathURI Disposable document URI.
 * @param responses Ordered JSFL return values.
 * @returns JSFL handler.
 */
function jsflResponses(pathURI, responses) {
    let index = 0;
    return async () => ({
        structuredContent: { result: responses[index++] ?? `preflight\t${pathURI}` },
    });
}

test("shared fixture setup dispatches capture, initial-script, Canvas, and assets fixtures without Animate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-fixture-dispatch-"));
    const pathURI = "file:///tmp/readme-e2e-preflight.fla";
    const status = statusFor(pathURI);
    try {
        const captureState = {};
        const captureReport = "シーン 1\t12\t550\t400\t1\tshape\t165\t90\t250\t100";
        const capture = await prepareReadmeE2eScenario(
            "capture",
            {
                runJsfl: jsflResponses(pathURI, [`preflight.fla\t${pathURI}`, "READY", captureReport]),
                status,
                flaPath: join(directory, "capture.fla"),
                outDir: directory,
            },
            captureState,
        );
        assert.equal(capture.scenario.prompt, "シーン1の12フレーム目を画像で取得して、見た目を教えて");
        assert.equal(capture.pathURI, pathURI);
        assert.equal(captureState.captureBefore, captureReport);
        assert.equal(captureState.captureTimeline, "シーン 1");

        const scriptState = {};
        const scriptSource = "trace('README_TEST_MOVIE_OK');";
        const script = await prepareReadmeE2eScenario(
            "testmovie",
            {
                runJsfl: jsflResponses(pathURI, [`preflight.fla\t${pathURI}`, scriptSource]),
                status,
                flaPath: join(directory, "testmovie.fla"),
                outDir: directory,
            },
            scriptState,
        );
        assert.equal(script.scenario.initialScript, "trace('README_TEST_MOVIE_OK');");
        assert.equal(scriptState.testMovieBefore, scriptSource);

        const canvasState = {};
        const canvas = await prepareReadmeE2eScenario(
            "canvas",
            {
                runJsfl: jsflResponses(pathURI, [CANVAS_FRAME_SCRIPT, CANVAS_FRAME_SCRIPT, CANVAS_FRAME_SCRIPT]),
                status,
                openDocument: async () => ({ structuredContent: { name: "preflight.fla" } }),
                saveDocument: async () => ({ structuredContent: { path: pathURI } }),
                flaPath: join(directory, "canvas.fla"),
                outDir: directory,
            },
            canvasState,
        );
        assert.equal(canvas.pathURI, pathURI);
        assert.equal(canvasState.canvasBefore, CANVAS_FRAME_SCRIPT);

        const assetsState = {};
        const assets = await prepareReadmeE2eScenario(
            "assets",
            {
                runJsfl: jsflResponses(pathURI, [
                    `preflight.fla\t${pathURI}`,
                    "550\t400\t24\t#FFFFFF\n--LIBRARY--\n\n--STAGE--\n",
                ]),
                status,
                flaPath: join(directory, "assets.fla"),
                outDir: directory,
            },
            assetsState,
        );
        assert.deepEqual(
            assets.assetsFixture.paths.map((path) => path.split("/").at(-1)),
            ["hero.png", "bgm.mp3"],
        );
        assert.equal((await stat(assets.assetsFixture.paths[0])).isFile(), true);
        assert.ok(assetsState.assetsBefore);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("cleanup aggregation preserves the primary CLI diagnostic", () => {
    const timeout = new Error("CLI timeout");
    timeout.diagnostic = { errorCategory: "timeout", exitCode: 124 };
    const aggregate = aggregateFailure(timeout, new Error("cleanup failed"), "combined failure");
    assert.equal(aggregate.diagnostic.errorCategory, "timeout");
    assert.equal(aggregate.diagnostic.exitCode, 124);
});

test("fixture-preflight runner reaches selected scenario setup through fake services", async () => {
    const pathURI = "file:///tmp/readme-e2e-preflight-runner.fla";
    let documentOpen = false;
    let jsflCalls = 0;
    let diagnostic;
    await runFixturePreflight("testmovie", {
        isAnimateRunning: async () => true,
        status: async () => ({
            structuredContent: {
                animate: "responding",
                documents: documentOpen ? [{ path: pathURI, name: "preflight.fla" }] : [],
            },
        }),
        runJsfl: async () => {
            jsflCalls += 1;
            if (jsflCalls === 1) {
                documentOpen = true;
                return { structuredContent: { result: `preflight.fla\t${pathURI}` } };
            }
            return { structuredContent: { result: "trace('README_TEST_MOVIE_OK');" } };
        },
        closeDocumentByPath: async (_, requestedPath) => {
            assert.equal(requestedPath, pathURI);
            documentOpen = false;
        },
        checkRestrictedMcpHandshake: async ({ scenarioName, env, captureFrame }) => {
            assert.equal(scenarioName, "testmovie");
            assert.equal(env.README_E2E_DOCUMENT_URI, pathURI);
            assert.equal(captureFrame, false);
            return { toolsCount: 3 };
        },
        writeReadmeDiagnostic: async (record) => {
            diagnostic = record;
        },
        log: () => {},
    });
    assert.equal(jsflCalls, 2);
    assert.equal(documentOpen, false);
    assert.equal(diagnostic.scenario, "testmovie");
    assert.equal(diagnostic.outcome, "passed");
    assert.equal(diagnostic.mcpHandshake, "passed");
});

test("fixture-preflight classifies a cleanup-only failure as cleanup", async () => {
    const pathURI = "file:///tmp/readme-e2e-preflight-cleanup.fla";
    let documentOpen = false;
    let diagnostic;
    await assert.rejects(
        runFixturePreflight("layer", {
            isAnimateRunning: async () => true,
            status: async () => ({
                structuredContent: {
                    animate: "responding",
                    documents: documentOpen ? [{ path: pathURI, name: "preflight.fla" }] : [],
                },
            }),
            runJsfl: async () => {
                documentOpen = true;
                return { structuredContent: { result: `preflight.fla\t${pathURI}` } };
            },
            checkRestrictedMcpHandshake: async () => ({ toolsCount: 3 }),
            closeDocumentByPath: async () => {
                documentOpen = false;
                throw new Error("Synthetic cleanup failure");
            },
            writeReadmeDiagnostic: async (record) => {
                diagnostic = record;
            },
            log: () => {},
        }),
        /Synthetic cleanup failure/,
    );
    assert.equal(diagnostic.outcome, "failed");
    assert.equal(diagnostic.stage, "cleanup");
    assert.equal(diagnostic.errorCategory, "cleanup");
});
