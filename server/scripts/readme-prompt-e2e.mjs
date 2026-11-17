// Manual paid check: npm run build && RUN_README_PROMPT_E2E=1 node server/scripts/readme-prompt-e2e.mjs
// Select with README_PROMPT_E2E_SCENARIO=layer|stage|script|investigate|text|tween|instance|symbol|inspect|library|capture|assets|publish|testmovie|canvas (default: layer).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PNG } from "pngjs";
import { z } from "zod";
import { isAnimateRunning, launcher } from "../dist/runtime/animate-launcher.js";
import { bundle } from "../dist/runtime/jsfl-bundle.js";
import { createRunner } from "../dist/runtime/runner.js";
import { getDocumentInfoTool, registerGetDocumentInfo } from "../dist/tools/document/get-document-info.js";
import { getStatusTool, registerGetStatus } from "../dist/tools/document/get-status.js";
import { registerOpenDocument } from "../dist/tools/document/open-document.js";
import { registerSaveDocument } from "../dist/tools/document/save-document.js";
import { setDocumentPropertiesTool } from "../dist/tools/document/set-document-properties.js";
import { registerEntrances } from "../dist/tools/entrance.js";
import { editLibraryTool } from "../dist/tools/library/edit-library.js";
import { importAssetsTool } from "../dist/tools/library/import-assets.js";
import { captureFrameTool } from "../dist/tools/output/capture-frame.js";
import { publishTool } from "../dist/tools/output/publish.js";
import { testMovieTool } from "../dist/tools/output/test-movie.js";
import { verifyCanvasOutputTool } from "../dist/tools/output/verify-canvas-output.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { applyScriptsTool } from "../dist/tools/scripts/apply-scripts.js";
import { exportScriptsTool } from "../dist/tools/scripts/export-scripts.js";
import { convertToSymbolTool } from "../dist/tools/timeline/convert-to-symbol.js";
import { editElementsTool } from "../dist/tools/timeline/edit-elements.js";
import { editTextTool } from "../dist/tools/timeline/edit-text.js";
import { editTimelineTool } from "../dist/tools/timeline/edit-timeline.js";
import { editTweenTool, registerEditTween } from "../dist/tools/timeline/edit-tween.js";
import { inspectTimelineTool, registerInspectTimeline } from "../dist/tools/timeline/inspect-timeline.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "./smoke-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const investigationScript = "var readmeTotal:Number = (1 + 2;";
const scenarios = {
    layer: {
        prompt: "シーン1に『背景』レイヤーを追加して、24フレーム分に延ばして",
        tools: [getStatusTool, inspectTimelineTool, editTimelineTool],
        instruction:
            "Only get_status, inspect_timeline, and edit_timeline are available. Use search_tools, then the matching execute entrance. Modify only the open disposable FLA.",
    },
    stage: {
        prompt: "ステージを 1280×720、30fps、背景を黒にして",
        tools: [getStatusTool, getDocumentInfoTool, setDocumentPropertiesTool],
        instruction:
            "Only get_status, get_document_info, and set_document_properties are available. Use search_tools, then the matching execute entrance. Modify only the open disposable FLA.",
    },
    script: {
        prompt: "シーン1の1フレーム目のスクリプトに stop() を追加して反映して",
        tools: [],
        allowlist: ["get_status", "export_scripts", "apply_scripts", "read_export_file", "write_export_script"],
        instruction:
            'Only get_status, export_scripts, apply_scripts, read_export_file, and write_export_script are available. Use search_tools and the matching execute entrance. Export first. Call read_export_file with file: "index.md", then call it with the relative "scenes/<scene-name>/structure.md" path shown in index.md. Copy the existing scene-one frame-one AS3 script path from that structure.md and use that exact relative path for read_export_file and write_export_script; do not pass an absolute path or export directory. Then apply using the export directory returned by export_scripts. Modify only the open disposable FLA.',
    },
    investigate: {
        prompt: "開いているドキュメントのスクリプトを書き出して、エラーの原因を調べて",
        tools: [getStatusTool, exportScriptsTool],
        instruction:
            'Only get_status, export_scripts, and read_export_file are available. Use search_tools and the matching execute entrance. Export scripts, read "index.md", then read the scene-one "structure.md" path linked there. From that structure, read the exact frame-one AS3 script path for scene 1 and diagnose its syntax error. Do not modify anything or use any other tool.',
    },
    text: {
        prompt: "シーン1の『テキスト』レイヤーの30フレーム目に、48pt・太字で「GAME OVER」というテキストを追加して",
        tools: [getStatusTool, inspectTimelineTool, editTextTool],
        instruction:
            'Only get_status, inspect_timeline, and edit_text are available. Use search_tools, then the matching execute entrance. Add exactly one text field with edit_text: timeline 0, op add, layer "テキスト", frame 30, text "GAME OVER", style { size: 48, bold: true }, and a rectangle inside the 550×400 stage (for example left 100, top 100, right 450, bottom 180). Do not set font or text type. Modify only the open disposable FLA.',
    },
    tween: {
        prompt: "シーン1の『ボール』インスタンスを1〜24フレームで右へ200px動かし、イーズに backOut（少し行き過ぎて戻る）を使って",
        tools: [getStatusTool, inspectTimelineTool, editTweenTool],
        instruction:
            'Only get_status, inspect_timeline, and edit_tween are available. Use search_tools, then the matching execute entrance. The disposable scene already has a 24-frame BallLayer with the sole instance named "ボール" held from frame 1; create a motion tween on timeline 0 for frames 1–24 using dx: 200 on frame 24 and ease: "backOut". Do not add tools or edit any other object.',
    },
    instance: {
        prompt: "シーン1の1フレーム目の『ボール』インスタンスを透明度50%にして、ぼかしフィルターを付けて",
        tools: [getStatusTool, inspectTimelineTool, editElementsTool],
        instruction:
            'Only get_status, inspect_timeline, and edit_elements are available. Use search_tools, then the matching execute entrance. On timeline 0, update layer "BallLayer", frame 1, element "ボール" using set { colorEffect: { mode: "alpha", alphaPercent: 50 }, filters: [{ name: "blurFilter", blurX: 4, blurY: 4, quality: "low" }] }. Supplying filters replaces the filter list. Modify only this disposable FLA and do not use any other tools.',
    },
    symbol: {
        prompt: "シーン1の1フレーム目の『ボール』を、ムービークリップ ball_mc に変換して",
        tools: [getStatusTool, inspectTimelineTool, convertToSymbolTool],
        instruction:
            "Only get_status, inspect_timeline, and convert_to_symbol are available. Use search_tools, then the matching execute entrance. Modify only the open disposable FLA.",
    },
    inspect: {
        prompt: "シーン1の『キャラ』レイヤーの12フレーム目にあるインスタンスとトゥイーンを確認して",
        tools: [getStatusTool, inspectTimelineTool],
        instruction:
            "Only get_status and inspect_timeline are available. Use search_tools, then the matching read-only execute entrance. Do not call any write tool.",
    },
    library: {
        prompt: "ライブラリの未使用アイテムを一覧にして",
        tools: [getStatusTool, editLibraryTool],
        instruction:
            'Only get_status and edit_library are available. Use search_tools, then execute_write with edit_library using exactly { ops: [{ op: "listUnused" }] }. This operation only lists items; do not use any other operation or tool.',
    },
    capture: {
        prompt: "シーン1の12フレーム目を画像で取得して、見た目を教えて",
        tools: [getStatusTool, captureFrameTool],
        instruction:
            "Only get_status and capture_frame are available. Use search_tools, then execute_write with capture_frame. Capture exactly frame 12; do not request a range or use any other tool. Describe the visible shapes and their colors from the image.",
    },
    assets: {
        prompt: "/path/to/hero.png と /path/to/bgm.mp3 をライブラリに取り込んで",
        tools: [getStatusTool, importAssetsTool],
        instruction:
            "Only get_status and import_assets are available. Use search_tools and execute_write with exactly the two pinned fixture paths. Import both into the disposable FLA Library; do not use any other tool.",
    },
    publish: {
        prompt: "開いているドキュメントを Publish して、コンパイルエラーを教えて",
        tools: [getStatusTool, publishTool],
        instruction:
            'Only get_status and publish are available. Use search_tools, then execute_write with publish. Report the compiler error from the verified Build result; do not claim the build is clean unless compilerOutput is "verified". Do not use any other tool.',
    },
    testmovie: {
        prompt: "開いている AS3 ドキュメントを Test Movie で実行して、コンパイルエラーと起動直後の出力を教えて",
        tools: [getStatusTool, testMovieTool],
        instruction:
            "Only get_status and test_movie are available. Use search_tools, then execute_write with test_movie. Report whether compilation has errors and quote the startup output marker. Do not use any other tool.",
    },
    canvas: {
        prompt: "Canvas 出力を Chrome で開いて、コンソールエラーがないか確認して",
        tools: [getStatusTool, verifyCanvasOutputTool],
        instruction:
            "Only get_status and verify_canvas_output are available. Use search_tools, then execute_write with verify_canvas_output. Report whether console errors exist and include the fixture error marker. Do not use any other tool.",
    },
};
const MAX_SCRIPT_BYTES = 64 * 1024;
const prompt = scenarios.layer.prompt;
const README_ASSETS_PROMPT = scenarios.assets.prompt;
const ASSET_LIBRARY_NAMES = ["bgm.mp3", "hero.png"];
const TEST_MOVIE_MARKER = "README_TEST_MOVIE_OK";
const CANVAS_ERROR_MARKER = "README_CANVAS_ERROR_MARKER";
const CANVAS_FRAME_SCRIPT = `console.error("${CANVAS_ERROR_MARKER}");`;

/** Builds a valid 1-by-1 RGBA PNG fixture.
 * @returns PNG file bytes.
 */
function assetPng() {
    /** Calculates the PNG chunk checksum.
     * @param data Chunk bytes.
     * @returns CRC-32 checksum.
     */
    const crc32 = (data) => {
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) {
                crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
            }
        }
        return (crc ^ 0xffffffff) >>> 0;
    };
    /** Builds one PNG chunk with its length and checksum.
     * @param type Four-character chunk type.
     * @param data Chunk bytes.
     * @returns Encoded PNG chunk.
     */
    const chunk = (type, data) => {
        const name = Buffer.from(type, "ascii");
        const bytes = Buffer.alloc(data.length + 12);
        bytes.writeUInt32BE(data.length, 0);
        name.copy(bytes, 4);
        data.copy(bytes, 8);
        bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8);
        return bytes;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.from([0, 64, 128, 192, 255]))),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/** Generates real disposable assets and substitutes their absolute paths into the README prompt.
 * @param outDir Disposable E2E workspace.
 * @returns Asset paths and a runnable prompt.
 */
