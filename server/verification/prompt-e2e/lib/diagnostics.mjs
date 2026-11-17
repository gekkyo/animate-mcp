import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);
const CLI_VERSION_CACHE = new Map();
const DIAGNOSTIC_FIELDS = [
    "exitCode",
    "signal",
    "stdoutBytes",
    "stderrBytes",
    "stdoutTruncated",
    "stderrTruncated",
    "jsonlStatus",
    "turnCompleted",
    "failureEvents",
    "stderrCategory",
    "stderrConfigKey",
    "stderrConfigIssue",
    "mcpHandshake",
    "toolsCount",
];
const SCENARIOS = new Set([
    "layer",
    "stage",
    "script",
    "investigate",
    "text",
    "tween",
    "instance",
    "symbol",
    "inspect",
    "library",
    "capture",
    "assets",
    "publish",
    "testmovie",
    "canvas",
]);
const ENUMS = {
    event: new Set(["run", "codex-cli", "claude-cli", "codex-preflight", "fixture-preflight"]),
    outcome: new Set(["passed", "failed"]),
    stage: new Set(["startup", "fixture", "mcp-handshake", "cli", "verify", "cleanup"]),
    provider: new Set(["claude", "codex", "none"]),
    stderrCategory: new Set([
        "empty",
        "unsupported_flag",
        "configuration",
        "mcp_startup",
        "auth",
        "rate_limit",
        "network",
        "sandbox",
        "unknown",
    ]),
    stderrConfigKey: new Set([
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
        "mcp_servers.animate-prompt-e2e",
    ]),
    stderrConfigIssue: new Set(["value", "type", "key"]),
    jsonlStatus: new Set(["valid", "empty", "invalid"]),
    signal: new Set(["SIGABRT", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGSEGV", "SIGTERM"]),
    errorCategory: new Set(["spawn", "timeout", "cli", "fixture", "mcp", "verification", "cleanup"]),
    mcpHandshake: new Set(["passed", "failed"]),
};

/** Persists only allowlisted metadata outside the disposable E2E workspace.
 * @param diagnostic Safe diagnostic metadata.
 * @param options Diagnostic storage options for tests.
 * @param options.homeDir Private home directory for diagnostic storage.
 * @param options.detailed Enables additional allowlisted counters and enums.
 * @param options.cliVersion Validated CLI version override for tests.
 * @returns Resolves after writing or safely skipping the record.
 */
export async function writePromptDiagnostic(
    diagnostic,
    { homeDir = homedir(), detailed = process.env.PROMPT_E2E_DIAGNOSTICS === "1", cliVersion } = {},
) {
    const record = {
        timestamp: new Date().toISOString(),
        event: enumValue("event", diagnostic.event),
        outcome: enumValue("outcome", diagnostic.outcome),
        stage: enumValue("stage", diagnostic.stage),
        provider: enumValue("provider", diagnostic.provider),
        scenario: SCENARIOS.has(diagnostic.scenario) ? diagnostic.scenario : "unknown",
        cliVersion:
            cliVersion === undefined ? await cachedCliVersion(diagnostic.provider) : validatedCliVersion(cliVersion),
    };
    if (diagnostic.errorCategory !== undefined) {
        record.errorCategory = enumValue("errorCategory", diagnostic.errorCategory);
    }
    if (Number.isSafeInteger(diagnostic.exitCode) && diagnostic.exitCode >= 0) {
        record.exitCode = Math.min(diagnostic.exitCode, 255);
    }
    if (detailed) {
        for (const field of DIAGNOSTIC_FIELDS) {
            const value = diagnostic[field];
            if (
                field === "signal" ||
                field === "stderrCategory" ||
                field === "stderrConfigKey" ||
                field === "stderrConfigIssue" ||
                field === "jsonlStatus" ||
                field === "mcpHandshake"
            ) {
                if (value !== undefined) {
                    record[field] = enumValue(field, value);
                }
            } else if (typeof value === "boolean") {
                record[field] = value;
            } else if (Number.isSafeInteger(value) && value >= 0) {
                record[field] = Math.min(value, 1_000_000_000);
            }
        }
    }
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > 2048) {
        return;
    }
    const appDirectory = join(homeDir, ".animate-mcp");
    const directory = join(appDirectory, "prompt-e2e-diagnostics");
    const path = join(directory, "diagnostics.jsonl");
    let file;
    try {
        await mkdir(appDirectory, { recursive: true, mode: 0o700 });
        const parent = await lstat(appDirectory);
        if (parent.isSymbolicLink() || !parent.isDirectory()) {
            return;
        }
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const target = await lstat(directory);
        if (target.isSymbolicLink() || !target.isDirectory()) {
            return;
        }
        await chmod(directory, 0o700);
        file = await open(
            path,
            constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            0o600,
        );
        const stats = await file.stat();
        if (!stats.isFile() || stats.nlink !== 1) {
            return;
        }
        await file.chmod(0o600);
        if (stats.size + Buffer.byteLength(line) > MAX_DIAGNOSTIC_BYTES) {
            await retainLatestLogTail(file, stats.size, Buffer.byteLength(line));
        }
        await file.write(line);
    } catch {
        // Diagnostics must never interrupt an E2E run or expose raw error details.
    } finally {
        await file?.close().catch(() => {});
    }
}

/** Validates the single version token from a CLI --version response.
 * @param output Bounded CLI version output.
 * @returns Valid semantic version or the fixed unavailable marker.
 */
export function validatedCliVersion(output) {
    if (typeof output !== "string" || output.length > 256) {
        return "unavailable";
    }
    const match =
        /^(?:(?:codex(?:-cli)?|claude(?: code)?)\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][A-Za-z0-9.-]{1,32})?)(?: \(Claude Code\))?$/i.exec(
            output.trim(),
        );
    return match?.[1] ?? "unavailable";
}

