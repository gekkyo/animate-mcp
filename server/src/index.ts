#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isAnimateRunning, launcher } from "./runtime/animate-launcher.js";
import { bundle } from "./runtime/jsfl-bundle.js";
import { createRunner } from "./runtime/runner.js";
import { auditDocumentTool } from "./tools/document/audit-document.js";
import { closeDocumentTool } from "./tools/document/close-document.js";
import { getDocumentInfoTool } from "./tools/document/get-document-info.js";
import { getStatusTool } from "./tools/document/get-status.js";
import { openDocumentTool } from "./tools/document/open-document.js";
import { saveDocumentTool } from "./tools/document/save-document.js";
import { setDocumentPropertiesTool } from "./tools/document/set-document-properties.js";
import { editLibraryTool } from "./tools/library/edit-library.js";
import { importAssetsTool } from "./tools/library/import-assets.js";
import { captureFrameTool } from "./tools/output/capture-frame.js";
import { diffCapturesTool } from "./tools/output/diff-captures.js";
import { getAirDescriptorTool } from "./tools/output/get-air-descriptor.js";
import { preflightPublishTool } from "./tools/output/preflight-publish.js";
import { publishTool } from "./tools/output/publish.js";
import { readOutputTool } from "./tools/output/read-output.js";
import { setAirDescriptorTool } from "./tools/output/set-air-descriptor.js";
import { testMovieTool } from "./tools/output/test-movie.js";
import { verifyCanvasOutputTool } from "./tools/output/verify-canvas-output.js";
import { visualRegressionTool } from "./tools/output/visual-regression.js";
import { runsDir } from "./tools/core/paths.js";
import { createToolRegistry } from "./tools/core/registry.js";
import { runJsflTool } from "./tools/core/run-jsfl.js";
import { applyScriptsTool } from "./tools/scripts/apply-scripts.js";
import { exportScriptsTool } from "./tools/scripts/export-scripts.js";
import { installGreensockTool } from "./tools/scripts/install-greensock.js";
import { convertToSymbolTool } from "./tools/timeline/convert-to-symbol.js";
import { editElementsTool } from "./tools/timeline/edit-elements.js";
import { editTextTool } from "./tools/timeline/edit-text.js";
import { editTimelineTool } from "./tools/timeline/edit-timeline.js";
import { editTweenTool } from "./tools/timeline/edit-tween.js";
import { inspectTimelineTool } from "./tools/timeline/inspect-timeline.js";

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
    diffCapturesTool,
    getDocumentInfoTool,
    readOutputTool,
    runJsflTool,
    openDocumentTool,
    saveDocumentTool,
    closeDocumentTool,
    auditDocumentTool,
    convertToSymbolTool,
    testMovieTool,
    verifyCanvasOutputTool,
    importAssetsTool,
    setDocumentPropertiesTool,
    getStatusTool,
    getAirDescriptorTool,
    setAirDescriptorTool,
    preflightPublishTool,
    visualRegressionTool,
] as const;
const registry = createToolRegistry(TOOLS, { entrances: true });
export const INSTRUCTIONS = registry.instructions;

/** Reads the package version from the location shared by src/ and dist/. */
const PACKAGE_VERSION = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Default timeout for one Run in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Builds the Runner, registers the MCP tools and listens on stdio.
 * @param activeRegistry Registry to expose over stdio
 * @returns Resolves once connected; rejects on failure so the caller can set the exit code.
 */
export async function serve(activeRegistry: ReturnType<typeof createToolRegistry>) {
    const runner = createRunner({
        dir: runsDir(),
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: Number(process.env.ANIMATE_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    });
    const server = new McpServer(
        { name: "animate-mcp", version: PACKAGE_VERSION },
        { instructions: activeRegistry.instructions },
    );
    activeRegistry.register(server, { runner, bundle });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

/**
 * Starts the production server with its compact Entrance registry.
 * @returns Resolves once connected; rejects on failure so the caller can set the exit code.
 */
export async function startServer() {
    await serve(registry);
}

/** Reports startup failures and sets a failing process exit code.
 * @param error Startup failure to report
 * @returns Nothing
 */
export function reportStartupError(error: unknown): void {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

// npx runs the bin through a node_modules/.bin symlink; import.meta.url is the resolved path.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
    startServer().catch(reportStartupError);
}