async function createAssetsFixture(outDir) {
    const imagePath = join(outDir, "hero.png");
    const audioPath = join(outDir, "bgm.mp3");
    await writeFile(imagePath, assetPng());
    // Silent MPEG-1 Layer III frames (44.1kHz, 128kbps stereo, 417 bytes each, ~1s): no ffmpeg needed.
    const silentFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
    await writeFile(audioPath, Buffer.concat(Array.from({ length: 39 }, () => silentFrame)));
    const prompt = README_ASSETS_PROMPT.replace("/path/to/hero.png", imagePath).replace("/path/to/bgm.mp3", audioPath);
    return { paths: [imagePath, audioPath], prompt };
}

/** Returns the selected README scenario, defaulting to the established layer case.
 * @param name Scenario name.
 * @returns Scenario configuration.
 */
function selectedScenario(name = process.env.README_PROMPT_E2E_SCENARIO ?? "layer") {
    const scenario = scenarios[name];
    if (!scenario) {
        throw new Error(
            'README_PROMPT_E2E_SCENARIO must be "layer", "stage", "script", "investigate", "text", "tween", "instance", "symbol", "inspect", "library", "capture", "assets", "publish", "testmovie", or "canvas".',
        );
    }
    return scenario;
}

/** Reads approved export metadata or the existing scene-one frame-one AS3 script.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Text content.
 */
async function readExportFile(outDir, file) {
    const { target } = await exportFileContext(outDir, file);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SCRIPT_BYTES) {
        throw new Error("Export file must be a regular file no larger than 64 KB.");
    }
    const content = await readFile(target);
    if (content.byteLength > MAX_SCRIPT_BYTES) {
        throw new Error("Export file must be a regular file no larger than 64 KB.");
    }
    return { data: { content: content.toString("utf8") } };
}

/** Writes only the manifested scene-one frame-one AS3 script in the disposable export.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @param content Replacement source.
 * @returns Write confirmation.
 */
async function writeExportScript(outDir, file, content) {
    const target = await exportScriptTarget(outDir, file);
    if (Buffer.byteLength(content, "utf8") > MAX_SCRIPT_BYTES) {
        throw new Error("Export script content exceeds 64 KB.");
    }
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Export script must be an existing regular file.");
    }
    const handle = await open(target, "r+");
    try {
        await handle.writeFile(content, "utf8");
        await handle.truncate(Buffer.byteLength(content, "utf8"));
    } finally {
        await handle.close();
    }
    return { data: { written: true } };
}

/** Resolves a safe manifest-authorized export path and rejects symlink parents.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Export root, manifest, target, and file kind.
 */
async function exportFileContext(outDir, file) {
    if (
        typeof file !== "string" ||
        !file ||
        file.includes("\0") ||
        file.includes("\\") ||
        isAbsolute(file) ||
        file.split("/").some((part) => !part || part === "." || part === "..")
    ) {
        throw new Error("Only the scene 1 frame 1 AS3 export script is allowed.");
    }
    const root = await realpath(outDir);
    const target = resolve(root, file);
    const parent = dirname(target);
    const parentInfo = await lstat(parent);
    if (parentInfo.isSymbolicLink() || (await realpath(parent)) !== parent) {
        throw new Error("Export script directory must not contain symlinks.");
    }
    const rel = relative(root, target);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
        throw new Error("Export script path escapes the export directory.");
    }
    const manifest = JSON.parse(await readFile(join(root, ".export.json"), "utf8"));
    const entry = manifest.files?.[file];
    const timeline = manifest.timelines?.find(({ scene, item }) => scene === 0 && item === undefined);
    const scriptAllowed =
        manifest.type === "Flash" &&
        entry?.scene === 0 &&
        entry.layer === 0 &&
        entry.start === 0 &&
        entry.item === undefined &&
        /^scenes\/[^/]+\/[^/]+\/1\.as$/.test(file);
    const metadataAllowed = file === "index.md" || (timeline && file === `${timeline.dir}/structure.md`);
    if (!metadataAllowed && !scriptAllowed) {
        throw new Error("Export manifest does not contain the allowed scene frame script.");
    }
    return { root, manifest, target, kind: metadataAllowed ? "metadata" : "script" };
}

/** Resolves a safe manifested script path under the disposable export.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Absolute target path.
 */
async function exportScriptTarget(outDir, file) {
    const context = await exportFileContext(outDir, file);
    if (context.kind !== "script") {
        throw new Error("Only the manifested scene frame script may be written.");
    }
    const info = await lstat(context.target);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Export script must be an existing regular file.");
    }
    return context.target;
}

/** Pins timeline operations to the disposable FLA and records the exact target/result.
 * @param tool Tool definition to restrict.
 * @param documentPath Exact disposable FLA URI.
 * @param checkStatus Status probe, injectable for tests.
 * @param outDir Root of the disposable E2E workspace.
 * @param assetPaths Exact disposable asset paths permitted by the scenario.
 * @returns Tool definition wrapped with document isolation and trace recording.
 */
function scoped(
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
async function serveRestricted() {
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
        { runner, bundle },
    );
    await server.connect(new StdioServerTransport());
}

/** Runs Claude with bounded output accounting and waits for process-group exit on timeout.
 * @param configPath Dedicated MCP config path.
 * @param tracePath Value-free MCP trace path.
 * @param documentPath Exact disposable FLA URI.
 * @param options Spawn environment and timeout overrides.
 * @param options.env Child environment.
 * @param options.timeoutMs Timeout in milliseconds.
 * @param options.scenario Selected scenario configuration.
 * @param options.outDir Disposable E2E workspace.
 * @param options.assetPaths Exact paths pinned by the assets scenario.
 * @returns Resolves after successful CLI exit, with parsed result text for read-only, publish, or Canvas scenarios.
 */
function runClaude(
    configPath,
    tracePath,
    documentPath,
    { env = process.env, timeoutMs = 300_000, scenario = selectedScenario(), outDir, assetPaths } = {},
) {
    return new Promise((resolve, reject) => {
        const child = spawn("claude", claudeArgs(configPath, scenario.prompt), {
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
            env: {
                ...env,
                README_E2E_TRACE_PATH: tracePath,
                README_E2E_DOCUMENT_URI: documentPath,
                ...(outDir ? { README_E2E_OUT_DIR: outDir } : {}),
                ...(assetPaths ? { README_E2E_ASSET_PATHS: JSON.stringify(assetPaths) } : {}),
            },
        });
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdout = "";
        child.stdout.on("data", (chunk) => {
            stdoutBytes = Math.min(stdoutBytes + chunk.length, 1_000_000);
            if (
                [
                    scenarios.inspect,
                    scenarios.library,
                    scenarios.investigate,
                    scenarios.capture,
                    scenarios.publish,
                    scenarios.testmovie,
                    scenarios.canvas,
                ].includes(scenario) &&
                stdout.length < 1_000_000
            ) {
                stdout += chunk.toString().slice(0, 1_000_000 - stdout.length);
            }
        });
        child.stderr.on("data", (chunk) => (stderrBytes = Math.min(stderrBytes + chunk.length, 1_000_000)));

        let timedOut = false;
        let close;
        const closed = new Promise((done) => {
            close = done;
        });
        const timer = setTimeout(async () => {
            timedOut = true;
            try {
                if (process.platform !== "win32") {
                    process.kill(-child.pid, "SIGKILL");
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                // Still wait for close: deleting the FLA before process termination is unsafe.
            }
            await closed;
            reject(new Error(`Claude CLI timed out; CLI exited (stdout=${stdoutBytes}B, stderr=${stderrBytes}B)`));
        }, timeoutMs);
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(new Error(`Claude CLI could not start (${error.code ?? "spawn error"})`));
        });
        child.once("close", (code, signal) => {
            close();
            clearTimeout(timer);
            if (timedOut) {
                return;
            }
            if (code === 0) {
                if (
                    [
                        scenarios.inspect,
                        scenarios.library,
                        scenarios.investigate,
                        scenarios.capture,
                        scenarios.publish,
                        scenarios.testmovie,
                        scenarios.canvas,
                    ].includes(scenario)
                ) {
                    try {
                        const result = JSON.parse(stdout).result;
                        if (typeof result !== "string") {
                            throw new Error("missing result");
                        }
                        resolve(result);
                    } catch {
                        reject(new Error("Claude CLI returned no readable final result"));
                    }
                } else {
                    resolve();
                }
            } else {
                reject(
                    new Error(
                        `Claude CLI failed (exit=${code ?? "unknown"}, signal=${signal ?? "none"}, stdout=${stdoutBytes}B, stderr=${stderrBytes}B; ${claudeFailureDetails(stdout)})`,
                    ),
                );
            }
        });
    });
}

/** Extracts only bounded enum-like failure fields from Claude's JSON output.
 * @param stdout Captured CLI output, which may contain user or workspace content.
 * @returns Value-free failure metadata.
 */
function claudeFailureDetails(stdout) {
    let output;
    try {
        output = JSON.parse(stdout);
    } catch {
        return "stdout_json=invalid";
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) {
        return "stdout_json=non_object";
    }
    const details = [];
    /** Adds a value only when it is a bounded enum-like token.
     * @param key Safe field name.
     * @param value Untrusted JSON value.
     */
    const addToken = (key, value) => {
        if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) {
            details.push(`${key}=${value}`);
        }
    };
    addToken("type", output.type);
    addToken("subtype", output.subtype);
    addToken("stop_reason", output.stop_reason);
    addToken("error_category", output.error_category);
    addToken("error_type", output.error?.type);
    addToken("error_code", output.error?.code);
    if (typeof output.is_error === "boolean") {
        details.push(`is_error=${output.is_error}`);
    }
    if (Number.isSafeInteger(output.num_turns) && output.num_turns >= 0) {
        details.push(`num_turns=${output.num_turns}`);
    }
    if (Array.isArray(output.permission_denials)) {
        details.push(`permission_denials=${output.permission_denials.length}`);
    }
    const result = typeof output.result === "string" ? output.result.slice(0, 4096) : "";
    let resultCategory = "other";
    if (
        /rate[ _-]?limit|too many requests|throttl|(?:usage|token|request|quota)[ _-]?(?:limit|exceeded)|overloaded|capacity|429\b/i.test(
            result,
        )
    ) {
        resultCategory = "usage_rate_limit";
    } else if (
        /unauthori[sz]ed|authentication|auth(?:entication)?[_ -]?(?:error|failed|required)|invalid (?:api )?key|api key.{0,20}(?:invalid|missing)|not logged in|login required|401\b/i.test(
            result,
        )
    ) {
        resultCategory = "auth";
    } else if (/billing|payment|insufficient credits?|out of credits?|subscription|402\b/i.test(result)) {
        resultCategory = "billing";
    } else if (
        /model.{0,80}(?:not found|unavailable|unknown|does not exist)|(?:unknown|unavailable|not found).{0,80}model|model_not_found/i.test(
            result,
        )
    ) {
        resultCategory = "model_unavailable";
    } else if (
        /(?:mcp|tool).{0,50}(?:error|failed|denied|unavailable|disconnect)|(?:error|failed|denied|unavailable).{0,50}(?:mcp|tool)|permission.{0,50}(?:tool|mcp)/i.test(
            result,
        )
    ) {
        resultCategory = "tool_error";
    }
    details.push(`result_category=${resultCategory}`);
    return details.length ? details.join(", ") : "stdout_json=no_safe_metadata";
}

