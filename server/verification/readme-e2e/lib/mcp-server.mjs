import { appendFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isAnimateRunning, launcher } from "../../../dist/runtime/animate-launcher.js";
import { createRunner } from "../../../dist/runtime/runner.js";
import { registerEntrances } from "../../../dist/tools/core/entrance.js";
import { createJsflRunner } from "../../../dist/tools/core/shared.js";
import { getStatusTool } from "../../../dist/tools/document/get-status.js";
import { applyScriptsTool } from "../../../dist/tools/scripts/apply-scripts.js";
import { exportScriptsTool } from "../../../dist/tools/scripts/export-scripts.js";
import { assertPinnedAssetPaths } from "../scenarios/document.mjs";
import { CANVAS_ERROR_MARKER, scenarios, selectedScenario, TEST_MOVIE_MARKER } from "../scenarios/scenarios.mjs";
import { readExportFile, writeExportScript } from "./workspace.mjs";

/** Pins timeline operations to the disposable FLA and records the exact target/result.
 * @param tool Tool definition to restrict.
 * @param documentPath Exact disposable FLA URI.
 * @param checkStatus Status probe, injectable for tests.
 * @param outDir Root of the disposable E2E workspace.
 * @param assetPaths Exact disposable asset paths permitted by the scenario.
 * @returns Tool definition wrapped with document isolation and trace recording.
 */
export function scoped(
    tool,
    documentPath,
    checkStatus = (deps) => getStatusTool.run({}, deps),
    outDir = process.env.README_E2E_OUT_DIR,
    assetPaths,
) {
    return {
        ...tool,
        run: async (...args) => {
            const started = Date.now();
            let succeeded = false;
            let failureStage;
            try {
                const [input, deps, extra] = args;
                if (tool.name === "get_status") {
                    const result = await tool.run(input, deps, extra);
                    succeeded = true;
                    return result;
                }
                const status = await checkStatus(deps);
                const documents = status.data?.documents ?? [];
                if (documents.length !== 1 || documents[0].path !== documentPath) {
                    failureStage = "document-scope";
                    throw new Error("Safety check failed: Animate must have only the disposable FLA open.");
                }
                failureStage = "tool";
                if (tool.name === "edit_library" && (input.ops?.length !== 1 || input.ops[0]?.op !== "listUnused")) {
                    throw new Error("Safety check failed: only the read-only listUnused operation is allowed.");
                }
                if (tool.name === "capture_frame" && input.range !== undefined) {
                    throw new Error("Safety check failed: only frame 12 may be captured; ranges are not allowed.");
                }
                if (tool.name === "read_export_file") {
                    const result = await tool.run(input, deps, extra);
                    succeeded = true;
                    return result;
                }
                if (tool.name === "write_export_script") {
                    const result = await tool.run(input, deps, extra);
                    succeeded = true;
                    return result;
                }
                let toolInput = tool.name === "get_document_info" ? input : { ...input, document: documents[0].name };
                if (tool.name === "import_assets") {
                    toolInput = {
                        ...input,
                        paths: assertPinnedAssetPaths(input.paths, assetPaths),
                        document: documents[0].name,
                    };
                } else if (tool.name === "export_scripts") {
                    const dir = join(outDir, "export");
                    if ((input.dir && input.dir !== dir) || input.force === true) {
                        throw new Error("Safety check failed: export dir is pinned and force must remain false.");
                    }
                    toolInput = { ...input, document: documents[0].name, dir, force: false };
                } else if (tool.name === "apply_scripts") {
                    const dir = join(outDir, "export");
                    if (input.dir !== dir) {
                        throw new Error("Safety check failed: apply dir must be the disposable export directory.");
                    }
                    toolInput = { ...input, document: documents[0].name, dir };
                } else if (tool.name === "capture_frame") {
                    toolInput = { frame: 12, dir: join(outDir, "captures") };
                } else if (tool.name === "verify_canvas_output") {
                    toolInput = {
                        document: documents[0].name,
                        publish: true,
                        htmlPath: resolve(outDir, `${basename(outDir)}.html`),
                        observeMs: Math.min(input.observeMs ?? 3000, 5000),
                    };
                }
                const result = await tool.run(toolInput, deps, extra);
                if (tool.name === "edit_timeline") {
                    succeeded = result.data?.failed === null;
                } else if (tool.name === "export_scripts") {
                    succeeded = result.data?.failed?.length === 0;
                } else if (tool.name === "apply_scripts") {
                    succeeded = result.data?.failed?.length === 0 && result.data?.applied?.length > 0;
                } else if (tool.name === "edit_text") {
                    succeeded = result.data?.applied > 0;
                } else if (tool.name === "edit_tween") {
                    succeeded = result.data?.applied?.length > 0 && result.data?.failed === null;
                } else if (tool.name === "edit_elements") {
                    succeeded = result.data?.applied > 0;
                } else if (tool.name === "convert_to_symbol") {
                    succeeded = result.data?.name === "ball_mc" && result.data?.type === "movie clip";
                } else if (tool.name === "inspect_timeline") {
                    succeeded = !result.isError && result.data !== undefined;
                } else if (tool.name === "edit_library") {
                    succeeded =
                        result.data?.failed === null &&
                        result.data?.applied?.some((operation) => operation.op === "listUnused");
                } else if (tool.name === "capture_frame") {
                    succeeded = result.data?.frame === 12 && result.content?.some((item) => item.type === "image");
                    await writeFile(join(outDir, "capture-evidence.json"), JSON.stringify(result));
                } else if (tool.name === "import_assets") {
                    succeeded =
                        !result.isError &&
                        result.data?.document === documents[0].name &&
                        Array.isArray(result.data?.items) &&
                        JSON.stringify([...result.data.items].sort()) ===
                            JSON.stringify(assetPaths.map((path) => basename(path)).sort());
                } else if (tool.name === "publish") {
                    succeeded =
                        !result.isError &&
                        result.data?.compilerOutput === "verified" &&
                        result.data?.ok === false &&
                        Array.isArray(result.data?.errors) &&
                        result.data.errors.length > 0;
                } else if (tool.name === "test_movie") {
                    succeeded =
                        !result.isError &&
                        typeof result.data?.runtimeOutput === "string" &&
                        result.data.runtimeOutput.includes(TEST_MOVIE_MARKER) &&
                        result.data.compilerDiagnostics?.status === "parsed" &&
                        Array.isArray(result.data.compilerDiagnostics.errors) &&
                        result.data.compilerDiagnostics.errors.length === 0;
                } else if (tool.name === "verify_canvas_output") {
                    succeeded = Boolean(
                        !result.isError &&
                            result.data?.browserOutput?.consoleErrors?.some((message) =>
                                message.includes(CANVAS_ERROR_MARKER),
                            ),
                    );
                } else {
                    succeeded = true;
                }
                return result;
            } finally {
                const tracePath = process.env.README_E2E_TRACE_PATH;
                if (tracePath) {
                    await appendFile(
                        tracePath,
                        `${JSON.stringify({ targetTool: tool.name, succeeded, failureStage: succeeded ? undefined : failureStage, durationMs: Date.now() - started })}\n`,
                    );
                }
            }
        },
    };
}

