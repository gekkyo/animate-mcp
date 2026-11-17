import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSequentialBatch } from "./batch-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const README_RUNNER = path.join(ROOT, "server/verification/readme-e2e/runner.mjs");
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs the README real-Animate batch, requiring a safe empty Animate session.
 * @param options Injectable runner dependencies for focused tests.
 * @param options.runDir Evidence directory.
 * @param options.runCommand One-shot process runner.
 * @param options.readState Animate process and document probe.
 * @param options.scenarioNames Ordered README scenario names.
 * @param options.provider README CLI provider.
 * @param options.log Progress logger.
 * @returns Batch result and process exit code.
 */
export async function runReadmeBatch({
    runDir = path.join(
        ROOT,
        "verification-runs",
        `readme-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
    ),
    runCommand = defaultRunCommand,
    readState,
    scenarioNames,
    provider = process.env.README_PROMPT_E2E_PROVIDER ?? "claude",
    log = console.log,
} = {}) {
    const { scenarios } = await import("./readme-e2e/scenarios/scenarios.mjs");
    const names = scenarioNames ?? Object.keys(scenarios);
    const entries = names.map((name) => ({
        name,
        skipReason:
            name === "testmovie" ? "Skipped: runner cleanup cannot safely close the Test Movie Player." : undefined,
    }));
    let stateReader = readState;
    let initialState;
    let preflight;
    if (provider !== "claude" && provider !== "codex") {
        preflight = { stopReason: 'README_PROMPT_E2E_PROVIDER must be "claude" or "codex".' };
    } else {
        try {
            stateReader ??= (await import("./animate-state.mjs")).readAnimateState;
            initialState = await stateReader();
            if (!initialState.running) {
                preflight = { skipReason: initialState.reason ?? "Adobe Animate is not running." };
            } else if (!initialState.responding) {
                preflight = { stopReason: initialState.reason ?? "Animate is not responding." };
            } else if (initialState.documents.length > 0) {
                preflight = { skipReason: "README scenarios require Animate to respond with no documents open." };
            }
        } catch (error) {
            preflight = { stopReason: `Animate safety check failed: ${error.message}` };
        }
    }

    /** Confirms Animate is still the original responding process with no open documents.
     * @returns Whether the README batch is safe to continue.
     */
    const checkSafety = async () => {
        try {
            const current = await stateReader();
            if (!current.running) {
                return { ok: false, reason: current.reason ?? "Animate exited during the README batch." };
            }
            if (!current.responding) {
                return { ok: false, reason: current.reason ?? "Animate stopped responding during the README batch." };
            }
            if (current.processIds.join(",") !== initialState.processIds.join(",")) {
                return { ok: false, reason: "Animate exited or restarted during the README batch." };
            }
            if (current.documents.length > 0) {
                return { ok: false, reason: "A document remained open; disposable-document cleanup may have failed." };
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: `Animate safety check failed: ${error.message}` };
        }
    };

    return runSequentialBatch({
        entries,
        runDir,
        checkSafety,
        preflight,
        log,
        run: (entry) =>
            runCommand({
                command: process.execPath,
                args: [README_RUNNER],
                cwd: ROOT,
                env: {
                    RUN_README_PROMPT_E2E: "1",
                    README_PROMPT_E2E_SCENARIO: entry.name,
                    README_PROMPT_E2E_PROVIDER: provider,
                },
                timeoutMs: COMMAND_TIMEOUT_MS,
            }),
    });
}

/**
 * Runs a paid-gated README batch or the full build, smoke, and README sequence.
 * @param mode Verification entry name.
 * @param args Command-line options.
 * @param dependencies Injectable process and suite runners.
 * @returns Verification report and process exit code.
 */
export async function runVerification(mode, args = [], dependencies = {}) {
    if (mode !== "readme" && mode !== "all") {
        return { exitCode: 2, report: { stopReason: `Unknown verification mode: ${mode}` } };
    }
    if (!args.includes("--allow-paid")) {
        const message = `Refusing to run paid README scenarios: pass --allow-paid to npm run verify:${mode}.`;
        (dependencies.log ?? console.error)(message);
        return { exitCode: 2, report: { stopReason: message } };
    }

    const cwd = dependencies.cwd ?? ROOT;
    const runDir = path.resolve(
        dependencies.runDir ??
            process.env.VERIFICATION_RUN_DIR ??
            path.join(
                cwd,
                "verification-runs",
                `verify-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
            ),
    );
    const runCommand = dependencies.runCommand ?? defaultRunCommand;
    const log = dependencies.log ?? console.log;
    await mkdir(runDir, { recursive: true });
    log(`Evidence runDir: ${runDir}`);
    const startedAt = new Date().toISOString();
    const steps = [];
    let exitCode = 0;

    const build = await runCommand({ command: "npm", args: ["run", "build"], cwd });
    await writeCommandLog(runDir, "build.log", build);
    steps.push({ name: "build", status: build.exitCode === 0 ? "PASS" : "FAIL", exitCode: build.exitCode });
    if (build.exitCode !== 0) {
        exitCode = 1;
        steps.push({ name: "smoke", status: "NOT_RUN" });
        steps.push({ name: "readme", status: "NOT_RUN" });
    } else if (mode === "all") {
        let smoke;
        try {
            const runner = dependencies.runSmokeBatch ?? (await import("./smoke/smoke-all.mjs")).runSmokeBatch;
            smoke = await runner({ runDir: path.join(runDir, "smoke"), log, printEvidence: false });
        } catch (error) {
            smoke = { exitCode: 1, report: { stopReason: error.message } };
        }
        steps.push({ name: "smoke", status: batchStatus(smoke.report), ...smoke.report });
        if (smoke.exitCode !== 0) {
            exitCode = 1;
            steps.push({ name: "readme", status: "NOT_RUN" });
        }
    }

    if (!exitCode) {
        let readme;
        try {
            const runner = dependencies.runReadmeBatch ?? runReadmeBatch;
            readme = await runner({
                runDir: path.join(runDir, "readme"),
                runCommand,
                readState: dependencies.readState,
                scenarioNames: dependencies.scenarioNames,
                provider: dependencies.provider,
                log,
            });
        } catch (error) {
            readme = { exitCode: 1, report: { stopReason: error.message } };
        }
        steps.push({ name: "readme", status: batchStatus(readme.report), ...readme.report });
        exitCode = readme.exitCode;
    }

    const report = { startedAt, finishedAt: new Date().toISOString(), mode, steps, exitCode };
    try {
        await writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        log(`Could not write verification summary: ${error.message}`);
        exitCode = 1;
        report.exitCode = 1;
    }
    return { report, exitCode };
}

