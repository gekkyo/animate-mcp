#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isAnimateRunning, launcher } from "./animate-launcher.js";
import { bundle } from "./jsfl-bundle.js";
import { createRunner } from "./runner.js";
import { applyScriptsTool } from "./tools/apply-scripts.js";
import { captureFrameTool } from "./tools/capture-frame.js";
import { closeDocumentTool } from "./tools/close-document.js";
import { convertToSymbolTool } from "./tools/convert-to-symbol.js";
import { editElementsTool } from "./tools/edit-elements.js";
import { editLibraryTool } from "./tools/edit-library.js";
import { editTextTool } from "./tools/edit-text.js";
import { editTimelineTool } from "./tools/edit-timeline.js";
import { editTweenTool } from "./tools/edit-tween.js";
import { exportScriptsTool } from "./tools/export-scripts.js";
import { getDocumentInfoTool } from "./tools/get-document-info.js";
import { importAssetsTool } from "./tools/import-assets.js";
import { inspectTimelineTool } from "./tools/inspect-timeline.js";
import { installGreensockTool } from "./tools/install-greensock.js";
import { openDocumentTool } from "./tools/open-document.js";
import { publishTool } from "./tools/publish.js";
import { readOutputTool } from "./tools/read-output.js";
import { createToolRegistry } from "./tools/registry.js";
import { runJsflTool } from "./tools/run-jsfl.js";
import { saveDocumentTool } from "./tools/save-document.js";
import { setDocumentPropertiesTool } from "./tools/set-document-properties.js";
import { testMovieTool } from "./tools/test-movie.js";

export const TOOLS = [
    exportScriptsTool,
    editTimelineTool,
    editElementsTool,
    editTextTool,
    inspectTimelineTool,
    editTweenTool,
    editLibraryTool,
    applyScriptsTool,
    installGreensockTool,
    publishTool,
    captureFrameTool,
    getDocumentInfoTool,
    readOutputTool,
    runJsflTool,
    openDocumentTool,
    saveDocumentTool,
    closeDocumentTool,
    convertToSymbolTool,
    testMovieTool,
    importAssetsTool,
    setDocumentPropertiesTool,
] as const;
const registry = createToolRegistry(TOOLS);
export const INSTRUCTIONS = registry.instructions;

/** Version from package.json (the same relative path from src/ and dist/) */
const PACKAGE_VERSION = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Default timeout for one Run in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Builds the Runner, registers the MCP tools and listens on stdio.
 * @returns Promise<void> that resolves once connected (rejects on failure; the caller sets the exit code)
 */
async function main() {
    const runner = createRunner({
        dir: process.env.ANIMATE_MCP_RUNS_DIR ?? join(homedir(), ".animate-mcp", "runs"),
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: Number(process.env.ANIMATE_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    });
    const server = new McpServer({ name: "animate-mcp", version: PACKAGE_VERSION }, { instructions: INSTRUCTIONS });
    registry.register(server, { runner, bundle });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch(
        /** Reports startup failures and sets a failing process exit code.
         * @param error Startup failure to report
         * @returns Nothing
         */
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        },
    );
}