/** Returns the minimal Claude flags, including preapproval for the only exposed entrances.
 * @param configPath Dedicated MCP config path.
 * @param selectedPrompt Prompt to send to Claude.
 * @returns CLI argument list.
 */
function claudeArgs(configPath, selectedPrompt = prompt) {
    const scenario = Object.values(scenarios).find((item) => item.prompt === selectedPrompt);
    return [
        "-p",
        selectedPrompt,
        "--restricted",
        "--strict-mcp-config",
        "--mcp-config",
        configPath,
        "--tools",
        "",
        "--disable-slash-commands",
        "--settings",
        JSON.stringify({ disableAllHooks: true }),
        "--permission-prompts",
        "none",
        "--allowedTools",
        "mcp__animate-readme-e2e__search_tools",
        "mcp__animate-readme-e2e__execute_readonly",
        "mcp__animate-readme-e2e__execute_write",
        "--no-session-persistence",
        "--max-turns",
        scenario === scenarios.script ? "12" : "6",
        "--output-format",
        "json",
    ];
}

/** Asserts that the requested layer's span reaches frame 24.
 * @param layers Inspected timeline layers.
 */
function assertBackground24(layers) {
    const layer = layers.find(({ name }) => name === "背景");
    assert.ok(layer, "Claude did not create the 背景 layer");
    assert.ok(layer.frameCount >= 24, `背景 layer is only ${layer.frameCount} frames long`);
    assert.ok(
        layer.spans.some(({ end }) => end >= 24),
        "背景 layer has no span reaching frame 24",
    );
}

/** Requires a successful timeline edit in the restricted MCP trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_timeline" && succeeded),
        "Claude did not successfully call edit_timeline",
    );
}

/** Asserts stage metadata returned by get_document_info.
 * @param info Document metadata.
 */
function assertStageProperties(info) {
    assert.equal(info.width, 1280, "Stage width is not 1280");
    assert.equal(info.height, 720, "Stage height is not 720");
    assert.equal(info.frameRate, 30, "Stage frame rate is not 30");
    assert.equal(info.backgroundColor?.toUpperCase(), "#000000", "Stage background is not black");
}

/** Requires a successful set_document_properties call in the restricted MCP trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulStageEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "set_document_properties" && succeeded),
        "Claude did not successfully call set_document_properties",
    );
}

/** Requires export, a write to its existing script, and a successful apply in order.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulScriptEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const relevant = entries.filter(({ targetTool }) =>
        ["export_scripts", "write_export_script", "apply_scripts"].includes(targetTool),
    );
    assert.deepEqual(
        relevant.map(({ targetTool, succeeded }) => [targetTool, succeeded]),
        [
            ["export_scripts", true],
            ["write_export_script", true],
            ["apply_scripts", true],
        ],
        "Expected successful export → write_export_script → apply_scripts sequence",
    );
}

/** Requires at least one applied edit_text operation in the MCP trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulTextEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_text" && succeeded),
        "Claude did not successfully call edit_text",
    );
}

/** Requires an applied edit_tween call with no failed operation in its scoped trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulTweenEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_tween" && succeeded),
        "Claude did not successfully apply edit_tween",
    );
}

/** Requires an applied edit_elements call in the value-free tool trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulInstanceEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_elements" && succeeded),
        "Claude did not successfully call edit_elements",
    );
}

/** Requires the requested movie-clip name and type in the value-free conversion trace.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulSymbolConversion(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "convert_to_symbol" && succeeded),
        "Claude did not successfully convert the element to ball_mc",
    );
}

/** Requires inspect_timeline success and rejects every other traced tool.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulTimelineInspection(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No timeline inspection tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "inspect_timeline"),
        "A non-read-only tool was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "inspect_timeline" && succeeded),
        "Claude did not successfully inspect the timeline",
    );
}

/** Requires the final response to identify hero and mention a tween.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertTimelineInspectionReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.match(result, /hero/, "Claude final result did not identify the instance");
    assert.match(result, /トゥイーン|tween|モーション/i, "Claude final result did not mention a tween");
}

/** Requires the final response to list only the unused fixture item.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertLibraryReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.match(result, /(?<![A-Za-z0-9_])unused_mc(?![A-Za-z0-9_])/, "Claude final result omitted the unused item");
    assert.doesNotMatch(
        result,
        /(?<![A-Za-z0-9_])used_mc(?![A-Za-z0-9_])/,
        "Claude final result included the used item",
    );
}

/** Requires a successful script export and read, with no tools outside the read-only workflow.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulScriptInvestigation(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No script investigation tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => ["get_status", "export_scripts", "read_export_file"].includes(targetTool)),
        "A tool outside the read-only script workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "export_scripts" && succeeded),
        "Claude did not successfully export scripts",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "read_export_file" && succeeded),
        "Claude did not successfully read the exported frame script",
    );
}

/** Requires a verified compile-error result and rejects tools outside get_status/publish.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulPublish(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No publish tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "publish"),
        "A tool outside the publish workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "publish" && succeeded),
        "Claude did not successfully receive verified compiler errors from publish",
    );
}

/** Requires a successful test_movie result and rejects tools outside its workflow.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulTestMovie(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No test_movie tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "test_movie"),
        "A tool outside the test_movie workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "test_movie" && succeeded),
        "Claude did not successfully receive the Test Movie result",
    );
}

/** Requires a successful Canvas browser result with the fixture console error and no other tools.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulCanvas(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No Canvas verification tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "verify_canvas_output"),
        "A tool outside the Canvas verification workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "verify_canvas_output" && succeeded),
        "Claude did not successfully receive the fixture console error from verify_canvas_output",
    );
}

/** Requires a meaningful diagnosis tied to the deliberately malformed fixture.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertScriptInvestigationReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(/readmeTotal/.test(result), "Claude final result did not identify the fixture script");
    assert.ok(
        /閉じ.*括弧|missing.*closing parenthes|missing.*\)|expected.*\)|unclosed parenthes/i.test(result),
        "Claude final result did not identify the missing closing parenthesis",
    );
}

/** Requires a syntax diagnosis and a token from Animate's verified compiler diagnostic.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertPublishReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(
        /readmeTotal|\)|括弧|parenthes|rightparen|syntax|構文|文法/i.test(result),
        "Claude final result did not identify the syntax problem",
    );
    assert.ok(
        /1084|rightparen|semicolon|シンタックスエラー|行\s*1|line\s*1/i.test(result),
        "Claude final result omitted the compiler diagnostic",
    );
}

/** Requires the final response to report the startup marker and no compile errors.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertTestMovieReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(result.includes(TEST_MOVIE_MARKER), "Claude final result omitted the startup output marker");
    assert.ok(
        /(?:コンパイル)?エラー(?:(?:は|が)?ありません|(?:は|が)?なし)|(?:no|zero)\s+(?:compil(?:e|ation)\s+)?errors?/i.test(
            result,
        ),
        "Claude final result did not report that there are no compile errors",
    );
}

/** Requires the final response to report console errors and identify the fixture marker.
 * @param result Claude's parsed final result, held in memory only.
 */
function assertCanvasReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(result.includes(CANVAS_ERROR_MARKER), "Claude final result omitted the fixture console-error marker");
    assert.ok(
        /コンソール.{0,20}エラー.{0,20}(?:あり(?!ません)|存在|検出|見つか|発生|出てい)/i.test(result) ||
            /\b(?:console|browser)\b.{0,30}\berrors?\b.{0,30}\b(?:are|were|exist|present|found|detected|reported|occurred|logged)\b/i.test(
                result,
            ) ||
            /\bthere (?:is|are)\s+(?!no\b).{0,30}\b(?:console|browser)\b.{0,20}\berrors?\b/i.test(result),
        "Claude final result did not report that console errors exist",
    );
}

/** Requires a successful listUnused operation and no other library/write operation.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulLibraryListing(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No library tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "edit_library"),
        "A non-library tool was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "edit_library" && succeeded),
        "Claude did not successfully list library items",
    );
}

/** Requires a successful frame-12 capture and rejects tools outside the allowed workflow.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulCapture(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No capture tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "capture_frame"),
        "A tool outside the capture workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "capture_frame" && succeeded),
        "Claude did not successfully capture frame 12",
    );
}

/** Rejects every import request except the exact disposable PNG/MP3 pair.
 * @param paths Paths supplied to import_assets.
 * @param pinnedPaths Exact fixture paths created by this E2E run.
 * @returns The pinned paths in canonical order.
 */
function assertPinnedAssetPaths(paths, pinnedPaths) {
    if (
        !Array.isArray(paths) ||
        !Array.isArray(pinnedPaths) ||
        paths.length !== 2 ||
        pinnedPaths.length !== 2 ||
        paths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
        pinnedPaths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
        new Set(paths).size !== paths.length ||
        new Set(pinnedPaths).size !== pinnedPaths.length ||
        paths.some((path) => !pinnedPaths.includes(path))
    ) {
        throw new Error("Safety check failed: import_assets must use exactly the pinned PNG and MP3 fixture paths.");
    }
    return [...pinnedPaths];
}

/** Requires one successful import_assets call and no other document tools.
 * @param trace JSONL tool trace.
 */
function assertSuccessfulAssetsImport(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const imports = entries.filter(({ targetTool }) => targetTool === "import_assets");
    assert.ok(entries.length > 0, "No assets tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => targetTool === "get_status" || targetTool === "import_assets"),
        "A tool outside the assets import workflow was traced",
    );
    assert.equal(imports.length, 1, "Expected exactly one import_assets call");
    assert.equal(imports[0].succeeded, true, "Claude did not successfully call import_assets");
}

/** Refuses fixture-name collisions before Claude can trigger Animate's import modal.
 * @param report Trusted JSFL state before importing.
 */
function assertAssetsFixtureAvailable(report) {
    const { libraryNames } = parseAssetsDocumentState(report);
    assert.ok(
        ASSET_LIBRARY_NAMES.every((name) => !libraryNames.includes(name)),
        "Disposable FLA already contains a fixture Library item name",
    );
}

/** Requires exactly the two imported fixture names and an unchanged stage.
 * @param before Trusted JSFL state before importing.
 * @param after Trusted JSFL state after importing or reopening.
 */
