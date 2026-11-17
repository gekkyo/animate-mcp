// Manual paid check: npm run build && RUN_README_PROMPT_E2E=1 node server/verification/readme-e2e/runner.mjs
// Select with README_PROMPT_E2E_SCENARIO=layer|stage|script|investigate|text|tween|instance|symbol|inspect|library|capture|assets|publish|testmovie|canvas (default: layer).
// Set README_PROMPT_E2E_PROVIDER=codex to opt into Codex; Claude is the default.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAnimateRunning } from "../../dist/runtime/animate-launcher.js";
import { registerGetDocumentInfo } from "../../dist/tools/document/get-document-info.js";
import { registerGetStatus } from "../../dist/tools/document/get-status.js";
import { registerOpenDocument } from "../../dist/tools/document/open-document.js";
import { registerSaveDocument } from "../../dist/tools/document/save-document.js";
import { registerRunJsfl } from "../../dist/tools/run-jsfl.js";
import { registerEditTween } from "../../dist/tools/timeline/edit-tween.js";
import { registerInspectTimeline } from "../../dist/tools/timeline/inspect-timeline.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "../smoke/smoke-lib.mjs";
import { runClaude } from "./claude.mjs";
import { runCodex } from "./codex.mjs";
import { writeReadmeDiagnostic } from "./diagnostics.mjs";
import { serveRestricted } from "./mcp-server.mjs";
import { assertChromeInstalled, closeTestMoviePlayer } from "./output.mjs";
import {
    prepareScenario,
    scenarioIsReadOnly,
    scenarioMessage,
    scenarioNeedsPlayerCleanup,
    scenarioRequiresChrome,
    verifyScenario,
    verifyScenarioPersistence,
} from "./scenario-lifecycle.mjs";
import { createAssetsFixture, scenarios, selectedScenario } from "./scenarios.mjs";

const scriptPath = fileURLToPath(import.meta.url);

/** Resolves the explicitly selected CLI provider, keeping Claude as the default.
 * @param provider Provider name from the environment.
 * @returns Validated provider name.
 */
export function readmeE2eProvider(provider = process.env.README_PROMPT_E2E_PROVIDER ?? "claude") {
    if (provider !== "claude" && provider !== "codex") {
        throw new Error('README_PROMPT_E2E_PROVIDER must be "claude" or "codex".');
    }
    return provider;
}

/** Combines cleanup errors without discarding safe diagnostics from the primary failure.
 * @param primary Original E2E or fixture failure.
 * @param cleanup Cleanup failure.
 * @param message Aggregate error message.
 * @returns Combined error preserving the first safe diagnostic.
 */
export function aggregateFailure(primary, cleanup, message) {
    const aggregate = new AggregateError([primary, cleanup], message);
    const diagnostic = primary?.diagnostic ?? cleanup?.diagnostic;
    if (diagnostic) {
        aggregate.diagnostic = diagnostic;
    }
    return aggregate;
}

/** Runs the manually approved CLI/Animate E2E.
 * @returns Resolves after persistence verification and cleanup.
 */
