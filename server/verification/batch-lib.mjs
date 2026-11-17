import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Runs verification entries once each, stopping after repeated or unsafe failures.
 * @param options Batch entries and injectable execution/safety checks.
 * @param options.entries Ordered verification entries.
 * @param options.run Runs one entry and returns its process result.
 * @param options.checkSafety Checks that Animate remains in the expected state.
 * @param options.runDir Directory for logs and the summary.
 * @param options.preflight Optional skip or safety-stop result before any entry.
 * @param options.log Writes a concise progress line.
 * @returns Batch report and process exit code.
 */
export async function runSequentialBatch({ entries, run, checkSafety, runDir, preflight, log = console.log }) {
    const startedAt = new Date().toISOString();
    await mkdir(runDir, { recursive: true });
    const results = entries.map(({ name }) => ({ name, status: "NOT_RUN" }));
    let stopReason = preflight?.stopReason;
    let consecutiveFailures = 0;

    if (preflight?.skipReason) {
        for (const result of results) {
            result.status = "SKIP";
            result.reason = preflight.skipReason;
            await writeFile(join(runDir, `${safeName(result.name)}.log`), `SKIP: ${result.reason}\n`);
            log(`SKIP ${result.name}: ${result.reason}`);
        }
    } else if (!stopReason) {
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const result = results[index];
            if (entry.skipReason) {
                result.status = "SKIP";
                result.reason = entry.skipReason;
                await writeFile(join(runDir, `${safeName(entry.name)}.log`), `SKIP: ${result.reason}\n`);
                log(`SKIP ${entry.name}: ${result.reason}`);
                continue;
            }

            const before = await safetyResult(checkSafety, entry, "before");
            if (!before.ok) {
                stopReason = before.reason;
                break;
            }

            const started = Date.now();
            let outcome;
            try {
                outcome = await run(entry);
            } catch (error) {
                outcome = { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
            }
            result.seconds = Math.round(((Date.now() - started) / 1000) * 100) / 100;
            result.exitCode = outcome.exitCode ?? 1;
            result.status = result.exitCode === 0 ? "PASS" : "FAIL";
            const output = [outcome.stdout, outcome.stderr].filter(Boolean).join("");
            const after = await safetyResult(checkSafety, entry, "after");
            if (!after.ok) {
                result.status = "FAIL";
                result.reason = after.reason;
                stopReason = after.reason;
            }
            await writeFile(
                join(runDir, `${safeName(entry.name)}.log`),
                `${output}${result.reason ? `\n${result.reason}\n` : ""}`,
            );
            log(`${result.status} ${entry.name}${result.reason ? `: ${result.reason}` : ""}`);

            if (result.status === "FAIL") {
                consecutiveFailures++;
            } else {
                consecutiveFailures = 0;
            }
            if (stopReason) {
                break;
            }
            if (consecutiveFailures >= 3) {
                stopReason = "Stopped after 3 consecutive failures.";
                break;
            }
        }
    }

    const finishedAt = new Date().toISOString();
    const noScenarioRan = results.length > 0 && results.every(({ status }) => status === "SKIP");
    const exitCode = stopReason || noScenarioRan || results.some(({ status }) => status === "FAIL") ? 1 : 0;
    const report = { startedAt, finishedAt, stopReason, results, exitCode };
    await writeFile(join(runDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    return { report, exitCode };
}

/** Converts a result name into a safe, readable log filename.
 * @param name Result name.
 * @returns Sanitized filename stem.
 */
function safeName(name) {
    return name.replace(/[^a-z0-9_-]/gi, "_");
}

/** Converts a thrown safety-probe error into a stop result.
 * @param checkSafety Injectable safety probe.
 * @param entry Current verification entry.
 * @param phase Probe phase.
 * @returns Safety probe result.
 */
async function safetyResult(checkSafety, entry, phase) {
    try {
        return await checkSafety(entry, phase);
    } catch (error) {
        return { ok: false, reason: `Safety check failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