/**
 * Runs one process without retrying and captures its output for the evidence log.
 * @param options Child command, working directory, environment and timeout.
 * @param options.command Executable.
 * @param options.args Command arguments.
 * @param options.cwd Working directory.
 * @param options.env Environment overrides.
 * @param options.timeoutMs Process timeout in milliseconds.
 * @returns Child process result.
 */
function defaultRunCommand({ command, args, cwd, env, timeoutMs = COMMAND_TIMEOUT_MS }) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["inherit", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let killTimer;
        /**
         * Completes the command once and releases its timeout.
         * @param result Command outcome.
         * @returns Nothing.
         */
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            clearTimeout(killTimer);
            resolve(result);
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", (error) => finish({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` }));
        child.on("close", (code) => finish({ exitCode: code, stdout, stderr }));
        const timeout = setTimeout(() => {
            stderr += `\nTimed out after ${timeoutMs} ms.`;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        }, timeoutMs);
    });
}

/**
 * Writes a command's captured output to its evidence log.
 * @param runDir Run evidence directory.
 * @param filename Log filename.
 * @param result Process output.
 * @returns Resolves after the log is written.
 */
async function writeCommandLog(runDir, filename, result) {
    await writeFile(path.join(runDir, filename), `${result.stdout ?? ""}${result.stderr ?? ""}`);
}

/**
 * Summarizes item outcomes without treating skipped checks as passes.
 * @param report Batch report.
 * @returns Batch status.
 */
function batchStatus(report = {}) {
    const results = report.results ?? [];
    if (results.some(({ status }) => status === "FAIL") || report.stopReason) {
        return "FAIL";
    }
    if (results.some(({ status }) => status === "PASS")) {
        return "PASS";
    }
    return results.length > 0 && results.every(({ status }) => status === "SKIP") ? "SKIP" : "NOT_RUN";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const result = await runVerification(process.argv[2], process.argv.slice(3));
    process.exitCode = result.exitCode;
}
