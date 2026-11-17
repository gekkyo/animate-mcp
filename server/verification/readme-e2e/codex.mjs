import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prompt, scenarios, selectedScenario } from "./scenarios.mjs";

const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_STDERR_CAPTURE_BYTES = 16_384;
const RESULT_SCENARIOS = [
    scenarios.inspect,
    scenarios.library,
    scenarios.investigate,
    scenarios.capture,
    scenarios.publish,
    scenarios.testmovie,
    scenarios.canvas,
];
const CODEX_FLAGS = new Set([
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--json",
    "-C",
    "-s",
    "-c",
    "-o",
]);
const CODEX_CONFIG_KEYS = [
    "approval_policy",
    "sandbox_mode",
    "features.shell_tool",
    "features.unified_exec",
    "features.hooks",
    "features.apps",
    "features.plugins",
    "features.skill_search",
    "skills.include_instructions",
    "skills.bundled.enabled",
    "web_search",
    "mcp_servers.animate-readme-e2e",
];

/** Runs Codex in a separate empty working directory and returns only bounded final-result text.
 * @param serverPath Absolute path to this harness's MCP server entry point.
 * @param tracePath Value-free MCP trace path.
 * @param documentPath Exact disposable FLA URI.
 * @param options Spawn environment and timeout overrides.
 * @param options.env Child environment.
 * @param options.timeoutMs Timeout in milliseconds.
 * @param options.scenario Selected scenario configuration.
 * @param options.outDir Disposable E2E workspace.
 * @param options.assetPaths Exact paths pinned by the assets scenario.
 * @returns Resolves after a successful Codex turn, with final result text when the scenario consumes it.
 */
export async function runCodex(
    serverPath,
    tracePath,
    documentPath,
    { env = process.env, timeoutMs = 300_000, scenario = selectedScenario(), outDir, assetPaths } = {},
) {
    if (!outDir) {
        throw new Error("Codex CLI requires the disposable E2E workspace.");
    }
    const workingDirectory = await mkdtemp(join(tmpdir(), "animate-mcp-codex-cwd-"));
    try {
        const outputPath = join(outDir, "codex-last-message.txt");
        const events = await runProcess(
            codexArgs(serverPath, outputPath, workingDirectory, scenario.prompt),
            workingDirectory,
            {
                env: {
                    ...env,
                    README_E2E_TRACE_PATH: tracePath,
                    README_E2E_DOCUMENT_URI: documentPath,
                    README_E2E_OUT_DIR: outDir,
                    ...(assetPaths ? { README_E2E_ASSET_PATHS: JSON.stringify(assetPaths) } : {}),
                },
                timeoutMs,
            },
        );
        const result = parseEvents(events.stdout, events.stdoutTruncated);
        const failureEvents = result.failureEvents;
        const stderrDiagnosis = classifyStderr(events.stderr);
        if (events.code !== 0 || events.signal || !result.valid || failureEvents > 0 || !result.turnCompleted) {
            throw new Error(
                `Codex CLI failed (exit=${events.code ?? "unknown"}, signal=${events.signal ?? "none"}, stdout=${events.stdoutBytes}B, stderr=${events.stderrBytes}B; jsonl=${result.status}, turn_completed=${result.turnCompleted}, failure_events=${failureEvents}, stderr_category=${stderrDiagnosis.category}${stderrDiagnosis.details ? `, ${stderrDiagnosis.details}` : ""}, stderr_capture_truncated=${events.stderrTruncated})`,
            );
        }
        return RESULT_SCENARIOS.includes(scenario) ? await readFinalResult(outputPath) : undefined;
    } finally {
        await rm(workingDirectory, { recursive: true, force: true });
    }
}

/** Runs Codex and accounts for output without retaining stderr or exposing CLI content.
 * @param args CLI arguments.
 * @param cwd Empty Codex working directory.
 * @param options Process environment and timeout.
 * @param options.env Child environment.
 * @param options.timeoutMs Timeout in milliseconds.
 * @returns Exit metadata and bounded stdout for JSONL validation.
 */
