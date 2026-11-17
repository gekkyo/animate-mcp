import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CODEX_MCP_ENV_VARS, codexArgs } from "./codex.mjs";
import { writeReadmeDiagnostic } from "./diagnostics.mjs";
import { createAssetsFixture, selectedScenario } from "../scenarios/scenarios.mjs";

const MAX_CODEX_OUTPUT_BYTES = 16_384;

/** Reuses production Codex arguments to build a no-model MCP config-parser command.
 * @param productionArgs Complete arguments returned by codexArgs.
 * @returns Parse-only MCP command and the production config overrides.
 */
export function codexParserArgs(productionArgs) {
    const overrides = [];
    for (let index = 0; index < productionArgs.length; index++) {
        if (productionArgs[index] === "-c") {
            if (typeof productionArgs[index + 1] !== "string") {
                throw new Error("Production Codex config override is incomplete.");
            }
            overrides.push("-c", productionArgs[++index]);
        }
    }
    if (!overrides.length) {
        throw new Error("Production Codex config overrides are missing.");
    }
    return ["mcp", "list", ...overrides];
}

/** Creates the exact restricted environment Codex forwards to its MCP child.
 * @param parentEnv Parent environment.
 * @returns Only default process variables and the explicit README E2E allowlist.
 */
export function codexMcpEnvironment(parentEnv) {
    const result = {};
    for (const name of ["HOME", "PATH", ...CODEX_MCP_ENV_VARS]) {
        if (typeof parentEnv[name] === "string") {
            result[name] = parentEnv[name];
        }
    }
    if (!result.HOME || !result.PATH) {
        throw new Error("Restricted MCP environment requires HOME and PATH.");
    }
    return result;
}

/** Runs isolated config parsing and a no-model restricted MCP handshake.
 * @param options Preflight settings.
 * @param options.serverPath Restricted MCP server entry point.
 * @param options.scenarioName Scenario whose tool allowlist is checked.
 * @param options.codexPath Codex executable for the parser probe.
 * @param options.env Parent environment; only allowlisted values reach MCP.
 * @param options.diagnosticsHome Private diagnostics directory for tests.
 * @param options.diagnosticsVersion Validated version override for tests.
 * @returns Safe preflight status metadata.
 */
