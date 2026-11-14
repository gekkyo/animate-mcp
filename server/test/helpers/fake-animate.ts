import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { documentRuntime } from "./fake-animate-document.js";
import { elementsRuntime } from "./fake-animate-elements.js";
import { timelineRuntime } from "./fake-animate-timeline.js";

// Fake Animate: runs the Run file with minimal FLfile/fl stubs.
// Does not respond to code containing HANG, and logs launch start/end to FAKE_LOG.
export const fakeAnimate = `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
/**
 * Writes a message to the configured fake-runtime log when logging is enabled.
 * @param message Message to append to the fake-runtime log
 */
const log = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, message + "\\n");
const logPublish = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".publish", message + "\\n");
const logReadOutput = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".read-output", message + "\\n");
const logTestMovie = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".test-movie", message + "\\n");
const logCapture = (message) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG + ".capture", message + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
${elementsRuntime}${timelineRuntime}${documentRuntime}`;

/**
 * Starts the Server over stdio with env, passes an MCP client to fn, and closes it afterwards.
 * @param env Extra environment variables for the Server
 * @param fn Test body; receives the MCP client, a temp directory and the Runs directory
 * @returns Promise<void> that resolves when fn completes
 */
export async function withServer(
    env: Record<string, string>,
    fn: (client: Client, tempDir: string, runsDir: string) => Promise<void>,
) {
    const tempDir = await mkdtemp(join(tmpdir(), "animate-mcp-test-"));
    const launcher = join(tempDir, "fake-animate.cjs");
    await writeFile(launcher, fakeAnimate);
    await chmod(launcher, 0o755);
    const runsDir = join(tempDir, "runs");
    const client = new Client({ name: "animate-mcp-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "server/src/index.ts"],
        cwd: resolve("."),
        env: {
            ...process.env,
            ANIMATE_MCP_LAUNCH_COMMAND: launcher,
            ANIMATE_MCP_RUNS_DIR: runsDir,
            // Treat the test process itself as "Animate running"
            ANIMATE_MCP_PROCESS_PATTERN: "node",
            FAKE_LOG: join(tempDir, "log"),
            FAKE_DOCUMENT_DIR: join(tempDir, "document"),
            ...env,
        },
    });
    try {
        await client.connect(transport);
        await fn(client, tempDir, runsDir);
    } finally {
        await client.close();
        await rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * Extracts the first text item from an MCP tool result.
 * @param result MCP tool result with optional content
 * @returns The first text item, or an empty string
 */
export const text = (result: { content?: unknown }) => (result.content as Array<{ text: string }>)[0]?.text ?? "";
/**
 * Reads and parses the fake runtime's script-write log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed script log entries
 */
export const scriptsLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.scripts"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
/**
 * Reads and parses the fake runtime's layer-state log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed layer snapshots
 */
export const layersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
/** Reads the fake runtime's final timeline selection state. */
export const stateLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.state"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));
/**
 * Reads and parses the fake runtime's symbol-layer log.
 * @param tempDir Directory containing the fake-runtime logs
 * @returns Parsed symbol-layer snapshots
 */
export const symbolLayersLog = async (tempDir: string) =>
    (await readFile(join(tempDir, "log.sym-layers"), "utf8"))
        .trim()
        .split("\n")
        .map((logLine) => JSON.parse(logLine));

/**
 * Calls the edit_timeline MCP tool with the supplied operations.
 * @param client Connected MCP client
 * @param timeline Timeline index or library item name
 * @param ops Timeline operations to apply
 * @returns The MCP tool call promise
 */
export const editTimeline = (client: Client, timeline: number | string, ops: unknown[]) =>
    client.callTool({ name: "edit_timeline", arguments: { timeline, ops } });

/**
 * Calls the edit_tween MCP tool with the supplied operations.
 * @param client Connected MCP client
 * @param timeline Timeline index or library item name
 * @param ops Tween operations to apply
 * @returns The MCP tool call promise
 */
export const editTween = (client: Client, timeline: number | string, ops: unknown[]) =>
    client.callTool({ name: "edit_tween", arguments: { timeline, ops } });

export const SCENE_FILE = "scenes/Scene 1/a_b/1.as";