function runProcess(args, cwd, { env, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const child = spawn("codex", args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
            env,
        });
        let stdoutBytes = 0;
        let stderrBytes = 0;
        const stdout = Buffer.alloc(MAX_CAPTURE_BYTES);
        const stderr = Buffer.alloc(MAX_STDERR_CAPTURE_BYTES);
        let stdoutLength = 0;
        let stderrLength = 0;
        let stdoutTruncated = false;
        let stderrTruncated = false;
        child.stdout.on("data", (chunk) => {
            stdoutBytes = Math.min(stdoutBytes + chunk.length, Number.MAX_SAFE_INTEGER);
            const capturedBytes = Math.min(chunk.length, MAX_CAPTURE_BYTES - stdoutLength);
            chunk.copy(stdout, stdoutLength, 0, capturedBytes);
            stdoutLength += capturedBytes;
            stdoutTruncated ||= capturedBytes < chunk.length;
        });
        child.stderr.on("data", (chunk) => {
            stderrBytes = Math.min(stderrBytes + chunk.length, Number.MAX_SAFE_INTEGER);
            const capturedBytes = Math.min(chunk.length, MAX_STDERR_CAPTURE_BYTES - stderrLength);
            chunk.copy(stderr, stderrLength, 0, capturedBytes);
            stderrLength += capturedBytes;
            stderrTruncated ||= capturedBytes < chunk.length;
        });

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
                // Wait for close even if the process exited between the timeout and the kill.
            }
            await closed;
            reject(new Error(`Codex CLI timed out; CLI exited (stdout=${stdoutBytes}B, stderr=${stderrBytes}B)`));
        }, timeoutMs);
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(new Error(`Codex CLI could not start (${error.code ?? "spawn error"})`));
        });
        child.once("close", (code, signal) => {
            close();
            clearTimeout(timer);
            if (!timedOut) {
                resolve({
                    code,
                    signal,
                    stdout: stdout.subarray(0, stdoutLength).toString("utf8"),
                    stderr: stderr.subarray(0, stderrLength).toString("utf8"),
                    stdoutBytes,
                    stderrBytes,
                    stdoutTruncated,
                    stderrTruncated,
                });
            }
        });
    });
}

/** Builds a Codex command with only the dedicated E2E MCP server enabled.
 * @param serverPath Absolute harness entry point.
 * @param outputPath Per-workspace final-message file.
 * @param workingDirectory Empty Codex working directory.
 * @param selectedPrompt Scenario prompt.
 * @returns Codex CLI arguments.
 */
export function codexArgs(serverPath, outputPath, workingDirectory, selectedPrompt = prompt) {
    const mcpConfig = [
        `command=${tomlString(process.execPath)}`,
        `args=[${tomlString(serverPath)}, "--mcp-server"]`,
        "enabled=true",
        "required=true",
        'enabled_tools=["search_tools", "execute_readonly", "execute_write"]',
        'tools={execute_write={approval_mode="approve"}}',
        'env_vars=["README_E2E_TRACE_PATH", "README_E2E_DOCUMENT_URI", "README_E2E_OUT_DIR", "README_E2E_ASSET_PATHS", "README_PROMPT_E2E_SCENARIO"]',
    ].join(",");
    return [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "-C",
        workingDirectory,
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="read-only"',
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        "features.hooks=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.plugins=false",
        "-c",
        "features.skill_search=false",
        "-c",
        "skills.include_instructions=false",
        "-c",
        "skills.bundled.enabled=false",
        "-c",
        'web_search="disabled"',
        "-c",
        `mcp_servers.animate-readme-e2e={${mcpConfig}}`,
        "--json",
        "-o",
        outputPath,
        selectedPrompt,
    ];
}

/** Encodes a string as a TOML basic string.
 * @param value String value.
 * @returns TOML-escaped string.
 */
function tomlString(value) {
    return JSON.stringify(value);
}

/** Checks JSONL completion and failure events without retaining event content.
 * @param stdout Bounded Codex JSONL output.
 * @param truncated Whether stdout exceeded the capture limit.
 * @returns Safe JSONL status metadata.
 */