export async function runCodexPreflight({
    serverPath,
    scenarioName = "layer",
    codexPath = "codex",
    env = process.env,
    diagnosticsHome,
    diagnosticsVersion,
}) {
    selectedScenario(scenarioName);
    const root = await mkdtemp(join(tmpdir(), "animate-mcp-codex-preflight-"));
    const home = join(root, "home");
    const codexHome = join(root, "codex-home");
    const workingDirectory = join(root, "cwd");
    const outDir = join(root, "workspace");
    const tracePath = join(outDir, "trace.jsonl");
    const fakeServerPath = join(root, "fake-mcp-server.cjs");
    let stage = "startup";
    try {
        for (const path of [home, codexHome, workingDirectory, outDir]) {
            await mkdir(path, { recursive: true, mode: 0o700 });
            await chmod(path, 0o700);
        }
        await writeFile(fakeServerPath, "process.exit(0);\n", { mode: 0o600 });
        const codexEnv = {
            HOME: home,
            CODEX_HOME: codexHome,
            PATH: env.PATH ?? process.env.PATH,
        };
        if (!codexEnv.PATH) {
            throw new Error("Codex preflight requires PATH.");
        }
        stage = "cli";
        const productionArgs = codexArgs(
            fakeServerPath,
            join(outDir, "codex-last-message.txt"),
            workingDirectory,
            "No model call: parse the isolated MCP config only.",
        );
        await runCodexConfigProbe(codexPath, workingDirectory, codexEnv, productionArgs);
        const e2eEnv = {
            ...codexEnv,
            README_E2E_TRACE_PATH: tracePath,
            README_E2E_DOCUMENT_URI: "file:///tmp/readme-e2e-codex-preflight.fla",
            README_E2E_OUT_DIR: outDir,
            README_PROMPT_E2E_SCENARIO: scenarioName,
        };
        if (scenarioName === "assets") {
            const assets = await createAssetsFixture(outDir);
            e2eEnv.README_E2E_ASSET_PATHS = JSON.stringify(assets.paths);
        }
        stage = "mcp-handshake";
        const handshake = await checkRestrictedMcpHandshake({
            serverPath,
            scenarioName,
            env: e2eEnv,
        });
        await writeReadmeDiagnostic(
            {
                event: "codex-preflight",
                outcome: "passed",
                stage,
                provider: "codex",
                scenario: scenarioName,
                mcpHandshake: "passed",
                toolsCount: handshake.toolsCount,
            },
            diagnosticsHome || diagnosticsVersion
                ? { homeDir: diagnosticsHome, cliVersion: diagnosticsVersion }
                : undefined,
        );
        return { mcpHandshake: true, toolsCount: handshake.toolsCount };
    } catch (error) {
        await writeReadmeDiagnostic(
            {
                event: "codex-preflight",
                outcome: "failed",
                stage,
                provider: "codex",
                scenario: scenarioName,
                errorCategory: stage === "cli" ? "cli" : "mcp",
                mcpHandshake: stage === "mcp-handshake" ? "failed" : undefined,
            },
            diagnosticsHome || diagnosticsVersion
                ? { homeDir: diagnosticsHome, cliVersion: diagnosticsVersion }
                : undefined,
        );
        throw error;
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

/** Runs the installed Codex parser against production-generated overrides without exec/model.
 * @param executable Codex CLI executable.
 * @param cwd Empty isolated working directory.
 * @param env Fresh HOME/CODEX_HOME environment.
 * @param productionArgs Complete arguments returned by codexArgs.
 * @returns Resolves after Codex accepts the fake-only MCP configuration.
 */
export async function runCodexConfigProbe(executable, cwd, env, productionArgs) {
    return parseInstalledCodexConfig(executable, cwd, env, codexParserArgs(productionArgs));
}

/** Verifies the restricted MCP server with no model or Animate tool execution.
 * @param options Restricted child settings.
 * @param options.serverPath MCP server entry point.
 * @param options.scenarioName Selected scenario.
 * @param options.env Parent environment, filtered to Codex's explicit allowlist.
 * @param options.captureFrame Whether to invoke only the fixture's pinned frame-12 capture.
 * @returns Safe handshake metadata.
 */
export async function checkRestrictedMcpHandshake({ serverPath, scenarioName, env, captureFrame = false }) {
    const scenario = selectedScenario(scenarioName);
    const childEnv = codexMcpEnvironment(env);
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath, "--mcp-server"],
        env: childEnv,
        stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "animate-readme-e2e-preflight", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        const availableTool = scenario.allowlist?.[0] ?? scenario.tools?.[0]?.name;
        if (!availableTool) {
            throw new Error("Scenario has no tool allowlist to verify.");
        }
        const search = await client.callTool({ name: "search_tools", arguments: { query: availableTool } });
        assert.equal(JSON.parse(search.content?.[0]?.text ?? "null").name, availableTool);
        const excluded = await client.callTool({ name: "search_tools", arguments: { query: "run_jsfl" } });
        assert.notEqual(JSON.parse(excluded.content?.[0]?.text ?? "null").name, "run_jsfl");
        if (captureFrame) {
            assert.equal(scenarioName, "capture");
            const result = await client.callTool({
                name: "execute_write",
                arguments: { name: "capture_frame", arguments: { frame: 12 } },
            });
            if (result.isError) {
                throw new Error("Restricted capture tool failed.");
            }
        }
        return { toolsCount: tools.length };
    } catch {
        throw new Error("Restricted MCP preflight failed.");
    } finally {
        await client.close().catch(() => {});
    }
}

/** Parses a generated fake-only MCP config with the installed Codex CLI.
 * @param executable Codex CLI executable.
 * @param cwd Empty isolated working directory.
 * @param env Fresh HOME/CODEX_HOME environment.
 * @param args Parse-only command arguments with production config overrides.
 * @returns Resolves after Codex accepts the generated config.
 */
function parseInstalledCodexConfig(executable, cwd, env, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
        });
        let stdoutBytes = 0;
        let stdout = "";
        let timedOut = false;
        let resolveClosed;
        const closed = new Promise((resolve) => {
            resolveClosed = resolve;
        });
        child.stdout.on("data", (chunk) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes <= MAX_CODEX_OUTPUT_BYTES) {
                stdout += chunk.toString();
            }
        });
        child.stderr.on("data", (chunk) => {
            stdoutBytes += chunk.length;
        });
        const timeout = setTimeout(async () => {
            timedOut = true;
            try {
                if (process.platform !== "win32") {
                    process.kill(-child.pid, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                // The process may exit between the timeout and kill.
            }
            await closed;
            reject(new Error("Codex isolated config parser timed out."));
        }, 10_000);
        child.once("error", () => {
            clearTimeout(timeout);
            reject(new Error("Codex isolated config parser could not start."));
        });
        child.once("close", (code) => {
            resolveClosed();
            clearTimeout(timeout);
            if (timedOut) {
                return;
            }
            if (code === 0 && stdout.includes("animate-readme-e2e") && stdoutBytes <= MAX_CODEX_OUTPUT_BYTES) {
                resolve();
            } else {
                reject(new Error("Codex isolated config parser rejected the generated configuration."));
            }
        });
    });
}