async function main() {
    const provider = readmeE2eProvider();
    const scenarioName = process.env.README_PROMPT_E2E_SCENARIO ?? "layer";
    const scenario = selectedScenario(scenarioName);
    if (process.argv.includes("--mcp-server")) {
        return serveRestricted();
    }
    if (process.env.RUN_README_PROMPT_E2E !== "1") {
        throw new Error(`Set RUN_README_PROMPT_E2E=1 only after approving the paid ${provider} CLI run.`);
    }
    if (!(await isAnimateRunning())) {
        throw new Error("Start Adobe Animate before running this test.");
    }

    const status = toolHandler(registerGetStatus);
    const before = (await status({})).structuredContent;
    if (before?.animate !== "responding" || before.documents?.length !== 0) {
        throw new Error("Safety check failed: Animate must respond with no documents open.");
    }
    if (scenarioRequiresChrome(scenarioName)) {
        await assertChromeInstalled();
    }

    const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-readme-e2e-"));
    const flaPath = join(outDir, `${basename(outDir)}.fla`);
    const tracePath = join(outDir, "trace.jsonl");
    const configPath = join(outDir, "mcp.json");
    const runJsfl = toolHandler(registerRunJsfl);
    const saveDocument = toolHandler(registerSaveDocument);
    const openDocument = toolHandler(registerOpenDocument);
    const inspectTimeline = toolHandler(registerInspectTimeline);
    const getDocumentInfo = toolHandler(registerGetDocumentInfo);
    const editTween = toolHandler(registerEditTween);
    const state = {};
    let pathURI = "";
    let failure;
    let stage = "fixture";
    try {
        const assetsFixture = scenario === scenarios.assets ? await createAssetsFixture(outDir) : undefined;
        if (provider === "claude") {
            await writeFile(
                configPath,
                JSON.stringify({
                    mcpServers: {
                        "animate-readme-e2e": { command: process.execPath, args: [scriptPath, "--mcp-server"] },
                    },
                }),
            );
        }
        if (scenario === scenarios.canvas) {
            const created = await openDocument({ type: "htmlcanvas" });
            if (created.isError || !created.structuredContent?.name) {
                throw new Error("Could not create disposable HTML5 Canvas document");
            }
            const saved = await saveDocument({ document: created.structuredContent.name, path: flaPath });
            if (saved.isError || !saved.structuredContent?.path) {
                throw new Error("Could not save disposable HTML5 Canvas document");
            }
            pathURI = saved.structuredContent.path;
            const documents = (await status({})).structuredContent?.documents ?? [];
            if (documents.length !== 1 || documents[0].path !== pathURI) {
                throw new Error("Safety check failed: the saved Canvas FLA is not the only open document.");
            }
        } else {
            pathURI = (await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, scenario.initialScript ?? ""))
                .pathURI;
        }
        const setupContext = {
            runJsfl,
            status,
            saveDocument,
            flaPath,
            outDir,
            editTween,
            inspectTimeline,
            getDocumentInfo,
        };
        await prepareScenario(scenarioName, { ...setupContext, pathURI }, state);
        const opened = (await status({})).structuredContent?.documents ?? [];
        if (opened.length !== 1 || opened[0].path !== pathURI) {
            throw new Error("Safety check failed: the only open Animate document is not the disposable FLA.");
        }
        const runScenario = assetsFixture ? { ...scenario, prompt: assetsFixture.prompt } : scenario;
        stage = "cli";
        const cliResult =
            provider === "claude"
                ? await runClaude(configPath, tracePath, pathURI, {
                      scenario: runScenario,
                      outDir,
                      assetPaths: assetsFixture?.paths,
                  })
                : await runCodex(scriptPath, tracePath, pathURI, {
                      scenario: runScenario,
                      outDir,
                      assetPaths: assetsFixture?.paths,
                  });
        stage = "verify";
        if (scenarioNeedsPlayerCleanup(scenarioName)) {
            await closeTestMoviePlayer(runJsfl, status, pathURI);
        }
        const trace = await readFile(tracePath, "utf8");
        await verifyScenario(scenarioName, { ...setupContext, pathURI, state, trace, claudeResult: cliResult });
        if (scenarioIsReadOnly(scenarioName)) {
            console.log(scenarioMessage(scenarioName));
            return;
        }
        const saved = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
        if (saved.isError) {
            throw new Error("Could not save disposable FLA");
        }
        await closeDocumentByPath(runJsfl, pathURI);
        pathURI = "";
        const reopened = await openDocument({ path: flaPath });
        if (reopened.isError) {
            throw new Error("Could not reopen disposable FLA");
        }
        pathURI = reopened.structuredContent?.path;
        if (!pathURI) {
            throw new Error("Animate returned no path for the reopened disposable FLA");
        }
        await verifyScenarioPersistence(scenarioName, { ...setupContext, pathURI, state });
        console.log(scenarioMessage(scenarioName));
    } catch (error) {
        failure = error;
    } finally {
        if (pathURI) {
            if (scenarioNeedsPlayerCleanup(scenarioName)) {
                try {
                    await closeTestMoviePlayer(runJsfl, status, pathURI);
                } catch (error) {
                    if (!failure) {
                        stage = "cleanup";
                    }
                    failure = failure ? aggregateFailure(failure, error, "E2E and Player cleanup failed") : error;
                }
            }
            try {
                await closeDocumentByPath(runJsfl, pathURI);
                pathURI = "";
            } catch (error) {
                if (!failure) {
                    stage = "cleanup";
                }
                failure = failure ? aggregateFailure(failure, error, "E2E and document cleanup failed") : error;
            }
        }
        if (!pathURI) {
            try {
                const finalStatus = (await status({})).structuredContent;
                if (finalStatus?.documents?.length !== 0) {
                    if (!failure) {
                        stage = "cleanup";
                    }
                    failure = failure ?? new Error("Animate state is uncertain; temporary files left intact.");
                } else {
                    const trace = await readFile(tracePath, "utf8").catch(() => "");
                    for (const line of trace.trim().split("\n").filter(Boolean)) {
                        console.log(`TRACE ${line}`);
                    }
                    await rm(outDir, { recursive: true });
                }
            } catch (error) {
                if (!failure) {
                    stage = "cleanup";
                }
                failure = failure ? aggregateFailure(failure, error, "E2E and temporary-file cleanup failed") : error;
            }
        } else {
            if (!failure) {
                stage = "cleanup";
            }
            failure = failure ?? new Error(`Disposable FLA remains open; files left at ${outDir}`);
        }
        let fallbackErrorCategory;
        if (failure) {
            if (stage === "cli") {
                fallbackErrorCategory = "cli";
            } else if (stage === "verify") {
                fallbackErrorCategory = "verification";
            } else if (stage === "cleanup") {
                fallbackErrorCategory = "cleanup";
            } else {
                fallbackErrorCategory = "fixture";
            }
        }
        await writeReadmeDiagnostic({
            ...(failure?.diagnostic ?? {}),
            event: "run",
            outcome: failure ? "failed" : "passed",
            stage: failure ? stage : "cleanup",
            provider,
            scenario: scenarioName,
            errorCategory: failure?.diagnostic?.errorCategory ?? fallbackErrorCategory,
        });
    }
    if (failure) {
        throw failure;
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
