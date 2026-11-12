#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isAnimateRunning, launcher } from "./animate-launcher.js";
import { bundle } from "./jsfl-bundle.js";
import { createRunner } from "./runner.js";
import { registerApplyScripts } from "./tools/apply-scripts.js";
import { registerEditLibrary } from "./tools/edit-library.js";
import { registerEditTimeline } from "./tools/edit-timeline.js";
import { registerEditTween } from "./tools/edit-tween.js";
import { registerExportScripts } from "./tools/export-scripts.js";
import { registerGetDocumentInfo } from "./tools/get-document-info.js";
import { registerInspectTimeline } from "./tools/inspect-timeline.js";
import { registerInstallGreensock } from "./tools/install-greensock.js";
import { registerPublish } from "./tools/publish.js";
import { registerRunJsfl } from "./tools/run-jsfl.js";

/** Version from package.json (the same relative path from src/ and dist/) */
const PACKAGE_VERSION = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Usage guidance for MCP clients (operational notes that do not fit in tool descriptions) */
const INSTRUCTIONS = `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; the user saves it.
- To add a script to a frame with none, create <timeline dir>/as/<frame>.as (or .js for HTML Canvas), avoid tween spans, and run apply_scripts.
- Use edit_timeline for layer or frame structure changes. shiftLayerFrames moves one layer's content later without shifting other layers. Always run export_scripts again before editing or applying scripts; delete operations require confirm: true.
- Use inspect_timeline to check instances and tweens instead of run_jsfl; use the distributeToLayers operation to split a layer.
- Use edit_tween to animate instances; motion is the default and ease presets include quad, cubic, quart, quint, sine, expo, circ and back.
- Use edit_library to organize library folders and items. Re-export with export_scripts before apply_scripts; deleteItem requires confirm: true and refuses items in use.
- If a frame changed in Animate before you applied, Export is refused and Apply skips that frame. Export again to pull in the change.
- If get_document_info reports greensock: true, use TweenLite/TweenMax (import com.greensock.*). For AS3 with greensock: false, use fl.transitions.Tween or propose install_greensock (confirm: true; AS3 only).
- For HTML5 Canvas, use createjs.Tween; install_greensock does not support Canvas.
- Use publish to publish AS3 documents and check the Build result; outputs at the document's publish settings are overwritten, and compile errors are returned as a normal result.

Notes:
- When several documents are open, document is required. get_document_info returns the name.
- AS3 and HTML5 Canvas have different APIs. Check the document type before trying things with run_jsfl.
- Runtime errors appear in Animate's Output panel. Run fl.outputPanel.save(FLfile.platformPathToURI("<native OS path>")) with run_jsfl and read the saved file (saving under ~/.animate-mcp/ is recommended; write the path in the usual form for the OS).
- When a script fails with a null error, first check the layer's frame length and instance names with run_jsfl.
- If you add debug traces, always remove them after checking and Apply again.
- run_jsfl runs arbitrary code. Ask the user before any operation that modifies the document.`;

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
    registerRunJsfl(server, { runner });
    registerGetDocumentInfo(server, { runner, bundle });
    registerInstallGreensock(server, { runner, bundle });
    registerExportScripts(server, { runner, bundle });
    registerEditTimeline(server, { runner, bundle });
    registerInspectTimeline(server, { runner, bundle });
    registerEditTween(server, { runner, bundle });
    registerEditLibrary(server, { runner, bundle });
    registerApplyScripts(server, { runner, bundle });
    registerPublish(server, { runner, bundle });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

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
