import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CODEX_MCP_ENV_VARS, codexArgs } from "../lib/codex.mjs";
import {
    checkRestrictedMcpHandshake,
    codexMcpEnvironment,
    codexParserArgs,
    runCodexConfigProbe,
    runCodexPreflight,
} from "../lib/codex-preflight.mjs";

const fakeCodexSource = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "mcp" || args[1] !== "list") process.exit(2);
if (args.includes("exec")) process.exit(3);
if (process.env.HOME === process.env.CODEX_HOME) process.exit(3);
if (fs.readdirSync(process.env.HOME).length !== 0) process.exit(4);
if (fs.readdirSync(process.env.CODEX_HOME).length !== 0) process.exit(5);
const config = args.filter((arg) => arg !== "-c").join(" ");
if (!config.includes('approval_policy="never"')) process.exit(6);
if (!config.includes('sandbox_mode="read-only"')) process.exit(7);
if (!config.includes("features.apps=false")) process.exit(8);
if (!config.includes("enabled_tools=[\\"search_tools\\", \\"execute_readonly\\", \\"execute_write\\"]")) process.exit(9);
if (!config.includes("env_vars=[\\"PROMPT_E2E_TRACE_PATH\\", \\"PROMPT_E2E_DOCUMENT_URI\\"")) process.exit(10);
if (!config.includes('tools={execute_write={approval_mode="approve"}}')) process.exit(11);
if (!config.includes("animate-prompt-e2e={command=")) process.exit(12);
if (/https?:\\/\\//.test(config)) process.exit(13);
if (config.includes('features.apps="invalid"')) process.exit(14);
process.stdout.write("animate-prompt-e2e\\n");
`;

/** Creates a fake Codex parser that accepts only a fresh fake-server configuration.
 * @param directory Directory for the executable.
 * @returns Fake CLI path.
 */
async function createFakeCodexParser(directory) {
    const path = join(directory, "codex");
    await writeFile(path, fakeCodexSource);
    await chmod(path, 0o755);
    return path;
}

test("Codex MCP child environment forwards only the explicit allowlist and defaults", () => {
    const environment = codexMcpEnvironment({
        HOME: "/isolated/home",
        PATH: "/usr/bin",
        CODEX_HOME: "/isolated/codex-home",
        API_KEY: "must-not-forward",
        PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
        PROMPT_E2E_SCENARIO: "stage",
    });
    assert.deepEqual(Object.keys(environment).sort(), [
        "HOME",
        "PATH",
        "PROMPT_E2E_DOCUMENT_URI",
        "PROMPT_E2E_SCENARIO",
    ]);
    assert.equal(environment.API_KEY, undefined);
    assert.equal(environment.CODEX_HOME, undefined);
    assert.deepEqual(CODEX_MCP_ENV_VARS, [
        "PROMPT_E2E_TRACE_PATH",
        "PROMPT_E2E_DOCUMENT_URI",
        "PROMPT_E2E_OUT_DIR",
        "PROMPT_E2E_ASSET_PATHS",
        "PROMPT_E2E_SCENARIO",
    ]);
});

test("Codex preflight parses generated config under isolated homes and handshakes with the restricted server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prompt-e2e-codex-preflight-test-"));
    const diagnosticsHome = join(directory, "diagnostics-home");
    const executableDirectory = await mkdtemp(join(tmpdir(), "prompt-e2e-codex-parser-"));
    const codexPath = await createFakeCodexParser(executableDirectory);
    const serverPath = fileURLToPath(new URL("../runner.mjs", import.meta.url));
    try {
        const result = await runCodexPreflight({
            serverPath,
            scenarioName: "stage",
            codexPath,
            env: { PATH: process.env.PATH, PRIVATE_TOKEN: "must-not-forward" },
            diagnosticsHome,
            diagnosticsVersion: "unavailable",
        });
        assert.deepEqual(result, { mcpHandshake: true, toolsCount: 3 });
        const diagnosticPath = join(diagnosticsHome, ".animate-mcp", "prompt-e2e-diagnostics", "diagnostics.jsonl");
        const diagnostic = JSON.parse((await readFile(diagnosticPath, "utf8")).trim());
        assert.equal(diagnostic.event, "codex-preflight");
        assert.equal(diagnostic.outcome, "passed");
        assert.ok(diagnostic.mcpHandshake === undefined || diagnostic.mcpHandshake === "passed");
        assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_TOKEN|must-not-forward|CODEX_HOME|mcpproxy/);
    } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(executableDirectory, { recursive: true, force: true });
    }
});

test("parse-only Codex probe reuses production config and rejects an invalid production setting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prompt-e2e-codex-config-negative-"));
    const home = join(directory, "home");
    const codexHome = join(directory, "codex-home");
    const cwd = join(directory, "cwd");
    const executableDirectory = join(directory, "bin");
    const fakeServerPath = join(directory, "fake-mcp-server.cjs");
    await mkdir(home);
    await mkdir(codexHome);
    await mkdir(cwd);
    await mkdir(executableDirectory);
    const codexPath = await createFakeCodexParser(executableDirectory);
    await writeFile(fakeServerPath, "process.exit(0);\n");
    const productionArgs = codexArgs(
        fakeServerPath,
        join(directory, "last-message.txt"),
        cwd,
        "must-not-be-sent-to-a-model",
    );
    try {
        const parserArgs = codexParserArgs(productionArgs);
        assert.equal(parserArgs[0], "mcp");
        assert.equal(parserArgs[1], "list");
        assert.equal(parserArgs.includes("exec"), false);
        assert.equal(parserArgs.includes("must-not-be-sent-to-a-model"), false);
        await runCodexConfigProbe(
            codexPath,
            cwd,
            {
                HOME: home,
                CODEX_HOME: codexHome,
                PATH: process.env.PATH,
            },
            productionArgs,
        );
        const invalidArgs = productionArgs.map((arg) =>
            arg === "features.apps=false" ? 'features.apps="invalid"' : arg,
        );
        assert.notDeepEqual(invalidArgs, productionArgs);
        await assert.rejects(
            runCodexConfigProbe(
                codexPath,
                cwd,
                {
                    HOME: home,
                    CODEX_HOME: codexHome,
                    PATH: process.env.PATH,
                },
                invalidArgs,
            ),
            /rejected the generated configuration/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("restricted MCP handshake needs only the allowlisted environment and performs no Animate operation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prompt-e2e-mcp-handshake-test-"));
    const isolatedHome = join(directory, "home");
    const outDir = join(directory, "workspace");
    const serverPath = fileURLToPath(new URL("../runner.mjs", import.meta.url));
    try {
        await mkdir(isolatedHome);
        await mkdir(outDir);
        const result = await checkRestrictedMcpHandshake({
            serverPath,
            scenarioName: "stage",
            env: {
                HOME: isolatedHome,
                PATH: process.env.PATH,
                PROMPT_E2E_TRACE_PATH: join(outDir, "trace.jsonl"),
                PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
                PROMPT_E2E_OUT_DIR: outDir,
                PROMPT_E2E_SCENARIO: "stage",
                PRIVATE_TOKEN: "must-not-forward",
                CODEX_HOME: join(directory, "not-forwarded"),
            },
        });
        assert.deepEqual(result, { toolsCount: 3 });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