function assertAssetsImported(before, after) {
    const initial = parseAssetsDocumentState(before);
    const current = parseAssetsDocumentState(after);
    assertAssetsFixtureAvailable(before);
    assert.deepEqual(
        current.libraryNames,
        [...initial.libraryNames, ...ASSET_LIBRARY_NAMES].sort(),
        "Imported Library items do not match the two fixtures",
    );
    assert.equal(current.stage, initial.stage, "Import changed the stage");
}

/** Parses a trusted JSFL snapshot of Library names and stage state.
 * @param report JSFL report.
 * @returns Parsed Library names and stage snapshot.
 */
function parseAssetsDocumentState(report) {
    assert.equal(typeof report, "string", "Trusted assets verification returned no report");
    const [metadata, libraryAndStage] = report.split("\n--LIBRARY--\n");
    const [libraryText, stage] = (libraryAndStage ?? "").split("\n--STAGE--\n");
    assert.ok(metadata !== undefined && libraryText !== undefined && stage !== undefined);
    return {
        libraryNames: libraryText ? libraryText.split("\n") : [],
        stage: `${metadata}\n${stage}`,
    };
}

/** Requires the independent fixture readback to contain exactly the expected unused item.
 * @param report Trusted JSFL library/timeline snapshot.
 */
function assertLibraryFixture(report) {
    assert.equal(typeof report, "string", "Trusted library verification returned no report");
    const [itemCount, instanceCount, names, unused] = report.split("\n");
    assert.ok(names !== undefined && unused !== undefined, "Trusted library verification returned an invalid report");
    assert.deepEqual(names.split("\t"), ["unused_mc", "used_mc"]);
    assert.deepEqual(unused.split("\t"), ["unused_mc"]);
    assert.equal(Number(itemCount), 2);
    assert.equal(Number(instanceCount), 1);
}

/** Requires identical library names/count and timeline instance count before and after listing.
 * @param before Trusted pre-listing JSFL snapshot.
 * @param after Trusted post-listing JSFL snapshot.
 */
function assertLibraryDocumentUnchanged(before, after) {
    /** Parses a value-free library snapshot.
     * @param report Trusted JSFL snapshot.
     * @returns Parsed library names and counts.
     */
    const parse = (report) => {
        assert.equal(typeof report, "string", "Trusted library verification returned no report");
        const [itemCount, instanceCount, names] = report.split("\n");
        assert.ok(names !== undefined && [itemCount, instanceCount].every((value) => Number.isFinite(Number(value))));
        return { itemCount: Number(itemCount), instanceCount: Number(instanceCount), names: names.split("\t") };
    };
    assert.deepEqual(parse(after), parse(before), "Read-only library listing changed the disposable document");
}

/** Validates captured PNG bytes, metadata, and pixels against the frame-12 fixture.
 * @param result Capture result retained by the restricted MCP tool.
 * @param outDir Disposable E2E workspace.
 * @param timelineName Trusted name of the scene timeline, including locale-specific text.
 */
async function assertCaptureEvidence(result, outDir, timelineName) {
    assert.ok(result?.data && Array.isArray(result.content), "Capture returned no tool evidence");
    const metadata = result.data;
    assert.equal(metadata.frame, 12);
    assert.equal(metadata.timeline, timelineName);
    assert.equal(metadata.width, 550);
    assert.equal(metadata.height, 400);
    const captureDir = resolve(join(outDir, "captures"));
    assert.equal(dirname(resolve(metadata.path)), captureDir, "Capture escaped the disposable capture directory");
    const image = result.content.find((item) => item.type === "image");
    const text = result.content.find((item) => item.type === "text");
    assert.ok(image?.data && image.mimeType === "image/png", "Capture has no PNG image content");
    assert.deepEqual(JSON.parse(text?.text ?? "null"), metadata, "Image metadata does not match tool data");
    const fileBytes = await readFile(metadata.path);
    const returnedBytes = Buffer.from(image.data, "base64");
    assert.deepEqual(returnedBytes, fileBytes, "Returned PNG differs from the saved capture file");
    const png = PNG.sync.read(fileBytes);
    assert.equal(png.width, 550);
    assert.equal(png.height, 400);
    /** Reads one decoded RGBA pixel.
     * @param x Horizontal coordinate.
     * @param y Vertical coordinate.
     * @returns RGBA channel values.
     */
    const pixel = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
    const background = pixel(400, 300);
    for (const [x, y, shape] of [
        [60, 60, "rectangle"],
        [240, 90, "oval"],
    ]) {
        const sample = pixel(x, y);
        assert.notDeepEqual(sample, background, `Frame 12 PNG does not show the fixture ${shape}`);
        assert.ok(sample[0] < 80 && sample[1] < 80 && sample[2] < 80, `Fixture ${shape} is not visibly black`);
    }
    assert.equal(pixel(195, 45)[3], 0, "Frame 12 PNG did not retain the oval's transparent corner");
}

/** Requires a visual description matching the distinct fixture geometry and color.
 * @param result Claude final response.
 */
function assertCaptureReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    const concepts = {
        squareOrRectangle: /四角|正方形|長方形|rectangle|square/i.test(result),
        circleOrOval: /円|円形|楕円|circle|oval|ellipse/i.test(result),
        black: /黒|black/i.test(result),
    };
    assert.ok(
        Object.values(concepts).every(Boolean),
        `Claude visual description missed fixture concepts: ${JSON.stringify({ ...concepts, replyLength: result.length })}`,
    );
}

/** Checks the fixture's frame-12 geometry from trusted JSFL output.
 * @param report Trusted JSFL fixture report.
 * @returns Locale-specific scene timeline name.
 */
function assertCaptureFixture(report) {
    assert.equal(typeof report, "string", "Trusted capture fixture verification returned no report");
    const [timelineName, ...fixture] = report.split("\t");
    assert.ok(timelineName, "Capture fixture has no scene timeline name");
    assert.deepEqual(fixture, ["12", "550", "400", "1", "shape", "165", "90", "250", "100"]);
    return timelineName;
}

/** Requires the capture operation to leave the saved fixture unchanged.
 * @param before Trusted pre-capture fixture report.
 * @param after Trusted post-capture fixture report.
 */
function assertCaptureDocumentUnchanged(before, after) {
    assertCaptureFixture(before);
    assert.equal(after, before, "Capture changed the saved frame-12 fixture");
}

/** Requires the trusted JSFL frame report to contain the exact requested text and style.
 * @param report Delimited report returned by the read-only JSFL check.
 */
function assertGameOverText(report) {
    assert.equal(typeof report, "string", "Trusted text verification returned no report");
    assert.deepEqual(
        report.split("\t"),
        ["テキスト", "29", "GAME OVER", "48", "true"],
        "Frame 30 on テキスト does not contain the requested text and style",
    );
}

/** Requires the trusted tween readback and Motion_X XML to match backOut.
 * @param report Delimited tween metadata followed by the raw motion XML.
 * @param initialX Recorded starting X position from the fixture.
 */
function assertTweenReadback(report, initialX) {
    assert.equal(typeof report, "string", "Trusted tween verification returned no report");
    const [metadata, xml] = report.split("\n--MOTION_XML--\n");
    assert.ok(xml, "Trusted tween verification returned no motion XML");
    const [layer, startFrame, duration, tweenType, startName, endName, startX, endX, overshoot, frameRate] =
        metadata.split("\t");
    assert.equal(layer, "BallLayer");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 24);
    assert.equal(tweenType, "motion object");
    assert.equal(startName, "ボール");
    assert.equal(endName, "ボール");
    assert.ok(Math.abs(Number(startX) - initialX) <= 0.01, "Ball did not retain its fixture start position");
    const targetX = initialX + 200;
    assert.ok(Math.abs(Number(endX) - targetX) <= 1, "Ball did not move right by 200px by frame 24");

    const property = xml.match(/<Property\b[^>]*\bid="Motion_X"[^>]*>([\s\S]*?)<\/Property>/);
    assert.ok(property, "Motion XML has no Motion_X channel");
    const keyframes = [...property[1].matchAll(/<Keyframe\b([^>]*)\/>/g)].map(([, attrs]) => attrs);
    assert.ok(keyframes.length >= 2, "Motion_X channel needs start and end keyframes");
    /** Reads one XML attribute from a keyframe.
     * @param attrs XML keyframe attributes.
     * @param name Attribute name.
     * @returns Attribute text.
     */
    const attribute = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
    /** Parses an XML keyframe coordinate pair.
     * @param attrs XML keyframe attributes.
     * @param name Coordinate-pair attribute.
     * @returns Numeric pair, when present.
     */
    const pair = (attrs, name) => attribute(attrs, name)?.split(",").map(Number);
    const next = pair(keyframes[0], "next");
    const previous = pair(keyframes.at(-1), "previous");
    const timeScale = Number(xml.match(/\bTimeScale="([0-9]+)"/)?.[1]);
    const unitsPerFrame = timeScale / Number(frameRate);
    assert.ok(next?.length === 2 && previous?.length === 2 && Number.isFinite(unitsPerFrame));
    const startHasBackOut =
        Math.abs(next[0] - 23 * unitsPerFrame * 0.175) <= 2 && Math.abs(next[1] - 200 * 0.885) <= 0.05;
    const endHasBackOut =
        Math.abs(previous[0] + 23 * unitsPerFrame * 0.68) <= 2 && Math.abs(previous[1] - 200 * 1.275) <= 0.05;
    assert.ok(
        Number(overshoot) > targetX,
        `BackOut tween did not overshoot during frames 15–23 (maxX=${overshoot}, endX=${endX}, Motion_X backOut handles: start=${startHasBackOut}, end=${endHasBackOut}; Claude input args are not recorded)`,
    );
    assert.ok(startHasBackOut && endHasBackOut, "Motion_X Bezier handles do not match the backOut preset");
}

/** Requires the ball instance to retain alpha 50 and the configured blur filter.
 * @param report Delimited instance state from trusted JSFL.
 */
function assertBallInstance(report) {
    assert.equal(typeof report, "string", "Trusted instance verification returned no report");
    const [
        layer,
        startFrame,
        duration,
        name,
        type,
        colorMode,
        alphaPercent,
        filterCount,
        filterName,
        filterEnabled,
        blurX,
        blurY,
        quality,
    ] = report.split("\t");
    assert.equal(layer, "BallLayer");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 1);
    assert.equal(name, "ボール");
    assert.equal(type, "instance");
    assert.equal(colorMode, "alpha");
    assert.ok(Math.abs(Number(alphaPercent) - 50) <= 0.1, "ボール alpha is not 50%");
    assert.equal(Number(filterCount), 1);
    assert.equal(filterName, "blurFilter");
    assert.equal(filterEnabled, "true");
    assert.equal(Number(blurX), 4);
    assert.equal(Number(blurY), 4);
    assert.equal(quality, "low");
}

/** Requires the loose ball shape to be a movie-clip instance linked to ball_mc.
 * @param report Delimited symbol state from trusted JSFL.
 */
