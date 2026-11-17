import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSequentialBatch } from "../batch-lib.mjs";
import { runSmokeBatch } from "../smoke/smoke-all.mjs";
import { runPromptBatch, runVerification } from "../verify-batch.mjs";

/** Creates an isolated evidence directory for one focused test.
 * @returns Temporary directory path.
 */
async function temporaryDirectory() {
    return mkdtemp(join(tmpdir(), "animate-verification-batch-"));
}

test("batch runs each item once and stops after three consecutive failures", async () => {
    const runDir = await temporaryDirectory();
    let calls = 0;
    try {
        const result = await runSequentialBatch({
            entries: ["one", "two", "three", "four"].map((name) => ({ name })),
            run: async () => {
                calls++;
                return { exitCode: 1, stderr: "failed" };
            },
            checkSafety: async () => ({ ok: true }),
            runDir,
            log: () => {},
        });
        assert.equal(calls, 3);
        assert.deepEqual(
            result.report.results.map(({ status }) => status),
            ["FAIL", "FAIL", "FAIL", "NOT_RUN"],
        );
        assert.equal(result.report.stopReason, "Stopped after 3 consecutive failures.");
        assert.equal(result.exitCode, 1);
        assert.equal(JSON.parse(await readFile(join(runDir, "summary.json"), "utf8")).exitCode, 1);
        assert.match(await readFile(join(runDir, "one.log"), "utf8"), /failed/);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("batch stops immediately after an Animate restart or disposable cleanup failure", async () => {
    for (const reason of ["Animate exited or restarted.", "Disposable cleanup failed."]) {
        const runDir = await temporaryDirectory();
        let calls = 0;
        let phaseCount = 0;
        try {
            const result = await runSequentialBatch({
                entries: [{ name: "first" }, { name: "second" }],
                run: async () => {
                    calls++;
                    return { exitCode: 0 };
                },
                checkSafety: async (_entry, phase) => {
                    phaseCount++;
                    return phase === "after" ? { ok: false, reason } : { ok: true };
                },
                runDir,
                log: () => {},
            });
            assert.equal(calls, 1);
            assert.equal(phaseCount, 2);
            assert.equal(result.report.results[0].status, "FAIL");
            assert.equal(result.report.results[1].status, "NOT_RUN");
            assert.equal(result.report.stopReason, reason);
            assert.equal(result.exitCode, 1);
        } finally {
            await rm(runDir, { recursive: true, force: true });
        }
    }
});

test("precondition skips are reported and never invoke the scenario runner", async () => {
    const runDir = await temporaryDirectory();
    let calls = 0;
    try {
        const result = await runSequentialBatch({
            entries: [{ name: "needs-document", skipReason: "No user document is open." }],
            run: async () => {
                calls++;
                return { exitCode: 0 };
            },
            checkSafety: async () => ({ ok: true }),
            runDir,
            log: () => {},
        });
        assert.equal(calls, 0);
        assert.equal(result.report.results[0].status, "SKIP");
        assert.match(result.report.results[0].reason, /No user document/);
        assert.equal(result.exitCode, 1);
        assert.match(await readFile(join(runDir, "needs-document.log"), "utf8"), /SKIP/);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("smoke runs canvas, document-ops and publish from an empty session using owned anchors only where needed", async () => {
    const runDir = await temporaryDirectory();
    const documents = [];
    const events = [];
    const anchor = { name: "anchor.fla", pathURI: "file:///tmp/anchor.fla" };
    try {
        const result = await runSmokeBatch({
            requested: ["canvas", "document-ops", "publish"],
            runDir,
            platform: "darwin",
            distExists: true,
            readState: async () => ({
                running: true,
                responding: true,
                processIds: ["123"],
                documents: [...documents],
            }),
            createAnchor: async () => {
                events.push("create");
                documents.push(`${anchor.name}\t${anchor.pathURI}`);
                return anchor;
            },
            closeAnchor: async (owned) => {
                assert.equal(owned, anchor);
                events.push("close");
                documents.pop();
            },
            run: async (script) => {
                events.push(`run:${script.split("/").pop()}:${documents.length}`);
                return { exitCode: 0 };
            },
            log: () => {},
        });
        assert.deepEqual(events, [
            "create",
            "run:smoke-canvas.mjs:1",
            "close",
            "create",
            "run:smoke-document-ops.mjs:1",
            "close",
            "run:smoke-publish.mjs:0",
        ]);
        assert.deepEqual(
            result.report.results.map(({ status }) => status),
            ["PASS", "PASS", "PASS"],
        );
        assert.deepEqual(documents, []);
        assert.equal(result.exitCode, 0);
        assert.equal((await stat(join(runDir, "smoke-report.json"))).isFile(), true);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("smoke anchor failures stop before later scenarios and preserve an unsafe owned document", async () => {
    for (const stage of ["create", "child", "close"]) {
        const runDir = await temporaryDirectory();
        const documents = [];
        let runs = 0;
        let closes = 0;
        try {
            const result = await runSmokeBatch({
                requested: ["canvas", "publish"],
                runDir,
                platform: "darwin",
                distExists: true,
                readState: async () => ({
                    running: true,
                    responding: true,
                    processIds: ["123"],
                    documents: [...documents],
                }),
                createAnchor: async () => {
                    if (stage === "create") {
                        throw new Error("fixture refused");
                    }
                    documents.push("anchor.fla\tfile:///tmp/anchor.fla");
                    return { name: "anchor.fla", pathURI: "file:///tmp/anchor.fla" };
                },
                closeAnchor: async () => {
                    closes++;
                    if (stage === "close") {
                        throw new Error("close failed");
                    }
                    documents.pop();
                },
                run: async () => {
                    runs++;
                    if (stage === "child") {
                        documents.push("unexpected.fla\tfile:///tmp/unexpected.fla");
                    }
                    return { exitCode: 0 };
                },
                log: () => {},
            });
            assert.deepEqual(
                result.report.results.map(({ status }) => status),
                ["FAIL", "NOT_RUN"],
            );
            assert.match(result.report.stopReason, /Owned smoke baseline cleanup\/safety failed/);
            assert.equal(runs, stage === "create" ? 0 : 1);
            assert.equal(closes, stage === "child" || stage === "create" ? 0 : 1);
            assert.equal(result.exitCode, 1);
        } finally {
            await rm(runDir, { recursive: true, force: true });
        }
    }
});

test("a failed smoke child still closes its owned anchor before reporting the failure", async () => {
    const runDir = await temporaryDirectory();
    const documents = [];
    let closed = 0;
    try {
        const result = await runSmokeBatch({
            requested: ["canvas", "publish"],
            runDir,
            platform: "darwin",
            distExists: true,
            readState: async () => ({
                running: true,
                responding: true,
                processIds: ["123"],
                documents: [...documents],
            }),
            createAnchor: async () => {
                documents.push("anchor.fla\tfile:///tmp/anchor.fla");
                return { name: "anchor.fla", pathURI: "file:///tmp/anchor.fla" };
            },
            closeAnchor: async () => {
                closed++;
                documents.pop();
            },
            run: async (script) => ({ exitCode: script.endsWith("smoke-canvas.mjs") ? 1 : 0 }),
            log: () => {},
        });
        assert.equal(closed, 1);
        assert.deepEqual(documents, []);
        assert.deepEqual(
            result.report.results.map(({ status }) => status),
            ["FAIL", "PASS"],
        );
        assert.equal(result.exitCode, 1);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("prompt batch includes testmovie and runs each selected scenario once in an empty session", async () => {
    const runDir = await temporaryDirectory();
    let stateReads = 0;
    const ran = [];
    try {
        const result = await runPromptBatch({
            runDir,
            scenarioNames: ["layer", "testmovie", "stage"],
            readState: async () => {
                stateReads++;
                return { running: true, responding: true, processIds: ["123"], documents: [] };
            },
            runCommand: async ({ env }) => {
                ran.push(env.PROMPT_E2E_SCENARIO);
                return { exitCode: 0, stdout: "passed" };
            },
            log: () => {},
        });
        assert.deepEqual(ran, ["layer", "testmovie", "stage"]);
        assert.equal(stateReads, 7);
        assert.deepEqual(
            result.report.results.map(({ status }) => status),
            ["PASS", "PASS", "PASS"],
        );
        assert.equal(result.exitCode, 0);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("prompt batch never launches testmovie with an existing document open", async () => {
    const runDir = await temporaryDirectory();
    let calls = 0;
    try {
        const result = await runPromptBatch({
            runDir,
            scenarioNames: ["testmovie"],
            readState: async () => ({
                running: true,
                responding: true,
                processIds: ["123"],
                documents: ["User.fla\tfile:///Users/test/User.fla"],
            }),
            runCommand: async () => {
                calls++;
                return { exitCode: 0 };
            },
            log: () => {},
        });
        assert.equal(calls, 0);
        assert.equal(result.report.results[0].status, "SKIP");
        assert.match(result.report.results[0].reason, /no documents open/);
        assert.equal(result.exitCode, 1);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("prompt batch stops after a process identity change", async () => {
    const runDir = await temporaryDirectory();
    let stateReads = 0;
    let calls = 0;
    try {
        const result = await runPromptBatch({
            runDir,
            scenarioNames: ["layer", "stage"],
            readState: async () => {
                stateReads++;
                return {
                    running: true,
                    responding: true,
                    processIds: [stateReads === 3 ? "456" : "123"],
                    documents: [],
                };
            },
            runCommand: async () => {
                calls++;
                return { exitCode: 0 };
            },
            log: () => {},
        });
        assert.equal(calls, 1);
        assert.equal(result.report.results[0].status, "FAIL");
        assert.equal(result.report.results[1].status, "NOT_RUN");
        assert.match(result.report.stopReason, /restarted/);
        assert.equal(result.exitCode, 1);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("prompt batch stops when Animate becomes unresponsive or a disposable document remains", async () => {
    for (const unsafeState of [
        { running: true, responding: false, processIds: ["123"], documents: [] },
        { running: true, responding: true, processIds: ["123"], documents: ["fixture.fla\tfile:///tmp/fixture.fla"] },
    ]) {
        const runDir = await temporaryDirectory();
        let stateReads = 0;
        let calls = 0;
        try {
            const result = await runPromptBatch({
                runDir,
                scenarioNames: ["layer", "stage"],
                readState: async () => {
                    stateReads++;
                    return stateReads === 3
                        ? unsafeState
                        : { running: true, responding: true, processIds: ["123"], documents: [] };
                },
                runCommand: async () => {
                    calls++;
                    return { exitCode: 0 };
                },
                log: () => {},
            });
            assert.equal(calls, 1);
            assert.equal(result.report.results[0].status, "FAIL");
            assert.equal(result.report.results[1].status, "NOT_RUN");
            assert.equal(result.exitCode, 1);
        } finally {
            await rm(runDir, { recursive: true, force: true });
        }
    }
});

test("paid gates reject both modes before creating a run directory or spawning build", async () => {
    for (const mode of ["prompt", "all"]) {
        const parent = await temporaryDirectory();
        const runDir = join(parent, "must-not-exist");
        let calls = 0;
        try {
            const result = await runVerification(mode, [], {
                runDir,
                runCommand: async () => {
                    calls++;
                    return { exitCode: 0 };
                },
                runSmokeBatch: async () => {
                    calls++;
                    return { exitCode: 0 };
                },
                log: () => {},
            });
            assert.equal(result.exitCode, 2);
            assert.equal(calls, 0);
            await assert.rejects(stat(runDir), { code: "ENOENT" });
        } finally {
            await rm(parent, { recursive: true, force: true });
        }
    }
});

test("combined verification orders build, smoke, then prompt", async () => {
    const runDir = await temporaryDirectory();
    const calls = [];
    const logs = [];
    try {
        const result = await runVerification("all", ["--allow-paid"], {
            runDir,
            runCommand: async ({ args }) => {
                calls.push(args.join(" "));
                return { exitCode: 0, stdout: "build ok" };
            },
            runSmokeBatch: async () => {
                calls.push("smoke");
                return { exitCode: 0, report: { results: [{ name: "smoke", status: "PASS" }] } };
            },
            runPromptBatch: async () => {
                calls.push("prompt");
                return { exitCode: 0, report: { results: [{ name: "layer", status: "PASS" }] } };
            },
            log: (message) => logs.push(message),
        });
        assert.deepEqual(calls, ["run build", "smoke", "prompt"]);
        assert.deepEqual(
            result.report.steps.map(({ name, status }) => [name, status]),
            [
                ["build", "PASS"],
                ["smoke", "PASS"],
                ["prompt", "PASS"],
            ],
        );
        assert.equal(result.exitCode, 0);
        assert.equal(logs.filter((message) => message.startsWith("Evidence runDir:")).length, 1);
        assert.equal(JSON.parse(await readFile(join(runDir, "summary.json"), "utf8")).exitCode, 0);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("combined verification stops before paid prompt work after a smoke failure", async () => {
    const runDir = await temporaryDirectory();
    let promptCalls = 0;
    try {
        const result = await runVerification("all", ["--allow-paid"], {
            runDir,
            runCommand: async () => ({ exitCode: 0 }),
            runSmokeBatch: async () => ({
                exitCode: 1,
                report: { results: [{ name: "first", status: "FAIL" }] },
            }),
            runPromptBatch: async () => {
                promptCalls++;
                return { exitCode: 0, report: { results: [{ name: "layer", status: "PASS" }] } };
            },
            log: () => {},
        });
        assert.equal(promptCalls, 0);
        assert.deepEqual(
            result.report.steps.map(({ name, status }) => [name, status]),
            [
                ["build", "PASS"],
                ["smoke", "FAIL"],
                ["prompt", "NOT_RUN"],
            ],
        );
        assert.equal(result.exitCode, 1);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});

test("a thrown suite is recorded as FAIL when it has no item results", async () => {
    const runDir = await temporaryDirectory();
    let promptCalls = 0;
    try {
        const result = await runVerification("all", ["--allow-paid"], {
            runDir,
            runCommand: async () => ({ exitCode: 0 }),
            runSmokeBatch: async () => {
                throw new Error("runner import failed");
            },
            runPromptBatch: async () => {
                promptCalls++;
                return { exitCode: 0, report: { results: [{ name: "layer", status: "PASS" }] } };
            },
            log: () => {},
        });
        assert.equal(result.report.steps[1].status, "FAIL");
        assert.match(result.report.steps[1].stopReason, /runner import failed/);
        assert.equal(result.report.steps[2].status, "NOT_RUN");
        assert.equal(promptCalls, 0);
        assert.equal(result.exitCode, 1);
    } finally {
        await rm(runDir, { recursive: true, force: true });
    }
});
