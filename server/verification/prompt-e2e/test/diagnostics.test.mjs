import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validatedCliVersion, writePromptDiagnostic } from "../lib/diagnostics.mjs";

test("persistent diagnostics default to fixed metadata and use private storage", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "prompt-e2e-diagnostics-"));
    try {
        await writePromptDiagnostic(
            {
                event: "codex-cli",
                outcome: "failed",
                stage: "cli",
                provider: "codex",
                scenario: "capture",
                errorCategory: "cli",
                exitCode: 7,
                stderrCategory: "auth",
                cliVersion: "codex-cli token-do-not-store",
                mcpUrl: "https://example.invalid/?token=do-not-store",
                rawStderr: "credential-value-do-not-store",
            },
            { homeDir, detailed: false, cliVersion: "codex-cli token-do-not-store" },
        );
        const directory = join(homeDir, ".animate-mcp", "prompt-e2e-diagnostics");
        const path = join(directory, "diagnostics.jsonl");
        const record = JSON.parse((await readFile(path, "utf8")).trim());
        assert.deepEqual(Object.keys(record).sort(), [
            "cliVersion",
            "errorCategory",
            "event",
            "exitCode",
            "outcome",
            "provider",
            "scenario",
            "stage",
            "timestamp",
        ]);
        assert.equal(record.event, "codex-cli");
        assert.equal(record.scenario, "capture");
        assert.equal(record.errorCategory, "cli");
        assert.equal(record.exitCode, 7);
        assert.equal(record.cliVersion, "unavailable");
        assert.doesNotMatch(JSON.stringify(record), /example\.invalid|do-not-store|credential-value/);
        assert.equal((await stat(directory)).mode & 0o777, 0o700);
        assert.equal((await stat(path)).mode & 0o777, 0o600);
    } finally {
        await rm(homeDir, { recursive: true, force: true });
    }
});

test("opt-in diagnostics add only bounded enums and counters, and stop at the file cap", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "prompt-e2e-diagnostics-detailed-"));
    const directory = join(homeDir, ".animate-mcp", "prompt-e2e-diagnostics");
    const path = join(directory, "diagnostics.jsonl");
    try {
        await writePromptDiagnostic(
            {
                event: "codex-cli",
                outcome: "failed",
                stage: "cli",
                provider: "codex",
                scenario: "capture",
                stderrCategory: "configuration",
                stderrConfigKey: "features.apps",
                stderrConfigIssue: "type",
                stdoutBytes: 900,
                failureEvents: 2,
                cliVersion: "codex-cli 0.169.0",
                serverUrl: "https://example.invalid/?token=do-not-store",
            },
            { homeDir, detailed: true, cliVersion: "codex-cli 0.169.0" },
        );
        const record = JSON.parse((await readFile(path, "utf8")).trim());
        assert.equal(record.stderrCategory, "configuration");
        assert.equal(record.stderrConfigKey, "features.apps");
        assert.equal(record.stderrConfigIssue, "type");
        assert.equal(record.stdoutBytes, 900);
        assert.equal(record.failureEvents, 2);
        assert.equal(record.cliVersion, "0.169.0");
        assert.equal(record.serverUrl, undefined);
        assert.doesNotMatch(JSON.stringify(record), /example\.invalid|do-not-store/);

        const scenarios = [
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
        ];
        for (let index = 0; index < 500; index++) {
            await writePromptDiagnostic(
                {
                    event: "run",
                    outcome: "failed",
                    stage: "cli",
                    provider: "codex",
                    scenario: scenarios[index % scenarios.length],
                    errorCategory: "cli",
                    exitCode: index,
                },
                { homeDir, detailed: false, cliVersion: "0.169.0" },
            );
        }
        const records = (await readFile(path, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.ok((await stat(path)).size <= 64 * 1024);
        assert.ok(records.length > 1);
        assert.equal(records.at(-1).scenario, scenarios[499 % scenarios.length]);
        assert.equal(records.at(-1).exitCode, 255);
    } finally {
        await rm(homeDir, { recursive: true, force: true });
    }
});

test("CLI versions accept only a bounded semantic version token", () => {
    assert.equal(validatedCliVersion("codex-cli 0.169.0"), "0.169.0");
    assert.equal(validatedCliVersion("2.1.8"), "2.1.8");
    assert.equal(validatedCliVersion("2.1.311 (Claude Code)\n"), "2.1.311");
    assert.equal(validatedCliVersion("2.1.311 (secret-value)"), "unavailable");
    assert.equal(validatedCliVersion("codex-cli token=secret"), "unavailable");
    assert.equal(validatedCliVersion(`codex ${"1".repeat(300)}`), "unavailable");
});

test("CLI --version is probed once in isolation and cached for later diagnostics", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "prompt-e2e-version-cache-"));
    const bin = join(homeDir, "bin");
    const calls = join(homeDir, "version-calls");
    const executable = join(bin, "codex");
    const originalPath = process.env.PATH;
    try {
        await mkdir(bin);
        await writeFile(
            executable,
            `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] !== "--version") process.exit(2);
fs.appendFileSync(${JSON.stringify(calls)}, "x");
process.stdout.write("codex-cli 0.169.0\\n");
`,
        );
        await chmod(executable, 0o755);
        process.env.PATH = `${bin}:${originalPath}`;
        for (let index = 0; index < 2; index++) {
            await writePromptDiagnostic(
                {
                    event: "run",
                    outcome: "failed",
                    stage: "cli",
                    provider: "codex",
                    scenario: "layer",
                    errorCategory: "cli",
                },
                { homeDir, detailed: false },
            );
        }
        const records = (
            await readFile(join(homeDir, ".animate-mcp", "prompt-e2e-diagnostics", "diagnostics.jsonl"), "utf8")
        )
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.equal((await readFile(calls, "utf8")).length, 1);
        assert.deepEqual(
            records.map(({ cliVersion }) => cliVersion),
            ["0.169.0", "0.169.0"],
        );
    } finally {
        if (originalPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = originalPath;
        }
        await rm(homeDir, { recursive: true, force: true });
    }
});