function assertBallSymbol(report) {
    assert.equal(typeof report, "string", "Trusted symbol verification returned no report");
    const [
        libraryName,
        libraryType,
        layer,
        startFrame,
        duration,
        elementCount,
        elementType,
        instanceLibraryName,
        symbolType,
        looseShapeCount,
    ] = report.split("\t");
    assert.equal(libraryName, "ball_mc");
    assert.equal(libraryType, "movie clip");
    assert.equal(layer, "ボール");
    assert.equal(Number(startFrame), 0);
    assert.equal(Number(duration), 1);
    assert.equal(Number(elementCount), 1);
    assert.equal(elementType, "instance");
    assert.equal(instanceLibraryName, "ball_mc");
    assert.equal(symbolType, "movie clip");
    assert.equal(Number(looseShapeCount), 0);
}

/** Requires identical timeline state before and after the read-only inspection.
 * @param before Trusted pre-inspection JSFL report.
 * @param after Trusted post-inspection JSFL report.
 */
function assertInspectDocumentUnchanged(before, after) {
    /** Parses the trusted tab-delimited timeline snapshot.
     * @param report JSFL report.
     * @returns Parsed timeline state.
     */
    const parse = (report) => {
        assert.equal(typeof report, "string", "Trusted inspect verification returned no report");
        const fields = report.split("\t");
        assert.equal(fields.length, 7, "Trusted inspect verification returned an invalid report");
        const [layerCount, frameCount, layer, startFrame, duration, instanceName, xAtFrame12] = fields;
        assert.ok(
            [layerCount, frameCount, startFrame, duration, xAtFrame12].every((value) => Number.isFinite(Number(value))),
        );
        return { layerCount, frameCount, layer, startFrame, duration, instanceName, xAtFrame12 };
    };
    const state = parse(before);
    assert.equal(state.layer, "キャラ");
    assert.equal(Number(state.frameCount), 24);
    assert.equal(Number(state.startFrame), 0);
    assert.equal(Number(state.duration), 24);
    assert.equal(state.instanceName, "hero");
    assert.deepEqual(parse(after), state, "Read-only inspection changed the disposable document");
}

/** Requires Test Movie to leave the saved frame-one fixture script unchanged.
 * @param before Trusted pre-Test-Movie frame-one source.
 * @param after Trusted post-Test-Movie frame-one source.
 */
function assertTestMovieScriptUnchanged(before, after) {
    assert.equal(typeof before, "string", "Trusted Test Movie verification returned no source");
    assert.match(before, /trace\s*\(\s*['"]README_TEST_MOVIE_OK['"]\s*\)\s*;?/);
    assert.equal(after, before, "Test Movie changed the frame-one script");
}

/** Requires the saved Canvas frame-one console-error fixture to remain unchanged.
 * @param before Trusted original frame-one source.
 * @param after Trusted frame-one source after verification or reopening.
 */
function assertCanvasFrameScriptUnchanged(before, after) {
    assert.equal(before, CANVAS_FRAME_SCRIPT, "Canvas fixture script does not contain the expected marker");
    assert.equal(after, before, "Canvas verification changed the frame-one script");
}

/** Reads back frame one from the sole exact disposable document using read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function assertScriptInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (
        result.isError ||
        typeof source !== "string" ||
        !source.includes('trace("readme initial");') ||
        !/\bstop\s*\(\s*\)\s*;?/.test(source)
    ) {
        throw new Error("Trusted frame-one script verification failed");
    }
}

/** Reads the exact frame-one source without exposing it in logs or traces.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Frame-one ActionScript source.
 */
async function readInvestigationScript(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; if (fl.documents.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (result.isError || typeof source !== "string") {
        throw new Error("Trusted frame-one script verification failed");
    }
    return source;
}

/** Reads frame-one source from the sole exact saved HTML5 Canvas document.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Frame-one ActionScript source.
 */
async function readCanvasFrameOneScript(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable Canvas FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (result.isError || typeof source !== "string") {
        throw new Error("Trusted Canvas frame-one script verification failed");
    }
    return source;
}

/** Closes Test Movie Player windows only while the disposable FLA is the sole open document.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function closeTestMoviePlayer(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: "(function () { fl.closeAllPlayerDocuments(); return true; })()",
    });
    if (result.isError || result.structuredContent?.result !== true) {
        throw new Error("Trusted Test Movie Player cleanup failed");
    }
    const after = (await status({})).structuredContent?.documents ?? [];
    if (after.length !== 1 || after[0].path !== pathURI) {
        throw new Error("Test Movie Player cleanup changed the open document scope.");
    }
}

/** Sets a deliberately malformed but syntactically valid JSFL string as frame-one ActionScript.
 * @param runJsfl run_jsfl tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function createInvestigationScriptFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var doc = null; if (fl.documents.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); var frame = doc.getTimeline().layers[0].frames[0]; frame.actionScript = ${JSON.stringify(investigationScript)}; return String(frame.actionScript); })()`,
    });
    if (result.isError || result.structuredContent?.result !== investigationScript) {
        throw new Error("Could not create the malformed AS3 script fixture");
    }
}

/** Verifies scene-one frame 30 on the exact disposable document via read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function assertTextInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layers = timeline.layers, layer = null, layerIndex = -1; for (i = 0; i < layers.length; i++) if (layers[i].name === "テキスト") { if (layer) throw new Error("Multiple テキスト layers found"); layer = layers[i]; layerIndex = i; } if (!layer) throw new Error("テキスト layer not found"); var frame = layer.frames[29]; if (!frame || frame.startFrame !== 29) throw new Error("Frame 30 keyframe not found"); var matches = [], elements = frame.elements || []; for (i = 0; i < elements.length; i++) if (elements[i].elementType === "text" && elements[i].getTextString() === "GAME OVER") matches.push(elements[i]); if (matches.length !== 1) throw new Error("Expected one GAME OVER text field"); var runs = matches[0].textRuns || [], attrs = runs.length ? runs[0].textAttrs || {} : {}; return [layer.name, String(frame.startFrame), matches[0].getTextString(), String(attrs.size), String(attrs.bold)].join("\\t"); })()`,
    });
    if (result.isError) {
        throw new Error("Trusted text verification failed");
    }
    assertGameOverText(result.structuredContent?.result);
}

/** Adds exactly one one-frame text layer to the exact disposable document.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function createTextScenarioLayer(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layers = timeline.layers; for (i = 0; i < layers.length; i++) if (layers[i].name === "テキスト") throw new Error("テキスト layer already exists"); var index = timeline.addNewLayer("テキスト", "normal", true), layer = timeline.layers[index]; if (!layer || layer.name !== "テキスト" || layer.frames.length !== 1) throw new Error("Text fixture layer must have one frame"); return layer.name + "\\t" + layer.frames.length; })()`,
    });
    if (result.isError || result.structuredContent?.result !== "テキスト\t1") {
        throw new Error("Could not create one-frame text fixture layer");
    }
}

/** Creates an AS3 ball instance held across a pre-extended 24-frame scene.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns The instance's measured initial X position.
 */
async function createTweenScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.library.addNewItem("movie clip", "ball_src"); doc.library.editItem("ball_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "BallLayer"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "ball_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") throw new Error("Could not place ball instance"); instance.name = "ボール"; var initialX = Number(instance.x); timeline.insertFrames(23, true, 0); var layer = timeline.layers[0]; if (timeline.frameCount !== 24 || layer.frames.length !== 24 || layer.frames[0].startFrame !== 0 || layer.frames[0].duration !== 24) throw new Error("Ball fixture did not extend as a held 24-frame span"); for (i = 0; i < 24; i++) { var elements = layer.frames[i].elements || []; if (layer.frames[i].startFrame !== 0 || elements.length !== 1 || elements[0].name !== "ボール") throw new Error("Ball hold span fixture invariant failed"); } return String(initialX); })()`,
    });
    const initialX = Number(result.structuredContent?.result);
    if (result.isError || !Number.isFinite(initialX)) {
        throw new Error("Could not create the 24-frame ball tween fixture");
    }
    return initialX;
}

/** Creates a 24-frame character motion-tween fixture using only endpoint keys.
 * @param runJsfl JSFL tool handler.
 * @param editTween Trusted setup tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @param documentName Disposable document name for the setup tool.
 */
async function createInspectScenarioFixture(runJsfl, editTween, pathURI, documentName) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; doc.library.addNewItem("movie clip", "hero_src"); doc.library.editItem("hero_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) return "FIXTURE_ERROR:timeline"; timeline.layers[0].name = "キャラ"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "hero_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") return "FIXTURE_ERROR:instance"; instance.name = "hero"; var initialX = Number(instance.x); timeline.insertFrames(23, true, 0); if (timeline.frameCount !== 24 || timeline.layers[0].frames.length !== 24) return "FIXTURE_ERROR:extend"; return String(initialX); } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    const initialX = Number(result.structuredContent?.result);
    if (result.isError || !Number.isFinite(initialX)) {
        throw new Error("Could not create the 24-frame character inspect fixture");
    }
    const tween = await editTween({
        document: documentName,
        timeline: 0,
        ops: [
            {
                op: "createTween",
                layer: "キャラ",
                instance: "hero",
                kind: "motion",
                keyframes: [
                    { frame: 1, x: initialX },
                    { frame: 24, dx: 120 },
                ],
            },
        ],
    });
    if (tween.isError || tween.structuredContent?.failed !== null || !tween.structuredContent?.applied?.length) {
        throw new Error("Could not create the character motion tween fixture");
    }
}

/** Reads the requested mid-tween state from the exact disposable FLA.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab-delimited trusted document state.
 */
async function readInspectDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || docs.length !== 1) return "READ_ERROR:document"; var timeline = doc.getTimeline(), layer = null, layerIndex = -1; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "キャラ") { layer = timeline.layers[i]; layerIndex = i; } if (!layer || timeline.frameCount !== 24 || layer.frames.length !== 24) return "READ_ERROR:timeline"; var oldFrame = timeline.currentFrame, oldLayer = timeline.currentLayer, oldSelected = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null; try { timeline.currentLayer = layerIndex; timeline.currentFrame = 11; var span = layer.frames[0], elements = layer.frames[11].elements || []; if (span.startFrame !== 0 || span.duration !== 24 || span.tweenType !== "motion object" || elements.length !== 1) return "READ_ERROR:tween"; return [String(timeline.layers.length), String(timeline.frameCount), layer.name, String(span.startFrame), String(span.duration), elements[0].name || "", String(elements[0].x)].join(String.fromCharCode(9)); } finally { if (oldSelected && timeline.setSelectedFrames) timeline.setSelectedFrames(oldSelected); timeline.currentLayer = oldLayer; timeline.currentFrame = oldFrame; } } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted inspect verification failed");
    }
    return report;
}

/** Reads the exact tween span, interpolated positions, and raw Motion_X XML.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @param initialX Fixture's measured starting X position.
 */
