import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { getDocumentInfoTool } from "../../../dist/tools/document/get-document-info.js";
import { getStatusTool } from "../../../dist/tools/document/get-status.js";
import { setDocumentPropertiesTool } from "../../../dist/tools/document/set-document-properties.js";
import { editLibraryTool } from "../../../dist/tools/library/edit-library.js";
import { importAssetsTool } from "../../../dist/tools/library/import-assets.js";
import { captureFrameTool } from "../../../dist/tools/output/capture-frame.js";
import { publishTool } from "../../../dist/tools/output/publish.js";
import { testMovieTool } from "../../../dist/tools/output/test-movie.js";
import { verifyCanvasOutputTool } from "../../../dist/tools/output/verify-canvas-output.js";
import { exportScriptsTool } from "../../../dist/tools/scripts/export-scripts.js";
import { convertToSymbolTool } from "../../../dist/tools/timeline/convert-to-symbol.js";
import { editElementsTool } from "../../../dist/tools/timeline/edit-elements.js";
import { editTextTool } from "../../../dist/tools/timeline/edit-text.js";
import { editTimelineTool } from "../../../dist/tools/timeline/edit-timeline.js";
import { editTweenTool } from "../../../dist/tools/timeline/edit-tween.js";
import { inspectTimelineTool } from "../../../dist/tools/timeline/inspect-timeline.js";

export const scenarios = {
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
        initialScript: 'trace("readme initial");',
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
        initialScript: "trace('README_TEST_MOVIE_OK');",
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
export const MAX_SCRIPT_BYTES = 64 * 1024;
export const prompt = scenarios.layer.prompt;
const README_ASSETS_PROMPT = scenarios.assets.prompt;
export const ASSET_LIBRARY_NAMES = ["bgm.mp3", "hero.png"];
export const TEST_MOVIE_MARKER = "README_TEST_MOVIE_OK";
export const CANVAS_ERROR_MARKER = "README_CANVAS_ERROR_MARKER";
export const CANVAS_FRAME_SCRIPT = `console.error("${CANVAS_ERROR_MARKER}");`;
export const investigationScript = "var readmeTotal:Number = (1 + 2;";

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
export async function createAssetsFixture(outDir) {
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
export function selectedScenario(name = process.env.README_PROMPT_E2E_SCENARIO ?? "layer") {
    const scenario = scenarios[name];
    if (!scenario) {
        throw new Error(
            'README_PROMPT_E2E_SCENARIO must be "layer", "stage", "script", "investigate", "text", "tween", "instance", "symbol", "inspect", "library", "capture", "assets", "publish", "testmovie", or "canvas".',
        );
    }
    return scenario;
}