/** Starts the restricted MCP server without exposing direct JSFL or document operations. */
export async function serveRestricted() {
    const scenario = selectedScenario();
    const documentPath = process.env.README_E2E_DOCUMENT_URI;
    const outDir = process.env.README_E2E_OUT_DIR;
    if (!documentPath) {
        throw new Error("The restricted MCP server requires the disposable document URI.");
    }
    if (
        [
            scenarios.script,
            scenarios.investigate,
            scenarios.capture,
            scenarios.assets,
            scenarios.publish,
            scenarios.canvas,
        ].includes(scenario) &&
        !outDir
    ) {
        throw new Error("This scenario requires its disposable workspace directory.");
    }
    const assetPaths = scenario === scenarios.assets ? [join(outDir, "hero.png"), join(outDir, "bgm.mp3")] : undefined;
    if (assetPaths) {
        let configuredPaths;
        try {
            configuredPaths = JSON.parse(process.env.README_E2E_ASSET_PATHS ?? "null");
        } catch {
            throw new Error("The assets scenario requires its exact fixture paths.");
        }
        assertPinnedAssetPaths(configuredPaths, assetPaths);
    }
    const runner = createRunner({
        dir: join(process.env.HOME, ".animate-mcp", "runs"),
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: 30_000,
    });
    const server = new McpServer(
        { name: "animate-readme-e2e", version: "1.0.0" },
        { instructions: scenario.instruction },
    );
    let scenarioTools;
    if (scenario === scenarios.script) {
        scenarioTools = [
            getStatusTool,
            exportScriptsTool,
            applyScriptsTool,
            {
                name: "read_export_file",
                description: "Read the existing scene 1 frame 1 AS3 script from the disposable export.",
                annotations: { readOnlyHint: true },
                inputSchema: {
                    file: z
                        .string()
                        .describe(
                            'Relative file inside the disposable export, e.g. "index.md", "scenes/<scene-name>/structure.md", or the frame script path listed there. Never an absolute path.',
                        ),
                },
                run: ({ file }) => readExportFile(join(process.env.README_E2E_OUT_DIR, "export"), file),
            },
            {
                name: "write_export_script",
                description: "Write the existing scene 1 frame 1 AS3 script in the disposable export.",
                annotations: { readOnlyHint: false, destructiveHint: true },
                inputSchema: {
                    file: z
                        .string()
                        .describe(
                            "Exact relative frame-one AS3 script path copied from scenes/<scene-name>/structure.md; never an absolute path.",
                        ),
                    content: z.string().describe("Complete edited ActionScript source for that existing frame script."),
                },
                run: ({ file, content }) =>
                    writeExportScript(join(process.env.README_E2E_OUT_DIR, "export"), file, content),
            },
        ];
    } else if (scenario === scenarios.investigate) {
        scenarioTools = [
            getStatusTool,
            exportScriptsTool,
            {
                name: "read_export_file",
                description: "Read the existing scene 1 frame 1 AS3 script from the disposable export.",
                annotations: { readOnlyHint: true },
                inputSchema: {
                    file: z
                        .string()
                        .describe("Relative export metadata path or the frame-one AS3 script path shown there."),
                },
                run: ({ file }) => readExportFile(join(process.env.README_E2E_OUT_DIR, "export"), file),
            },
        ];
    } else {
        scenarioTools = scenario.tools;
    }
    registerEntrances(
        server,
        scenarioTools.map((tool) => scoped(tool, documentPath, undefined, outDir, assetPaths)),
        { runner, jsfl: createJsflRunner(runner) },
    );
    await server.connect(new StdioServerTransport());
}