async function assertTweenInDocument(runJsfl, status, pathURI, initialX) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null, layerIndex = -1; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "BallLayer") { layer = timeline.layers[i]; layerIndex = i; } if (!layer || layer.frames.length !== 24) throw new Error("BallLayer must contain 24 frames"); var span = layer.frames[0], startElements = span.elements || []; if (span.startFrame !== 0 || span.duration !== 24 || span.tweenType !== "motion object" || startElements.length !== 1) throw new Error("Expected a motion tween spanning frames 1–24"); var oldFrame = timeline.currentFrame, oldLayer = timeline.currentLayer, oldSelected = timeline.getSelectedFrames ? timeline.getSelectedFrames() : null, xs = [], endName = ""; try { for (var n = 0; n < 24; n++) { timeline.currentLayer = layerIndex; timeline.currentFrame = n; var elements = layer.frames[n].elements || [], ball = null; for (i = 0; i < elements.length; i++) if (elements[i].name === "ボール") ball = elements[i]; if (!ball) throw new Error("ボール instance missing from frame " + (n + 1)); xs.push(Number(ball.x)); if (n === 23) endName = ball.name; } timeline.currentLayer = layerIndex; timeline.setSelectedFrames(0, 1); var xml = String(span.getMotionObjectXML()); var report = [layer.name, String(span.startFrame), String(span.duration), String(span.tweenType), startElements[0].name, endName, String(xs[0]), String(xs[23]), String(Math.max.apply(Math, xs.slice(14, 23))), String(doc.frameRate)].join("\\t") + "\\n--MOTION_XML--\\n" + xml; return report; } finally { if (oldSelected && timeline.setSelectedFrames) timeline.setSelectedFrames(oldSelected); timeline.currentLayer = oldLayer; timeline.currentFrame = oldFrame; } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted tween verification failed");
    }
    assertTweenReadback(result.structuredContent?.result, initialX);
}

/** Creates a single-frame AS3 fixture with the named ball instance on its own layer.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function createInstanceScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.library.addNewItem("movie clip", "ball_src"); doc.library.editItem("ball_src"); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "BallLayer"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.library.addItemToDocument({ x: 50, y: 50 }, "ball_src"); var instance = timeline.layers[0].frames[0].elements[0]; if (!instance || instance.elementType !== "instance") throw new Error("Could not place ball instance"); instance.name = "ボール"; return "READY"; })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the single-frame ball fixture");
    }
}

/** Reads alpha and filter state from the exact disposable FLA using read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function assertInstanceInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "BallLayer") layer = timeline.layers[i]; if (!layer || timeline.frameCount !== 1 || layer.frames.length !== 1) throw new Error("Expected the single-frame BallLayer fixture"); var frame = layer.frames[0], elements = frame.elements || []; if (frame.startFrame !== 0 || frame.duration !== 1 || elements.length !== 1) throw new Error("Expected one ball instance on frame 1"); var instance = elements[0], filters = instance.filters || [], blur = null; for (i = 0; i < filters.length; i++) if (filters[i].name === "blurFilter") blur = filters[i]; return [layer.name, String(frame.startFrame), String(frame.duration), instance.name || "", instance.elementType || "", instance.colorMode || "none", String(instance.colorAlphaPercent), String(filters.length), blur ? blur.name : "", blur ? String(blur.enabled !== false) : "", blur ? String(blur.blurX) : "", blur ? String(blur.blurY) : "", blur ? String(blur.quality) : ""].join(String.fromCharCode(9)); })()`,
    });
    if (result.isError) {
        throw new Error("Trusted instance verification failed");
    }
    assertBallInstance(result.structuredContent?.result);
}

/** Creates a single-frame fixture with one raw oval on layer ボール.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function createSymbolScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) return "FIXTURE_ERROR:timeline"; timeline.layers[0].name = "ボール"; timeline.currentLayer = 0; timeline.currentFrame = 0; doc.addNewOval({ left: 100, top: 100, right: 160, bottom: 160 }, 0); var elements = timeline.layers[0].frames[0].elements || []; if (elements.length !== 1 || elements[0].elementType !== "shape") return "FIXTURE_ERROR:raw-oval"; return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the single-frame raw-oval symbol fixture");
    }
}

/** Creates used_mc and unused_mc movie clips in the exact disposable AS3 document.
 * @param runJsfl JSFL tool handler.
 * @param pathURI Exact disposable FLA URI.
 */
async function createLibraryScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "FIXTURE_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) return "FIXTURE_ERROR:as3-document"; var names = ["used_mc", "unused_mc"]; for (i = 0; i < names.length; i++) { if (doc.library.itemExists(names[i]) || !doc.library.addNewItem("movie clip", names[i])) return "FIXTURE_ERROR:library-item"; doc.library.editItem(names[i]); doc.addNewRectangle({ left: 0, top: 0, right: 20, bottom: 20 }, 0); doc.exitEditMode(); } var timeline = doc.getTimeline(); if (timeline.layers.length !== 1 || !doc.library.addItemToDocument({ x: 50, y: 50 }, "used_mc")) return "FIXTURE_ERROR:stage-instance"; var elements = timeline.layers[0].frames[0].elements || []; if (elements.length !== 1 || elements[0].elementType !== "instance" || elements[0].libraryItem.name !== "used_mc") return "FIXTURE_ERROR:stage-instance"; return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the library listing fixture");
    }
}

/** Creates an AS3 frame-12 fixture with a black rectangle and oval on a white stage.
 * @param runJsfl Trusted JSFL tool handler.
 * @param pathURI Exact disposable FLA URI.
 */
async function createCaptureScenarioFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); doc.width = 550; doc.height = 400; doc.backgroundColor = "#FFFFFF"; var timeline = doc.getTimeline(); if (timeline.frameCount !== 1 || timeline.layers.length !== 1) throw new Error("Expected a one-frame scene with one layer"); timeline.layers[0].name = "図形"; timeline.insertFrames(11, true, 0); timeline.currentLayer = 0; timeline.currentFrame = 11; doc.setFillColor("#000000"); doc.addNewRectangle({ left: 40, top: 40, right: 140, bottom: 140 }, 0); doc.addNewOval({ left: 190, top: 40, right: 290, bottom: 140 }, 0); var elements = timeline.layers[0].frames[11].elements || []; if (timeline.frameCount < 12 || elements.length !== 1 || elements[0].elementType !== "shape") throw new Error("Frame-12 drawing fixture failed"); doc.selectNone(); return "READY"; } catch (error) { return "FIXTURE_ERROR:" + String(error); } })()`,
    });
    if (result.isError || result.structuredContent?.result !== "READY") {
        throw new Error("Could not create the frame-12 capture fixture");
    }
}

/** Reads stage dimensions and exact frame-12 shape geometry using trusted JSFL.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab-delimited fixture report.
 */
async function readCaptureFixture(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var docs = fl.documents, doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) throw new Error("Disposable document not found"); var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "図形") layer = timeline.layers[i]; if (!layer || timeline.frameCount < 12) throw new Error("Frame-12 fixture missing"); var oldFrame = timeline.currentFrame; try { timeline.currentFrame = 11; var elements = layer.frames[11].elements || []; if (elements.length !== 1) throw new Error("Frame-12 drawing missing"); var values = [String(timeline.name), String(timeline.frameCount), String(doc.width), String(doc.height), String(elements.length)]; for (i = 0; i < elements.length; i++) values.push(elements[i].elementType, String(elements[i].x), String(elements[i].y), String(elements[i].width), String(elements[i].height)); return values.join(String.fromCharCode(9)); } finally { timeline.currentFrame = oldFrame; } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted capture fixture verification failed");
    }
    return result.structuredContent?.result;
}

/** Reads Library names and a complete stage snapshot from the disposable FLA.
 * @param runJsfl Trusted JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Delimited Library and stage state.
 */
async function readAssetsDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) throw new Error("Disposable document not found"); var names = [], items = doc.library.items || []; for (i = 0; i < items.length; i++) names.push(String(items[i].name)); names.sort(); var timeline = doc.getTimeline(), stage = [[String(doc.width), String(doc.height), String(doc.frameRate), String(doc.backgroundColor)].join("\\t")]; for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) { var layer = timeline.layers[layerIndex]; for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) { var frame = layer.frames[frameIndex]; if (!frame || frame.startFrame !== frameIndex) continue; var elements = frame.elements || [], row = [String(layerIndex), String(frameIndex), String(layer.name), String(frame.startFrame), String(frame.duration), String(frame.tweenType || ""), String(elements.length)]; for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) { var element = elements[elementIndex], item = element.libraryItem; row.push(String(element.elementType), item ? String(item.name) : "", String(element.x), String(element.y), String(element.width), String(element.height), String(element.rotation), String(element.scaleX), String(element.scaleY)); } stage.push(row.join(String.fromCharCode(9))); } } return [stage.shift(), "--LIBRARY--", names.join(String.fromCharCode(10)), "--STAGE--", stage.join(String.fromCharCode(10))].join(String.fromCharCode(10)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted assets verification failed");
    }
    return report;
}

/** Independently computes unused library items by scanning all scene and symbol timelines.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable FLA URI.
 * @returns Tab/newline-delimited library and timeline snapshot.
 */
async function readLibraryDocumentState(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "READ_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) return "READ_ERROR:document"; var items = doc.library.items, names = [], used = {}, instanceCount = 0; for (i = 0; i < items.length; i++) names.push(items[i].name); names.sort(); function scan(timeline) { for (var layerIndex = 0; layerIndex < timeline.layers.length; layerIndex++) { var layer = timeline.layers[layerIndex]; if (layer.layerType === "folder") continue; for (var frameIndex = 0; frameIndex < layer.frames.length; frameIndex++) { var frame = layer.frames[frameIndex]; if (!frame || frame.startFrame !== frameIndex) continue; var elements = frame.elements || []; for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) { var element = elements[elementIndex]; if (element.elementType === "instance" && element.libraryItem) { used[element.libraryItem.name] = true; instanceCount++; } } } } } for (i = 0; i < doc.timelines.length; i++) scan(doc.timelines[i]); for (i = 0; i < items.length; i++) if (items[i].timeline) scan(items[i].timeline); var unused = []; for (i = 0; i < names.length; i++) if (!used[names[i]]) unused.push(names[i]); return [String(names.length), String(instanceCount), names.join(String.fromCharCode(9)), unused.join(String.fromCharCode(9))].join(String.fromCharCode(10)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    const report = result.structuredContent?.result;
    if (result.isError || typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted library verification failed");
    }
    return report;
}

/** Reads the converted library item and stage instance from the exact disposable FLA.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
async function assertSymbolInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { try { var docs = fl.documents, doc = null; if (docs.length !== 1) return "READ_ERROR:document-scope"; for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc) return "READ_ERROR:document"; var item = null; for (i = 0; i < doc.library.items.length; i++) if (doc.library.items[i].name === "ball_mc") item = doc.library.items[i]; var timeline = doc.getTimeline(), layer = null; for (i = 0; i < timeline.layers.length; i++) if (timeline.layers[i].name === "ボール") layer = timeline.layers[i]; if (!layer || !layer.frames[0]) return "READ_ERROR:layer"; var frame = layer.frames[0], elements = frame.elements || [], instance = elements.length === 1 ? elements[0] : null, looseShapes = 0; for (i = 0; i < timeline.layers.length; i++) { var targetFrame = timeline.layers[i].frames[0], stageElements = targetFrame && targetFrame.elements || []; for (var j = 0; j < stageElements.length; j++) if (stageElements[j].elementType === "shape") looseShapes++; } return [item ? item.name : "", item ? item.itemType : "", layer.name, String(frame.startFrame), String(frame.duration), String(elements.length), instance ? instance.elementType : "", instance && instance.libraryItem ? instance.libraryItem.name : "", instance ? instance.symbolType : "", String(looseShapes)].join(String.fromCharCode(9)); } catch (error) { return "READ_ERROR:" + String(error); } })()`,
    });
    if (result.isError) {
        throw new Error("Trusted symbol verification failed");
    }
    const report = result.structuredContent?.result;
    if (typeof report !== "string" || report.startsWith("READ_ERROR:")) {
        throw new Error("Trusted symbol verification failed");
    }
    assertBallSymbol(report);
}

