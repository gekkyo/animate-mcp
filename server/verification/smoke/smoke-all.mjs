import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED = new Set(["smoke-lib.mjs", "smoke-all.mjs", "smoke-run.mjs"]);
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL_LIMIT = 4096;

/**
 * Runs one smoke script and captures its exit status and stderr tail.
 * @param {string} script Path to the smoke script.
 * @returns {Promise<{exitCode: number | null, stderrTail: string}>} Script outcome.
 */
function runScript(script) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script], {
            env: process.env,
            stdio: ["inherit", "inherit", "pipe"],
        });
        let stderrTail = "";
        let settled = false;
        let forceKillTimer;

        /**
         * Completes the child process once and releases its timeout.
         * @param {number | null} exitCode Child process exit code.
         * @returns {void} Nothing.
         */
        const finish = (exitCode) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            clearTimeout(forceKillTimer);
            resolve({ exitCode, stderrTail });
        };

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
            process.stderr.write(chunk);
        });
        child.on("error", (error) => {
            stderrTail = (stderrTail + error.message).slice(-STDERR_TAIL_LIMIT);
            finish(null);
        });
        child.on("close", (code) => finish(code));

        const timeout = setTimeout(() => {
            stderrTail = `${stderrTail}\nTimed out after 10 minutes.`.slice(-STDERR_TAIL_LIMIT);
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        }, SCRIPT_TIMEOUT_MS);
    });
}

/**
 * Returns available smoke scripts, optionally filtered by short names.
 * @param {string[]} requested Names supplied on the command line.
 * @returns {{scripts: string[], error?: string}} Selected scripts or an error.
 */
function selectScripts(requested) {
    const available = readdirSync(SCRIPT_DIR)
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

const startedAt = new Date().toISOString();
if (process.platform !== "darwin") {
    console.error("Real-Animate smoke tests can only run on macOS.");
    process.exit(2);
}
if (!existsSync(path.resolve(process.cwd(), "server/dist"))) {
    console.error("server/dist is missing; run `npm run build` first.");
    process.exit(2);
}

const selection = selectScripts(process.argv.slice(2));
if (selection.error) {
    console.error(selection.error);
    process.exit(2);
}

const results = [];
for (const file of selection.scripts) {
    const script = path.join(SCRIPT_DIR, file);
    const start = Date.now();
    const { exitCode, stderrTail } = await runScript(script);
    const seconds = Math.round(((Date.now() - start) / 1000) * 100) / 100;
    const status = exitCode === 0 ? "PASS" : "FAIL";
    results.push({ script: file, status, exitCode, seconds, stderrTail });
    console.log(`${status} ${file} ${seconds}s`);
}

const report = { startedAt, platform: process.platform, results };
const reportPath = process.env.SMOKE_REPORT || "smoke-report.json";
try {
    writeFileSync(path.resolve(process.cwd(), reportPath), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
    console.error(`Could not write smoke report to ${reportPath}: ${error.message}`);
    process.exitCode = 1;
}
if (results.some((result) => result.status !== "PASS")) {
    process.exitCode = 1;
}