function parseEvents(stdout, truncated) {
    if (truncated) {
        return { status: "invalid", valid: false, turnCompleted: false, failureEvents: 0 };
    }
    let turnCompleted = false;
    let failureEvents = 0;
    try {
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) {
            return { status: "empty", valid: false, turnCompleted, failureEvents };
        }
        for (const line of lines) {
            const event = JSON.parse(line);
            if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
                return { status: "invalid", valid: false, turnCompleted, failureEvents };
            }
            if (event.type === "turn.completed") {
                turnCompleted = true;
            }
            if (
                event.type === "turn.failed" ||
                event.type === "error" ||
                event.is_error === true ||
                (Object.hasOwn(event, "error") && event.error !== null) ||
                (event.item &&
                    typeof event.item === "object" &&
                    (event.item.type === "error" ||
                        event.item.is_error === true ||
                        (Object.hasOwn(event.item, "error") && event.item.error !== null)))
            ) {
                failureEvents += 1;
            }
        }
    } catch {
        return { status: "invalid", valid: false, turnCompleted, failureEvents };
    }
    return { status: "valid", valid: true, turnCompleted, failureEvents };
}

/** Classifies captured CLI stderr while returning only fixed categories and allowlisted identifiers.
 * @param stderr Bounded, transient CLI stderr.
 * @returns Safe diagnostic category and optional safe details.
 */
function classifyStderr(stderr) {
    if (!stderr.trim()) {
        return { category: "empty", details: "" };
    }
    const lower = stderr.toLowerCase();
    const unsupportedArgument =
        /(?:unexpected|unrecognized|unknown|unsupported|invalid)\s+(?:command[- ]line\s+)?(?:argument|option|flag)/i.test(
            stderr,
        );
    if (unsupportedArgument) {
        const flag = stderr
            .match(/--[A-Za-z][A-Za-z0-9-]*|-[A-Za-z]/g)
            ?.find((candidate) => CODEX_FLAGS.has(candidate));
        return { category: "unsupported_flag", details: flag ? `flag=${flag}` : "" };
    }
    if (
        (/(?:config(?:uration)?|setting)/i.test(stderr) &&
            /invalid|unknown|unrecognized|unsupported|failed|error|expected|type|must be/i.test(stderr)) ||
        /failed to parse (?:the )?config(?:uration)?|invalid config(?:uration)?/i.test(stderr)
    ) {
        const configKey = CODEX_CONFIG_KEYS.find((key) => lower.includes(key.toLowerCase()));
        let issue = "value";
        if (
            /expected|wrong type|type mismatch|must be (?:a )?(?:boolean|string|integer|number|array|table)/i.test(
                stderr,
            )
        ) {
            issue = "type";
        } else if (/unknown|unrecognized|unsupported.{0,20}(?:key|setting)/i.test(stderr)) {
            issue = "key";
        }
        return {
            category: "configuration",
            details: `${configKey ? `config_key=${configKey}, ` : ""}config_issue=${issue}`,
        };
    }
    if (
        /(?:mcp.{0,40}(?:server|startup|initializ|spawn|connect|fail|error)|(?:server|startup|initializ).{0,40}mcp)/i.test(
            stderr,
        )
    ) {
        return { category: "mcp_startup", details: "" };
    }
    if (/auth|unauthorized|not logged in|login required|credential/i.test(stderr)) {
        return { category: "auth", details: "" };
    }
    if (/rate[ _-]?limit|too many requests|\b429\b|quota/i.test(stderr)) {
        return { category: "rate_limit", details: "" };
    }
    if (
        /network|dns|connection (?:refused|reset|failed|timed out)|resolve host|tls|ssl|socket|request timed out/i.test(
            stderr,
        )
    ) {
        return { category: "network", details: "" };
    }
    if (/sandbox|permission denied|operation not permitted|access denied|read-only file system/i.test(stderr)) {
        return { category: "sandbox", details: "" };
    }
    return { category: "unknown", details: "" };
}

/** Reads a regular, non-symlink final-message file with a strict size limit.
 * @param path Codex output path.
 * @returns Trimmed final response text.
 */
async function readFinalResult(path) {
    let file;
    try {
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CAPTURE_BYTES) {
            throw new Error("invalid final result");
        }
        const buffer = Buffer.alloc(MAX_CAPTURE_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (bytesRead === 0) {
                break;
            }
            length += bytesRead;
        }
        if (length === 0 || length > MAX_CAPTURE_BYTES) {
            throw new Error("invalid final result");
        }
        const result = buffer.subarray(0, length).toString("utf8").trim();
        if (!result) {
            throw new Error("empty final result");
        }
        return result;
    } catch {
        throw new Error("Codex CLI returned no bounded final result");
    } finally {
        await file?.close();
    }
}