/** Verifies that Playwright can launch the installed Chrome channel before a paid run.
 * @returns Resolves after closing the temporary headless browser.
 */
async function assertChromeInstalled() {
    const { chromium } = await import("playwright-core");
    let browser;
    try {
        browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
        throw new Error("Google Chrome is required for the Canvas scenario; install Chrome before running it.");
    } finally {
        await browser?.close();
    }
}

/** Runs the manually approved Claude/Animate E2E.
 * @returns Resolves after persistence verification and cleanup.
 */
async function main() {
    const scenario = selectedScenario();
    if (process.argv.includes("--mcp-server")) {
        return serveRestricted();
    }
    if (process.env.RUN_README_PROMPT_E2E !== "1") {
        throw new Error("Set RUN_README_PROMPT_E2E=1 only after approving the paid Claude CLI run.");
    }
    if (!(await isAnimateRunning())) {
        throw new Error("Start Adobe Animate before running this test.");
    }

    const status = toolHandler(registerGetStatus);
    const before = (await status({})).structuredContent;
    if (before?.animate !== "responding" || before.documents?.length !== 0) {
        throw new Error("Safety check failed: Animate must respond with no documents open.");
    }
    if (scenario === scenarios.canvas) {
        await assertChromeInstalled();
    }

    const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-readme-e2e-"));
    const flaPath = join(outDir, `${basename(outDir)}.fla`);
    const tracePath = join(outDir, "trace.jsonl");
    const configPath = join(outDir, "mcp.json");
    const runJsfl = toolHandler(registerRunJsfl);
    const saveDocument = toolHandler(registerSaveDocument);
    const openDocument = toolHandler(registerOpenDocument);
    const inspectTimeline = toolHandler(registerInspectTimeline);
    const getDocumentInfo = toolHandler(registerGetDocumentInfo);
    const editTween = toolHandler(registerEditTween);
    let pathURI = "";
    let assetsFixture;
    let tweenInitialX;
    let inspectBefore;
    let libraryBefore;
    let investigationBefore;
    let testMovieBefore;
    let captureBefore;
    let captureTimeline;
    let assetsBefore;
    let canvasBefore;
    let failure;
    try {
        if (scenario === scenarios.assets) {
            assetsFixture = await createAssetsFixture(outDir);
        }
        await writeFile(
            configPath,
            JSON.stringify({
                mcpServers: {
                    "animate-readme-e2e": { command: process.execPath, args: [scriptPath, "--mcp-server"] },
                },
            }),
        );
        let actionScript = "";
        if (scenario === scenarios.script) {
            actionScript = 'trace("readme initial");';
        } else if (scenario === scenarios.testmovie) {
            actionScript = "trace('README_TEST_MOVIE_OK');";
        }
        if (scenario === scenarios.canvas) {
            const created = await openDocument({ type: "htmlcanvas" });
            if (created.isError || !created.structuredContent?.name) {
                throw new Error("Could not create disposable HTML5 Canvas document");
            }
            const saved = await saveDocument({ document: created.structuredContent.name, path: flaPath });
            if (saved.isError || !saved.structuredContent?.path) {
                throw new Error("Could not save disposable HTML5 Canvas document");
            }
            pathURI = saved.structuredContent.path;
            const documents = (await status({})).structuredContent?.documents ?? [];
            if (documents.length !== 1 || documents[0].path !== pathURI) {
                throw new Error("Safety check failed: the saved Canvas FLA is not the only open document.");
            }
            const fixture = await runJsfl({
                code: `(function () { var docs = fl.documents || [], doc = null; if (docs.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < docs.length; i++) if (docs[i].pathURI === ${JSON.stringify(pathURI)}) doc = docs[i]; if (!doc || doc.type !== "htmlcanvas") throw new Error("Disposable Canvas document not found"); var frame = doc.getTimeline().layers[0].frames[0]; frame.actionScript = ${JSON.stringify(CANVAS_FRAME_SCRIPT)}; return String(frame.actionScript); })()`,
            });
            if (fixture.isError || fixture.structuredContent?.result !== CANVAS_FRAME_SCRIPT) {
                throw new Error("Could not create the Canvas frame-one console-error fixture");
            }
            const savedFixture = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
            if (savedFixture.isError) {
                throw new Error("Could not save the Canvas frame-one console-error fixture");
            }
            canvasBefore = await readCanvasFrameOneScript(runJsfl, status, pathURI);
            assertCanvasFrameScriptUnchanged(CANVAS_FRAME_SCRIPT, canvasBefore);
        } else {
            pathURI = (await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, actionScript)).pathURI;
        }
        if (scenario === scenarios.text) {
            await createTextScenarioLayer(runJsfl, pathURI);
        } else if (scenario === scenarios.tween) {
            tweenInitialX = await createTweenScenarioFixture(runJsfl, pathURI);
        } else if (scenario === scenarios.instance) {
            await createInstanceScenarioFixture(runJsfl, pathURI);
        } else if (scenario === scenarios.symbol) {
            await createSymbolScenarioFixture(runJsfl, pathURI);
        } else if (scenario === scenarios.inspect) {
            const document = (await status({})).structuredContent?.documents?.[0];
            if (!document || document.path !== pathURI) {
                throw new Error("Safety check failed: the inspect fixture document is not open.");
            }
            await createInspectScenarioFixture(runJsfl, editTween, pathURI, document.name);
            inspectBefore = await readInspectDocumentState(runJsfl, status, pathURI);
        } else if (scenario === scenarios.library) {
            await createLibraryScenarioFixture(runJsfl, pathURI);
            libraryBefore = await readLibraryDocumentState(runJsfl, status, pathURI);
            assertLibraryFixture(libraryBefore);
        } else if ([scenarios.investigate, scenarios.publish].includes(scenario)) {
            await createInvestigationScriptFixture(runJsfl, pathURI);
            investigationBefore = await readInvestigationScript(runJsfl, status, pathURI);
            if (investigationBefore !== investigationScript) {
                throw new Error("Malformed AS3 script fixture did not read back exactly");
            }
            if (scenario === scenarios.publish) {
                const savedFixture = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
                if (savedFixture.isError) {
                    throw new Error("Could not save the malformed publish fixture");
                }
            }
        } else if (scenario === scenarios.capture) {
            await createCaptureScenarioFixture(runJsfl, pathURI);
            captureBefore = await readCaptureFixture(runJsfl, status, pathURI);
            captureTimeline = assertCaptureFixture(captureBefore);
        } else if (scenario === scenarios.assets) {
            assetsBefore = await readAssetsDocumentState(runJsfl, status, pathURI);
            assertAssetsFixtureAvailable(assetsBefore);
        } else if (scenario === scenarios.testmovie) {
            testMovieBefore = await readInvestigationScript(runJsfl, status, pathURI);
            assertTestMovieScriptUnchanged(testMovieBefore, testMovieBefore);
        }
        const opened = (await status({})).structuredContent?.documents ?? [];
        if (opened.length !== 1 || opened[0].path !== pathURI) {
            throw new Error("Safety check failed: the only open Animate document is not the disposable FLA.");
        }
        const runScenario = assetsFixture ? { ...scenario, prompt: assetsFixture.prompt } : scenario;
        const claudeResult = await runClaude(configPath, tracePath, pathURI, {
            scenario: runScenario,
            outDir,
            assetPaths: assetsFixture?.paths,
        });
        if (scenario === scenarios.testmovie) {
            await closeTestMoviePlayer(runJsfl, status, pathURI);
        }
        const captureResult =
            scenario === scenarios.capture
                ? JSON.parse(await readFile(join(outDir, "capture-evidence.json"), "utf8"))
                : null;
        if (scenario === scenarios.stage) {
            assertSuccessfulStageEdit(await readFile(tracePath, "utf8"));
        } else if (scenario === scenarios.script) {
            assertSuccessfulScriptEdit(await readFile(tracePath, "utf8"));
            await assertScriptInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.text) {
            assertSuccessfulTextEdit(await readFile(tracePath, "utf8"));
            await assertTextInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.tween) {
            assertSuccessfulTweenEdit(await readFile(tracePath, "utf8"));
            await assertTweenInDocument(runJsfl, status, pathURI, tweenInitialX);
        } else if (scenario === scenarios.instance) {
            assertSuccessfulInstanceEdit(await readFile(tracePath, "utf8"));
            await assertInstanceInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.symbol) {
            assertSuccessfulSymbolConversion(await readFile(tracePath, "utf8"));
            await assertSymbolInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.inspect) {
            assertSuccessfulTimelineInspection(await readFile(tracePath, "utf8"));
            assertTimelineInspectionReply(claudeResult);
            assertInspectDocumentUnchanged(inspectBefore, await readInspectDocumentState(runJsfl, status, pathURI));
        } else if (scenario === scenarios.library) {
            assertSuccessfulLibraryListing(await readFile(tracePath, "utf8"));
            assertLibraryReply(claudeResult);
            assertLibraryDocumentUnchanged(libraryBefore, await readLibraryDocumentState(runJsfl, status, pathURI));
        } else if (scenario === scenarios.investigate) {
            assertSuccessfulScriptInvestigation(await readFile(tracePath, "utf8"));
            assertScriptInvestigationReply(claudeResult);
            if ((await readInvestigationScript(runJsfl, status, pathURI)) !== investigationBefore) {
                throw new Error("Read-only script investigation changed the frame-one script");
            }
        } else if (scenario === scenarios.publish) {
            assertSuccessfulPublish(await readFile(tracePath, "utf8"));
            assertPublishReply(claudeResult);
            if ((await readInvestigationScript(runJsfl, status, pathURI)) !== investigationBefore) {
                throw new Error("Publish changed the malformed frame-one script");
            }
        } else if (scenario === scenarios.testmovie) {
            assertSuccessfulTestMovie(await readFile(tracePath, "utf8"));
            assertTestMovieReply(claudeResult);
            assertTestMovieScriptUnchanged(testMovieBefore, await readInvestigationScript(runJsfl, status, pathURI));
        } else if (scenario === scenarios.canvas) {
            assertSuccessfulCanvas(await readFile(tracePath, "utf8"));
            assertCanvasReply(claudeResult);
            assertCanvasFrameScriptUnchanged(canvasBefore, await readCanvasFrameOneScript(runJsfl, status, pathURI));
        } else if (scenario === scenarios.capture) {
            assertSuccessfulCapture(await readFile(tracePath, "utf8"));
            assertCaptureReply(claudeResult);
            await assertCaptureEvidence(captureResult, outDir, captureTimeline);
            assertCaptureDocumentUnchanged(captureBefore, await readCaptureFixture(runJsfl, status, pathURI));
        } else if (scenario === scenarios.assets) {
            assertSuccessfulAssetsImport(await readFile(tracePath, "utf8"));
        } else {
            assertSuccessfulEdit(await readFile(tracePath, "utf8"));
        }
        /** Inspects the disposable scene and validates the target layer. */
        const inspect = async () => {
            const documents = (await status({})).structuredContent?.documents ?? [];
            if (documents.length !== 1 || documents[0].path !== pathURI) {
                throw new Error("Safety check failed: the disposable FLA is not the only open document.");
            }
            const result = await inspectTimeline({ document: documents[0].name, timeline: 0, frame: 24 });
            if (result.isError) {
                throw new Error("Timeline inspection failed");
            }
            assertBackground24(result.structuredContent?.layers ?? []);
        };
        /** Verifies stage metadata while enforcing the disposable-document scope. */
        const inspectStage = async () => {
            const documents = (await status({})).structuredContent?.documents ?? [];
            if (documents.length !== 1 || documents[0].path !== pathURI) {
                throw new Error("Safety check failed: the disposable FLA is not the only open document.");
            }
            assertStageProperties((await getDocumentInfo({})).structuredContent);
        };
        let verifyScenario = inspect;
        if (scenario === scenarios.stage) {
            verifyScenario = inspectStage;
        } else if (scenario === scenarios.script) {
            verifyScenario = () => assertScriptInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.text) {
            verifyScenario = () => assertTextInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.tween) {
            verifyScenario = () => assertTweenInDocument(runJsfl, status, pathURI, tweenInitialX);
        } else if (scenario === scenarios.instance) {
            verifyScenario = () => assertInstanceInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.symbol) {
            verifyScenario = () => assertSymbolInDocument(runJsfl, status, pathURI);
        } else if (scenario === scenarios.inspect) {
            verifyScenario = async () =>
                assertInspectDocumentUnchanged(inspectBefore, await readInspectDocumentState(runJsfl, status, pathURI));
        } else if (scenario === scenarios.library) {
            verifyScenario = async () =>
                assertLibraryDocumentUnchanged(libraryBefore, await readLibraryDocumentState(runJsfl, status, pathURI));
        } else if ([scenarios.investigate, scenarios.publish].includes(scenario)) {
            verifyScenario = async () => {
                if ((await readInvestigationScript(runJsfl, status, pathURI)) !== investigationBefore) {
                    throw new Error("Frame-one script changed after investigation or publish/reopen");
                }
            };
        } else if (scenario === scenarios.testmovie) {
            verifyScenario = async () =>
                assertTestMovieScriptUnchanged(
                    testMovieBefore,
                    await readInvestigationScript(runJsfl, status, pathURI),
                );
        } else if (scenario === scenarios.canvas) {
            verifyScenario = async () =>
                assertCanvasFrameScriptUnchanged(
                    canvasBefore,
                    await readCanvasFrameOneScript(runJsfl, status, pathURI),
                );
        } else if (scenario === scenarios.capture) {
            verifyScenario = async () =>
                assertCaptureDocumentUnchanged(captureBefore, await readCaptureFixture(runJsfl, status, pathURI));
        } else if (scenario === scenarios.assets) {
            verifyScenario = async () =>
                assertAssetsImported(assetsBefore, await readAssetsDocumentState(runJsfl, status, pathURI));
        }
        await verifyScenario();
        if ([scenarios.inspect, scenarios.library].includes(scenario)) {
            console.log(
                scenario === scenarios.inspect
                    ? "PASS: inspect_timeline reported hero and its tween; timeline state was unchanged (dirty flag check skipped)."
                    : "PASS: edit_library listed the independently verified unused item; library and timeline state were unchanged.",
            );
            return;
        }
        const saved = await saveDocument({ document: pathURI, path: flaPath, confirm: true });
        if (saved.isError) {
            throw new Error("Could not save disposable FLA");
        }
        await closeDocumentByPath(runJsfl, pathURI);
        pathURI = "";
        const reopened = await openDocument({ path: flaPath });
        if (reopened.isError) {
            throw new Error("Could not reopen disposable FLA");
        }
        pathURI = reopened.structuredContent?.path;
        if (!pathURI) {
            throw new Error("Animate returned no path for the reopened disposable FLA");
        }
        await verifyScenario();
        if (scenario === scenarios.stage) {
            console.log("PASS: set_document_properties succeeded; stage properties persisted after save and reopen.");
        } else if (scenario === scenarios.script) {
            console.log(
                "PASS: export_scripts → script edit → apply_scripts succeeded; frame-one script persisted after save and reopen.",
            );
        } else if (scenario === scenarios.investigate) {
            console.log(
                "PASS: exported and read the malformed frame-one AS3 script; its source was unchanged after save and reopen.",
            );
        } else if (scenario === scenarios.publish) {
            console.log(
                "PASS: publish returned verified compiler errors for the malformed AS3 fixture; the frame-one script was unchanged after save and reopen.",
            );
        } else if (scenario === scenarios.capture) {
            await assertCaptureEvidence(captureResult, outDir, captureTimeline);
            console.log(
                "PASS: capture_frame returned the frame-12 fixture PNG; image content matched the saved file and persisted fixture after reopen.",
            );
        } else if (scenario === scenarios.assets) {
            console.log(
                "PASS: import_assets imported hero.png and bgm.mp3; Library names persisted and the stage remained unchanged after save and reopen.",
            );
        } else if (scenario === scenarios.text) {
            console.log(
                "PASS: edit_text added GAME OVER at 48pt bold on テキスト frame 30; text persisted after save and reopen.",
            );
        } else if (scenario === scenarios.tween) {
            console.log(
                "PASS: edit_tween created a 24-frame backOut motion tween; motion and easing persisted after save and reopen.",
            );
        } else if (scenario === scenarios.instance) {
            console.log(
                "PASS: edit_elements set ボール alpha to 50% and added a blur filter; both persisted after save and reopen.",
            );
        } else if (scenario === scenarios.symbol) {
            console.log(
                "PASS: convert_to_symbol created ball_mc as a movie clip; the converted instance persisted after save and reopen.",
            );
        } else if (scenario === scenarios.testmovie) {
            console.log(
                "PASS: test_movie reported the startup marker and no compile errors; the frame-one script was unchanged after save and reopen.",
            );
        } else if (scenario === scenarios.canvas) {
            console.log(
                "PASS: verify_canvas_output reported the fixture console error; the frame-one script was unchanged after save and reopen.",
            );
        } else {
            console.log("PASS: edit_timeline succeeded; 背景 spans through frame 24 after save and reopen.");
        }
    } catch (error) {
        failure = error;
    } finally {
        if (pathURI) {
            if (scenario === scenarios.testmovie) {
                try {
                    await closeTestMoviePlayer(runJsfl, status, pathURI);
                } catch (error) {
                    failure = failure ? new AggregateError([failure, error], "E2E and Player cleanup failed") : error;
                }
            }
            try {
                await closeDocumentByPath(runJsfl, pathURI);
                pathURI = "";
            } catch (error) {
                failure = failure ? new AggregateError([failure, error], "E2E and document cleanup failed") : error;
            }
        }
        if (!pathURI) {
            try {
                const finalStatus = (await status({})).structuredContent;
                if (finalStatus?.documents?.length !== 0) {
                    failure = failure ?? new Error("Animate state is uncertain; temporary files left intact.");
                } else {
                    const trace = await readFile(tracePath, "utf8").catch(() => "");
                    for (const line of trace.trim().split("\n").filter(Boolean)) {
                        console.log(`TRACE ${line}`);
                    }
                    await rm(outDir, { recursive: true });
                }
            } catch (error) {
                failure = failure
                    ? new AggregateError([failure, error], "E2E and temporary-file cleanup failed")
                    : error;
            }
        } else {
            failure = failure ?? new Error(`Disposable FLA remains open; files left at ${outDir}`);
        }
    }
    if (failure) {
        throw failure;
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

export {
    assertAssetsFixtureAvailable,
    assertAssetsImported,
    assertBackground24,
    assertBallInstance,
    assertBallSymbol,
    assertCanvasFrameScriptUnchanged,
    assertCanvasReply,
    assertCaptureDocumentUnchanged,
    assertCaptureEvidence,
    assertCaptureFixture,
    assertCaptureReply,
    assertGameOverText,
    assertInspectDocumentUnchanged,
    assertInstanceInDocument,
    assertLibraryDocumentUnchanged,
    assertLibraryFixture,
    assertLibraryReply,
    assertPinnedAssetPaths,
    assertPublishReply,
    assertScriptInvestigationReply,
    assertStageProperties,
    assertSuccessfulAssetsImport,
    assertSuccessfulCanvas,
    assertSuccessfulCapture,
    assertSuccessfulEdit,
    assertSuccessfulInstanceEdit,
    assertSuccessfulLibraryListing,
    assertSuccessfulPublish,
    assertSuccessfulScriptEdit,
    assertSuccessfulScriptInvestigation,
    assertSuccessfulStageEdit,
    assertSuccessfulSymbolConversion,
    assertSuccessfulTestMovie,
    assertSuccessfulTextEdit,
    assertSuccessfulTimelineInspection,
    assertSuccessfulTweenEdit,
    assertSymbolInDocument,
    assertTestMovieReply,
    assertTestMovieScriptUnchanged,
    assertTimelineInspectionReply,
    assertTweenReadback,
    claudeArgs,
    closeTestMoviePlayer,
    createAssetsFixture,
    prompt,
    readAssetsDocumentState,
    readCaptureFixture,
    readExportFile,
    readInspectDocumentState,
    readInvestigationScript,
    readLibraryDocumentState,
    runClaude,
    scoped,
    selectedScenario,
    writeExportScript,
};