/** Retains recent complete records before appending, so a full log keeps accepting diagnoses.
 * @param file Open regular diagnostics file.
 * @param size Existing file size.
 * @param newLineBytes Size of the pending record.
 */
async function retainLatestLogTail(file, size, newLineBytes) {
    const retainBytes = Math.min(size, Math.floor((MAX_DIAGNOSTIC_BYTES - newLineBytes) * 0.75));
    let retained = Buffer.alloc(0);
    if (retainBytes > 0) {
        const tail = Buffer.alloc(retainBytes);
        try {
            const { bytesRead } = await file.read(tail, 0, retainBytes, size - retainBytes);
            const buffer = tail.subarray(0, bytesRead);
            const firstLineEnd = buffer.indexOf(0x0a);
            if (firstLineEnd >= 0) {
                retained = buffer.subarray(firstLineEnd + 1);
            }
        } catch {
            // Keep the new safe record even if an old tail cannot be read.
        }
    }
    await file.truncate(0);
    if (retained.length > 0) {
        await file.write(retained);
    }
}

/** Returns one cached, isolated --version probe per provider per process.
 * @param provider CLI provider.
 * @returns Validated CLI version or the fixed unavailable marker.
 */
function cachedCliVersion(provider) {
    if (provider !== "codex" && provider !== "claude") {
        return Promise.resolve("unavailable");
    }
    if (!CLI_VERSION_CACHE.has(provider)) {
        CLI_VERSION_CACHE.set(provider, probeCliVersion(provider));
    }
    return CLI_VERSION_CACHE.get(provider);
}

/** Runs --version with fresh HOME/CODEX_HOME so user configuration and auth are not loaded.
 * @param provider CLI provider.
 * @returns Validated semantic version or unavailable.
 */
async function probeCliVersion(provider) {
    let root;
    try {
        root = await mkdtemp(join(tmpdir(), "prompt-e2e-version-"));
        const home = join(root, "home");
        const codexHome = join(root, "codex-home");
        const claudeConfig = join(root, "claude-config");
        for (const directory of [home, codexHome, claudeConfig]) {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await chmod(directory, 0o700);
        }
        const { stdout } = await execFileAsync(provider, ["--version"], {
            cwd: root,
            env: {
                HOME: home,
                CODEX_HOME: codexHome,
                CLAUDE_CONFIG_DIR: claudeConfig,
                PATH: process.env.PATH ?? "/usr/bin:/bin",
            },
            encoding: "utf8",
            timeout: 5_000,
            maxBuffer: 1_024,
        });
        return validatedCliVersion(stdout);
    } catch {
        return "unavailable";
    } finally {
        if (root) {
            await rm(root, { recursive: true, force: true }).catch(() => {});
        }
    }
}

/** Restricts strings to a fixed enum before they enter persistent metadata.
 * @param field Allowlisted enum field.
 * @param value Untrusted value.
 * @returns A validated value or a fixed fallback.
 */
function enumValue(field, value) {
    const allowed = ENUMS[field];
    return allowed?.has(value) ? value : "unknown";
}
