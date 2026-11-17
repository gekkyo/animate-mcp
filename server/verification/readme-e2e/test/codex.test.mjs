import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { codexArgs, runCodex } from "../lib/codex.mjs";
import { readmeE2eProvider } from "./runner.mjs";
import { selectedScenario } from "../scenarios/scenarios.mjs";

const fakeCodexSource = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("-o") + 1];
const mcpConfig = args.find((arg) => arg.startsWith("mcp_servers.animate-readme-e2e="));
const envVarsStart = mcpConfig?.indexOf("env_vars=") ?? -1;
const mcpEnvVars = envVarsStart < 0
  ? []
  : JSON.parse(mcpConfig.slice(envVarsStart + "env_vars=".length, -1));
const mcpChildEnv = Object.fromEntries(
  [...new Set(["HOME", "PATH", ...mcpEnvVars])]
    .filter((name) => typeof process.env[name] === "string")
    .map((name) => [name, process.env[name]])
);
const capturePath = process.env.CODEX_TEST_CAPTURE;
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify({
    args,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    tracePath: process.env.README_E2E_TRACE_PATH,
    documentUri: process.env.README_E2E_DOCUMENT_URI,
    outDir: process.env.README_E2E_OUT_DIR,
    assetPaths: process.env.README_E2E_ASSET_PATHS,
    mcpEnvVars,
    mcpChildEnv
  }));
}
if (process.env.CODEX_TEST_HANG === "1") {
  setInterval(() => {}, 1000);
} else {
  if (process.env.CODEX_TEST_WRITE_RESULT === "1") {
    fs.writeFileSync(
      outputPath,
      process.env.CODEX_TEST_RESULT_SIZE
        ? "x".repeat(Number(process.env.CODEX_TEST_RESULT_SIZE))
        : process.env.CODEX_TEST_RESULT ?? "fake final response"
    );
  }
  const stdout = Buffer.from(process.env.CODEX_TEST_STDOUT ?? '{"type":"turn.completed"}\\n');
  const splitAt = Number(process.env.CODEX_TEST_SPLIT_AT ?? "0");
  if (splitAt > 0) {
    process.stdout.write(stdout.subarray(0, splitAt), () => {
      setTimeout(() => process.stdout.write(stdout.subarray(splitAt)), 10);
    });
  } else {
    process.stdout.write(stdout);
  }
  process.stderr.write(process.env.CODEX_TEST_STDERR ?? "");
  process.exitCode = Number(process.env.CODEX_TEST_EXIT ?? "0");
}
`;

/** Creates an executable fake Codex CLI for nonpaid adapter tests.
 * @param directory Directory in which to create the fake executable.
 * @returns Fake executable path.
 */
async function createFakeCodex(directory) {
    const executable = join(directory, "codex");
    await writeFile(executable, fakeCodexSource);
    await chmod(executable, 0o755);
    return executable;
}

/** Simulates Codex filtering the MCP child environment to default and configured names.
 * @param args Codex arguments containing the inline MCP configuration.
 * @param parentEnv Environment inherited by the Codex process.
 * @returns Explicit MCP environment variable names and the filtered environment.
 */
function filteredMcpEnvironment(args, parentEnv) {
    const config = args.find((arg) => arg.startsWith("mcp_servers.animate-readme-e2e="));
    const envVarsStart = config?.indexOf("env_vars=") ?? -1;
    assert.notEqual(envVarsStart, -1, "MCP env_vars was not configured");
    const envVars = JSON.parse(config.slice(envVarsStart + "env_vars=".length, -1));
    const childEnv = Object.fromEntries(
        [...new Set(["HOME", "PATH", ...envVars])]
            .filter((name) => typeof parentEnv[name] === "string")
            .map((name) => [name, parentEnv[name]]),
    );
    return { envVars, childEnv };
}

test("Codex stays opt-in, and provider selection rejects unknown values", () => {
    const previousProvider = process.env.README_PROMPT_E2E_PROVIDER;
    try {
        delete process.env.README_PROMPT_E2E_PROVIDER;
        assert.equal(readmeE2eProvider(), "claude");
    } finally {
        if (previousProvider === undefined) {
            delete process.env.README_PROMPT_E2E_PROVIDER;
        } else {
            process.env.README_PROMPT_E2E_PROVIDER = previousProvider;
        }
    }
    assert.equal(readmeE2eProvider("claude"), "claude");
    assert.equal(readmeE2eProvider("codex"), "codex");
    assert.throws(() => readmeE2eProvider("unknown"), /must be "claude" or "codex"/);
});

test("Codex arguments pin an isolated read-only run to the dedicated MCP entrances", () => {
    const args = codexArgs("/tmp/readme-e2e.mjs", "/tmp/work/codex-last-message.txt", "/tmp/empty", "test prompt");
    assert.equal(args[0], "exec");
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes("--ignore-rules"));
    assert.ok(args.includes("--ephemeral"));
    assert.ok(args.includes("--skip-git-repo-check"));
    assert.equal(args[args.indexOf("-s") + 1], "read-only");
    for (const setting of [
        'approval_policy="never"',
        'sandbox_mode="read-only"',
        "features.shell_tool=false",
        "features.unified_exec=false",
        "features.hooks=false",
        "features.apps=false",
        "features.plugins=false",
        "features.skill_search=false",
        "skills.include_instructions=false",
        "skills.bundled.enabled=false",
        'web_search="disabled"',
    ]) {
        assert.ok(args.includes(setting), `missing Codex restriction ${setting}`);
    }
    const mcpConfig = args.find((arg) => arg.startsWith("mcp_servers.animate-readme-e2e="));
    assert.equal(
        mcpConfig,
        `mcp_servers.animate-readme-e2e={command=${JSON.stringify(process.execPath)},args=["/tmp/readme-e2e.mjs", "--mcp-server"],enabled=true,required=true,enabled_tools=["search_tools", "execute_readonly", "execute_write"],tools={execute_write={approval_mode="approve"}},env_vars=["README_E2E_TRACE_PATH", "README_E2E_DOCUMENT_URI", "README_E2E_OUT_DIR", "README_E2E_ASSET_PATHS", "README_PROMPT_E2E_SCENARIO"]}`,
    );
    assert.ok(mcpConfig.includes('tools={execute_write={approval_mode="approve"}}'));
    assert.doesNotMatch(mcpConfig, /tools=\{execute_readonly=/);
    assert.deepEqual(args.slice(-3), ["-o", "/tmp/work/codex-last-message.txt", "test prompt"]);
    assert.ok(!args.includes("--full-auto"));
    assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("fake Codex returns bounded final text from an empty cwd and a workspace-specific output file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-fake-codex-"));
    const workspace = join(directory, "workspace");
    await mkdir(workspace);
    const executableDir = join(directory, "bin");
    await mkdir(executableDir);
    const capturePath = join(directory, "capture.json");
    const serverPath = join(directory, "runner path.mjs");
    await writeFile(serverPath, "");
    await createFakeCodex(executableDir);
    try {
        const result = await runCodex(serverPath, join(workspace, "trace.jsonl"), "file:///tmp/disposable.fla", {
            scenario: selectedScenario("inspect"),
            outDir: workspace,
            assetPaths: [join(workspace, "hero.png")],
            env: {
                ...process.env,
                PATH: `${executableDir}:${process.env.PATH}`,
                CODEX_TEST_CAPTURE: capturePath,
                CODEX_TEST_WRITE_RESULT: "1",
                CODEX_TEST_RESULT: "  hero has a motion tween\n",
                README_PROMPT_E2E_SCENARIO: "inspect",
            },
        });
        assert.equal(result, "hero has a motion tween");
        const capture = JSON.parse(await readFile(capturePath, "utf8"));
        const outputPath = capture.args[capture.args.indexOf("-o") + 1];
        assert.equal(outputPath, join(workspace, "codex-last-message.txt"));
        assert.deepEqual(capture.cwdEntries, []);
        assert.equal(capture.tracePath, join(workspace, "trace.jsonl"));
        assert.equal(capture.documentUri, "file:///tmp/disposable.fla");
        assert.equal(capture.outDir, workspace);
        assert.deepEqual(JSON.parse(capture.assetPaths), [join(workspace, "hero.png")]);
        assert.deepEqual(capture.mcpEnvVars, [
            "README_E2E_TRACE_PATH",
            "README_E2E_DOCUMENT_URI",
            "README_E2E_OUT_DIR",
            "README_E2E_ASSET_PATHS",
            "README_PROMPT_E2E_SCENARIO",
        ]);
        assert.deepEqual(capture.mcpChildEnv, {
            HOME: process.env.HOME,
            PATH: `${executableDir}:${process.env.PATH}`,
            README_E2E_TRACE_PATH: join(workspace, "trace.jsonl"),
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: workspace,
            README_E2E_ASSET_PATHS: JSON.stringify([join(workspace, "hero.png")]),
            README_PROMPT_E2E_SCENARIO: "inspect",
        });
        assert.equal(capture.mcpChildEnv.CODEX_TEST_CAPTURE, undefined);
        assert.equal(capture.args[0], "exec");
        assert.equal(
            capture.args[capture.args.indexOf("-C") + 1].replace(/^\/private/, ""),
            capture.cwd.replace(/^\/private/, ""),
        );
        const mcpConfig = capture.args.find((arg) => arg.startsWith("mcp_servers.animate-readme-e2e="));
        assert.ok(mcpConfig.includes(`command=${JSON.stringify(process.execPath)}`));
        assert.ok(mcpConfig.includes(`args=[${JSON.stringify(serverPath)}, "--mcp-server"]`));
        assert.deepEqual(await readdir(workspace), ["codex-last-message.txt"]);
        await assert.rejects(readdir(capture.cwd), { code: "ENOENT" });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Codex-filtered MCP environment requires the URI and preserves the stage-only tool allowlist", async () => {
    const serverPath = fileURLToPath(new URL("./runner.mjs", import.meta.url));
    const args = codexArgs(serverPath, "/tmp/codex-last-message.txt", "/tmp/empty", "stage prompt");
    const parentEnv = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        README_E2E_TRACE_PATH: "/tmp/stage-e2e/trace.jsonl",
        README_E2E_DOCUMENT_URI: "file:///tmp/disposable-stage.fla",
        README_E2E_OUT_DIR: "/tmp/stage-e2e",
        README_PROMPT_E2E_SCENARIO: "stage",
        CODEX_TEST_PRIVATE_VALUE: "must not be forwarded",
    };
    const { envVars, childEnv } = filteredMcpEnvironment(args, parentEnv);
    assert.deepEqual(envVars, [
        "README_E2E_TRACE_PATH",
        "README_E2E_DOCUMENT_URI",
        "README_E2E_OUT_DIR",
        "README_E2E_ASSET_PATHS",
        "README_PROMPT_E2E_SCENARIO",
    ]);
    assert.equal(childEnv.CODEX_TEST_PRIVATE_VALUE, undefined);

    const missingUriEnv = { ...childEnv };
    delete missingUriEnv.README_E2E_DOCUMENT_URI;
    const failedTransport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath, "--mcp-server"],
        env: missingUriEnv,
        stderr: "pipe",
    });
    const failedClient = new Client({ name: "codex-env-red-test", version: "1.0.0" });
    let startupStderr = "";
    const stderrEnded = new Promise((resolve) => {
        failedTransport.stderr.on("data", (chunk) => (startupStderr += chunk.toString()));
        failedTransport.stderr.on("end", resolve);
    });
    try {
        await assert.rejects(failedClient.connect(failedTransport));
        await stderrEnded;
        assert.match(startupStderr, /The restricted MCP server requires the disposable document URI/);
    } finally {
        await failedClient.close().catch(() => {});
    }

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath, "--mcp-server"],
        env: childEnv,
    });
    const client = new Client({ name: "codex-env-stage-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "get_document_info", "set_document_properties"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        const excluded = await client.callTool({
            name: "execute_write",
            arguments: { name: "edit_timeline", arguments: {} },
        });
        assert.equal(excluded.isError, true);
    } finally {
        await client.close();
    }
});

test("Codex accepts Japanese JSONL split inside a multibyte UTF-8 character", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-codex-utf8-"));
    const executableDir = join(directory, "bin");
    const workspace = join(directory, "workspace");
    await mkdir(executableDir);
    await mkdir(workspace);
    await createFakeCodex(executableDir);
    const jsonl = '{"type":"turn.completed","text":"日本語"}\n';
    try {
        const result = await runCodex("/tmp/runner.mjs", join(workspace, "trace.jsonl"), "file:///tmp/disposable.fla", {
            scenario: selectedScenario("inspect"),
            outDir: workspace,
            env: {
                ...process.env,
                PATH: `${executableDir}:${process.env.PATH}`,
                CODEX_TEST_WRITE_RESULT: "1",
                CODEX_TEST_RESULT: "日本語の最終回答",
                CODEX_TEST_STDOUT: jsonl,
                CODEX_TEST_SPLIT_AT: String(Buffer.byteLength('{"type":"turn.completed","text":"') + 1),
            },
        });
        assert.equal(result, "日本語の最終回答");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Codex nonzero and JSONL error events fail with only safe diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-codex-failure-"));
    const executableDir = join(directory, "bin");
    const workspace = join(directory, "workspace");
    await mkdir(executableDir);
    await mkdir(workspace);
    await createFakeCodex(executableDir);
    const env = {
        ...process.env,
        PATH: `${executableDir}:${process.env.PATH}`,
        CODEX_TEST_WRITE_RESULT: "1",
        CODEX_TEST_RESULT: "private result marker",
        CODEX_TEST_STDERR: "private stderr marker",
    };
    try {
        await assert.rejects(
            runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                scenario: selectedScenario("publish"),
                outDir: workspace,
                env: { ...env, CODEX_TEST_EXIT: "7", CODEX_TEST_STDOUT: '{"type":"turn.completed"}\n' },
            }),
            (error) => {
                assert.match(error.message, /exit=7/);
                assert.match(error.message, /jsonl=valid/);
                assert.match(error.message, /turn_completed=true/);
                assert.equal(error.diagnostic.errorCategory, "cli");
                assert.equal(error.diagnostic.stderrCategory, "unknown");
                assert.doesNotMatch(error.message, /private .* marker|private result marker/);
                return true;
            },
        );
        await assert.rejects(
            runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                scenario: selectedScenario("publish"),
                outDir: workspace,
                env: {
                    ...env,
                    CODEX_TEST_STDOUT:
                        '{"type":"turn.failed","error":{"message":"private event marker"}}\n{"type":"error","message":"private event marker"}\n{"type":"turn.completed"}\n',
                },
            }),
            (error) => {
                assert.match(error.message, /failure_events=2/);
                assert.doesNotMatch(error.message, /private event marker|private result marker|private stderr marker/);
                return true;
            },
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Codex startup stderr yields bounded allowlisted diagnostics without echoing raw content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-codex-startup-errors-"));
    const executableDir = join(directory, "bin");
    const workspace = join(directory, "workspace");
    await mkdir(executableDir);
    await mkdir(workspace);
    await createFakeCodex(executableDir);
    const diagnostics = [
        { stderr: "Failed to start MCP server: diagnostic-secret", expected: ["stderr_category=mcp_startup"] },
        {
            stderr: "configuration error: invalid type for features.apps: expected boolean, got diagnostic-secret",
            expected: ["stderr_category=configuration", "config_key=features.apps", "config_issue=type"],
        },
        {
            stderr: "error: unexpected argument '--skip-git-repo-check' diagnostic-secret",
            expected: ["stderr_category=unsupported_flag", "flag=--skip-git-repo-check"],
        },
        {
            stderr: "error: unexpected argument '--diagnostic-secret-flag'",
            expected: ["stderr_category=unsupported_flag"],
        },
        { stderr: "Authentication required; token diagnostic-secret", expected: ["stderr_category=auth"] },
        { stderr: "429 rate limit diagnostic-secret", expected: ["stderr_category=rate_limit"] },
        { stderr: "network connection refused diagnostic-secret", expected: ["stderr_category=network"] },
        { stderr: "sandbox permission denied diagnostic-secret", expected: ["stderr_category=sandbox"] },
        {
            stderr: `Failed to start MCP server: diagnostic-secret ${"x".repeat(20_000)}`,
            expected: ["stderr_category=mcp_startup", "stderr_capture_truncated=true"],
        },
    ];
    try {
        for (const { stderr, expected } of diagnostics) {
            await assert.rejects(
                runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                    scenario: selectedScenario("layer"),
                    outDir: workspace,
                    env: {
                        ...process.env,
                        PATH: `${executableDir}:${process.env.PATH}`,
                        CODEX_TEST_EXIT: "1",
                        CODEX_TEST_STDOUT: "",
                        CODEX_TEST_STDERR: stderr,
                    },
                }),
                (error) => {
                    assert.match(error.message, /jsonl=empty/);
                    for (const item of expected) {
                        assert.ok(error.message.includes(item), `missing safe diagnostic: ${item}`);
                    }
                    assert.doesNotMatch(error.message, /diagnostic-secret|Failed to start MCP server|expected boolean/);
                    return true;
                },
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Codex result-consuming scenarios reject missing and oversized final-message output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-codex-no-result-"));
    const executableDir = join(directory, "bin");
    const workspace = join(directory, "workspace");
    await mkdir(executableDir);
    await mkdir(workspace);
    await createFakeCodex(executableDir);
    try {
        await assert.rejects(
            runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                scenario: selectedScenario("inspect"),
                outDir: workspace,
                env: {
                    ...process.env,
                    PATH: `${executableDir}:${process.env.PATH}`,
                    CODEX_TEST_WRITE_RESULT: "0",
                },
            }),
            /returned no bounded final result/,
        );
        await assert.rejects(
            runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                scenario: selectedScenario("inspect"),
                outDir: workspace,
                env: {
                    ...process.env,
                    PATH: `${executableDir}:${process.env.PATH}`,
                    CODEX_TEST_WRITE_RESULT: "1",
                    CODEX_TEST_RESULT_SIZE: "1000001",
                },
            }),
            /returned no bounded final result/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Codex timeout kills and waits for the process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-e2e-codex-timeout-"));
    const executableDir = join(directory, "bin");
    const workspace = join(directory, "workspace");
    await mkdir(executableDir);
    await mkdir(workspace);
    await createFakeCodex(executableDir);
    try {
        await assert.rejects(
            runCodex("/tmp/runner.mjs", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                scenario: selectedScenario("inspect"),
                outDir: workspace,
                timeoutMs: 25,
                env: {
                    ...process.env,
                    PATH: `${executableDir}:${process.env.PATH}`,
                    CODEX_TEST_HANG: "1",
                },
            }),
            /timed out; CLI exited/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
