import { spawn } from "node:child_process";
import { prompt, scenarios, selectedScenario } from "../scenarios/scenarios.mjs";

/** Runs Claude with bounded output accounting and waits for process-group exit on timeout.
 * @param configPath Dedicated MCP config path.
 * @param tracePath Value-free MCP trace path.
 * @param documentPath Exact disposable FLA URI.
 * @param options Spawn environment and timeout overrides.
 * @param options.env Child environment.
 * @param options.timeoutMs Timeout in milliseconds.
 * @param options.scenario Selected scenario configuration.
 * @param options.outDir Disposable E2E workspace.
 * @param options.assetPaths Exact paths pinned by the assets scenario.
 * @returns Resolves after successful CLI exit, with parsed result text for read-only, publish, or Canvas scenarios.
 */
export function runClaude(
    configPath,
    tracePath,
    documentPath,
    { env = process.env, timeoutMs = 300_000, scenario = selectedScenario(), outDir, assetPaths } = {},
) {
    return new Promise((resolve, reject) => {
        const child = spawn("claude", claudeArgs(configPath, scenario.prompt), {
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
            env: {
                ...env,
                PROMPT_E2E_TRACE_PATH: tracePath,
                PROMPT_E2E_DOCUMENT_URI: documentPath,
                ...(outDir ? { PROMPT_E2E_OUT_DIR: outDir } : {}),
                ...(assetPaths ? { PROMPT_E2E_ASSET_PATHS: JSON.stringify(assetPaths) } : {}),
            },
        });
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdout = "";
        child.stdout.on("data", (chunk) => {
            stdoutBytes = Math.min(stdoutBytes + chunk.length, 1_000_000);
            if (
                [
                    scenarios.inspect,
                    scenarios.library,
                    scenarios.investigate,
                    scenarios.capture,
                    scenarios.publish,
                    scenarios.testmovie,
                    scenarios.canvas,
                ].includes(scenario) &&
                stdout.length < 1_000_000
            ) {
                stdout += chunk.toString().slice(0, 1_000_000 - stdout.length);
            }
        });
        child.stderr.on("data", (chunk) => (stderrBytes = Math.min(stderrBytes + chunk.length, 1_000_000)));

        let timedOut = false;
        let close;
        const closed = new Promise((done) => {
            close = done;
        });
        const timer = setTimeout(async () => {
            timedOut = true;
            try {
                if (process.platform !== "win32") {
                    process.kill(-child.pid, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                // Still wait for close: deleting the FLA before process termination is unsafe.
            }
            await closed;
            reject(
                diagnosticError(`Claude CLI timed out; CLI exited (stdout=${stdoutBytes}B, stderr=${stderrBytes}B)`, {
                    stdoutBytes,
                    stderrBytes,
                    errorCategory: "timeout",
                }),
            );
        }, timeoutMs);
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(
                diagnosticError(`Claude CLI could not start (${error.code ?? "spawn error"})`, {
                    errorCategory: "spawn",
                }),
            );
        });
        child.once("close", (code, signal) => {
            close();
            clearTimeout(timer);
            if (timedOut) {
                return;
            }
            if (code === 0) {
                if (
                    [
                        scenarios.inspect,
                        scenarios.library,
                        scenarios.investigate,
                        scenarios.capture,
                        scenarios.publish,
                        scenarios.testmovie,
                        scenarios.canvas,
                    ].includes(scenario)
                ) {
                    try {
                        const result = JSON.parse(stdout).result;
                        if (typeof result !== "string") {
                            throw new Error("missing result");
                        }
                        resolve(result);
                    } catch {
                        reject(
                            diagnosticError("Claude CLI returned no readable final result", {
                                exitCode: code,
                                stdoutBytes,
                                stderrBytes,
                                errorCategory: "verification",
                            }),
                        );
                    }
                } else {
                    resolve();
                }
            } else {
                reject(
                    diagnosticError(
                        `Claude CLI failed (exit=${code ?? "unknown"}, signal=${signal ?? "none"}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B; ${claudeFailureDetails(stdout)})`,
                        {
                            exitCode: code,
                            signal,
                            stdoutBytes,
                            stderrBytes,
                            errorCategory: "cli",
                        },
                    ),
                );
            }
        });
    });
}

