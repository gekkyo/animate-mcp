import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSequentialBatch } from "../batch-lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(SCRIPT_DIR, "scenarios");
const EXCLUDED = new Set(["smoke-run.mjs"]);
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs one smoke script and captures its output and exit status.
 * @param script Path to the smoke script.
 * @returns Child process outcome.
 */
function runScript(script) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script], {
            env: process.env,
            stdio: ["inherit", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let forceKillTimer;

        /**
         * Completes the child process once and releases its timeout.
         * @param exitCode Child process exit code.
         * @returns Nothing.
         */
        const finish = (exitCode) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            clearTimeout(forceKillTimer);
            resolve({ exitCode, stdout, stderr });
        };

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", (error) => {
            stderr += error.message;
            finish(null);
        });
        child.on("close", (code) => finish(code));

        const timeout = setTimeout(() => {
            stderr += "\nTimed out after 10 minutes.";
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        }, SCRIPT_TIMEOUT_MS);
    });
}

/**
 * Returns available smoke scripts, optionally filtered by short names.
 * @param requested Names supplied on the command line.
 * @returns Selected scripts or an error.
 */
function selectScripts(requested) {
    const available = readdirSync(SCENARIO_DIR)
        .filter((file) => file.startsWith("smoke-") && file.endsWith(".mjs") && !EXCLUDED.has(file))
        .sort();
    const byName = new Map(available.map((file) => [file.slice("smoke-".length, -".mjs".length), file]));
    const unknown = requested.filter((name) => !byName.has(name));
    if (unknown.length) {
        return {
            scripts: [],
            error: `Unknown smoke script${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Available: ${[...byName.keys()].join(", ")}`,
        };
    }
    return {
        scripts: requested.length ? requested.map((name) => byName.get(name)) : available,
    };
}

/**
 * Runs selected smoke scenarios with safety checks and per-run evidence.
 * @param options Injectable runner dependencies for focused tests.
 * @param options.requested Optional names supplied on the command line.
 * @param options.runDir Evidence directory.
 * @param options.run One-shot scenario process runner.
 * @param options.readState Animate state probe.
 * @param options.platform Platform name.
 * @param options.distExists Whether the compiled server exists.
 * @param options.printEvidence Whether to print the evidence directory.
 * @param options.log Progress logger.
 * @returns Batch result and process exit code.
 */
export async function runSmokeBatch({
    requested = [],
    runDir = defaultRunDir(),
    run = runScript,
    readState,
    platform = process.platform,
    distExists = existsSync(path.resolve(process.cwd(), "server/dist")),
    printEvidence = true,
    log = console.log,
} = {}) {
    const selection = selectScripts(requested);
    if (selection.error) {
        log(selection.error);
        return { exitCode: 2, report: { results: [], stopReason: selection.error, exitCode: 2 } };
    }

    const entries = selection.scripts.map((script) => ({
        name: script.slice("smoke-".length, -".mjs".length),
        script,
        skipReason:
            script === "smoke-publish.mjs"
                ? "Skipped: publish requires explicitly naming an existing FLA; the automatic batch will not publish user documents. Use isolated-publish for disposable publish coverage."
                : undefined,
    }));
    if (printEvidence) {
        log(`Evidence runDir: ${path.resolve(runDir)}`);
    }
    let stateReader = readState;
    let initialState;
    let preflight;
    if (platform !== "darwin") {
        preflight = { skipReason: "Real-Animate smoke tests can only run on macOS." };
    } else if (!distExists) {
        preflight = { skipReason: "server/dist is missing; run `npm run build` first." };
    } else {
        try {
            stateReader ??= (await import("../animate-state.mjs")).readAnimateState;
            initialState = await stateReader();
            if (!initialState.running) {
                preflight = { skipReason: initialState.reason ?? "Adobe Animate is not running." };
            } else if (!initialState.responding) {
                preflight = { stopReason: initialState.reason ?? "Animate is not responding." };
            } else if (initialState.documents.length === 0) {
                for (const entry of entries) {
                    if (entry.name === "canvas" || entry.name === "document-ops") {
                        entry.skipReason = "This smoke scenario requires an existing user document; none is open.";
                    }
                }
            }
        } catch (error) {
            preflight = { stopReason: `Animate safety check failed: ${error.message}` };
        }
    }

    /** Confirms Animate and the original document set remain unchanged.
     * @returns Whether the batch is safe to continue.
     */
    const checkSafety = async () => {
        try {
            const current = await stateReader();
            if (!current.running) {
                return { ok: false, reason: current.reason ?? "Animate exited during the smoke batch." };
            }
            if (!current.responding) {
                return { ok: false, reason: current.reason ?? "Animate stopped responding during the smoke batch." };
            }
            if (current.processIds.join(",") !== initialState.processIds.join(",")) {
                return { ok: false, reason: "Animate exited or restarted during the smoke batch." };
            }
            if (current.documents.join("\n") !== initialState.documents.join("\n")) {
                return { ok: false, reason: "Open documents changed; disposable-document cleanup may have failed." };
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: `Animate safety check failed: ${error.message}` };
        }
    };

    const batch = await runSequentialBatch({
        entries,
        run: (entry) => run(path.join(SCENARIO_DIR, entry.script)),
        checkSafety,
        runDir,
        preflight,
        log,
    });
    const smokeReport = {
        startedAt: batch.report.startedAt,
        platform,
        results: batch.report.results.map((result) => ({
            script: `smoke-${result.name}.mjs`,
            status: result.status,
            exitCode: result.exitCode,
            seconds: result.seconds,
            reason: result.reason,
        })),
        stopReason: batch.report.stopReason,
        exitCode: batch.exitCode,
    };
    const reportPath = process.env.SMOKE_REPORT ?? path.join(runDir, "smoke-report.json");
    try {
        writeFileSync(path.resolve(process.cwd(), reportPath), `${JSON.stringify(smokeReport, null, 2)}\n`);
    } catch (error) {
        log(`Could not write smoke report to ${reportPath}: ${error.message}`);
        batch.exitCode = 1;
        batch.report.exitCode = 1;
        try {
            writeFileSync(path.join(runDir, "summary.json"), `${JSON.stringify(batch.report, null, 2)}\n`);
        } catch {
            // The evidence directory may be the cause of the report write failure.
        }
    }
    return batch;
}

/**
 * Creates a unique default evidence directory.
 * @returns Directory path.
 */
function defaultRunDir() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.resolve(process.cwd(), "verification-runs", `smoke-${stamp}-${process.pid}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const result = await runSmokeBatch({ requested: process.argv.slice(2), runDir: process.env.VERIFICATION_RUN_DIR });
    process.exitCode = result.exitCode;
}