/** Attaches only allowlisted diagnostic metadata to a safe adapter error.
 * @param message Fixed adapter error message.
 * @param diagnostic Safe metadata values.
 * @returns Error carrying the safe metadata for the runner.
 */
function diagnosticError(message, diagnostic) {
    const error = new Error(message);
    error.diagnostic = diagnostic;
    return error;
}

/** Extracts only bounded enum-like failure fields from Claude's JSON output.
 * @param stdout Captured CLI output, which may contain user or workspace content.
 * @returns Value-free failure metadata.
 */
function claudeFailureDetails(stdout) {
    let output;
    try {
        output = JSON.parse(stdout);
    } catch {
        return "stdout_json=invalid";
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) {
        return "stdout_json=non_object";
    }
    const details = [];
    /** Adds a value only when it is a bounded enum-like token.
     * @param key Safe field name.
     * @param value Untrusted JSON value.
     */
    const addToken = (key, value) => {
        if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) {
            details.push(`${key}=${value}`);
        }
    };
    addToken("type", output.type);
    addToken("subtype", output.subtype);
    addToken("stop_reason", output.stop_reason);
    addToken("error_category", output.error_category);
    addToken("error_type", output.error?.type);
    addToken("error_code", output.error?.code);
    if (typeof output.is_error === "boolean") {
        details.push(`is_error=${output.is_error}`);
    }
    if (Number.isSafeInteger(output.num_turns) && output.num_turns >= 0) {
        details.push(`num_turns=${output.num_turns}`);
    }
    if (Array.isArray(output.permission_denials)) {
        details.push(`permission_denials=${output.permission_denials.length}`);
    }
    const result = typeof output.result === "string" ? output.result.slice(0, 4096) : "";
    let resultCategory = "other";
    if (
        /rate[ _-]?limit|too many requests|throttl|(?:usage|token|request|quota)[ _-]?(?:limit|exceeded)|overloaded|capacity|429\b/i.test(
            result,
        )
    ) {
        resultCategory = "usage_rate_limit";
    } else if (
        /unauthori[sz]ed|authentication|auth(?:entication)?[_ -]?(?:error|failed|required)|invalid (?:api )?key|api key.{0,20}(?:invalid|missing)|not logged in|login required|401\b/i.test(
            result,
        )
    ) {
        resultCategory = "auth";
    } else if (/billing|payment|insufficient credits?|out of credits?|subscription|402\b/i.test(result)) {
        resultCategory = "billing";
    } else if (
        /model.{0,80}(?:not found|unavailable|unknown|does not exist)|(?:unknown|unavailable|not found).{0,80}model|model_not_found/i.test(
            result,
        )
    ) {
        resultCategory = "model_unavailable";
    } else if (
        /(?:mcp|tool).{0,50}(?:error|failed|denied|unavailable|disconnect)|(?:error|failed|denied|unavailable).{0,50}(?:mcp|tool)|permission.{0,50}(?:tool|mcp)/i.test(
            result,
        )
    ) {
        resultCategory = "tool_error";
    }
    details.push(`result_category=${resultCategory}`);
    return details.length ? details.join(", ") : "stdout_json=no_safe_metadata";
}

/** Returns the minimal Claude flags, including preapproval for the only exposed entrances.
 * @param configPath Dedicated MCP config path.
 * @param selectedPrompt Prompt to send to Claude.
 * @returns CLI argument list.
 */
export function claudeArgs(configPath, selectedPrompt = prompt) {
    const scenario = Object.values(scenarios).find((item) => item.prompt === selectedPrompt);
    return [
        "-p",
        selectedPrompt,
        "--restricted",
        "--strict-mcp-config",
        "--mcp-config",
        configPath,
        "--tools",
        "",
        "--disable-slash-commands",
        "--settings",
        JSON.stringify({ disableAllHooks: true }),
        "--permission-prompts",
        "none",
        "--allowedTools",
        "mcp__animate-prompt-e2e__search_tools",
        "mcp__animate-prompt-e2e__execute_readonly",
        "mcp__animate-prompt-e2e__execute_write",
        "--no-session-persistence",
        "--max-turns",
        scenario === scenarios.script ? "12" : "6",
        "--output-format",
        "json",
    ];
}
