import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PNG } from "pngjs";
import {
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
    runClaude,
    scoped,
    selectedScenario,
    writeExportScript,
} from "./readme-prompt-e2e.mjs";

test("E2E prompt stays pinned to the selected README example", () => {
    assert.equal(prompt, "シーン1に『背景』レイヤーを追加して、24フレーム分に延ばして");
    assert.equal(selectedScenario("stage").prompt, "ステージを 1280×720、30fps、背景を黒にして");
    assert.equal(selectedScenario("script").prompt, "シーン1の1フレーム目のスクリプトに stop() を追加して反映して");
    assert.equal(
        selectedScenario("investigate").prompt,
        "開いているドキュメントのスクリプトを書き出して、エラーの原因を調べて",
    );
    assert.deepEqual(
        selectedScenario("investigate").tools.map(({ name }) => name),
        ["get_status", "export_scripts"],
    );
    assert.match(selectedScenario("investigate").instruction, /Only get_status, export_scripts, and read_export_file/);
    assert.match(selectedScenario("investigate").instruction, /read "index\.md".*read the scene-one "structure\.md"/);
    assert.match(selectedScenario("investigate").instruction, /exact frame-one AS3 script path/);
    assert.doesNotMatch(selectedScenario("investigate").instruction, /write_export_script|apply_scripts|read_file/);
    assert.equal(
        selectedScenario("text").prompt,
        "シーン1の『テキスト』レイヤーの30フレーム目に、48pt・太字で「GAME OVER」というテキストを追加して",
    );
    assert.equal(
        selectedScenario("tween").prompt,
        "シーン1の『ボール』インスタンスを1〜24フレームで右へ200px動かし、イーズに backOut（少し行き過ぎて戻る）を使って",
    );
    assert.deepEqual(
        selectedScenario("tween").tools.map(({ name }) => name),
        ["get_status", "inspect_timeline", "edit_tween"],
    );
    assert.match(selectedScenario("tween").instruction, /Only get_status, inspect_timeline, and edit_tween/);
    assert.equal(
        selectedScenario("instance").prompt,
        "シーン1の1フレーム目の『ボール』インスタンスを透明度50%にして、ぼかしフィルターを付けて",
    );
    assert.deepEqual(
        selectedScenario("instance").tools.map(({ name }) => name),
        ["get_status", "inspect_timeline", "edit_elements"],
    );
    assert.match(selectedScenario("instance").instruction, /Only get_status, inspect_timeline, and edit_elements/);
    assert.match(selectedScenario("instance").instruction, /alphaPercent: 50/);
    assert.match(selectedScenario("instance").instruction, /blurFilter/);
    assert.equal(
        selectedScenario("symbol").prompt,
        "シーン1の1フレーム目の『ボール』を、ムービークリップ ball_mc に変換して",
    );
    assert.deepEqual(
        selectedScenario("symbol").tools.map(({ name }) => name),
        ["get_status", "inspect_timeline", "convert_to_symbol"],
    );
    assert.match(selectedScenario("symbol").instruction, /Only get_status, inspect_timeline, and convert_to_symbol/);
    assert.equal(
        selectedScenario("inspect").prompt,
        "シーン1の『キャラ』レイヤーの12フレーム目にあるインスタンスとトゥイーンを確認して",
    );
    assert.deepEqual(
        selectedScenario("inspect").tools.map(({ name }) => name),
        ["get_status", "inspect_timeline"],
    );
    assert.match(selectedScenario("inspect").instruction, /Only get_status and inspect_timeline/);
    assert.doesNotMatch(selectedScenario("inspect").instruction, /run_jsfl|edit_/);
    assert.equal(selectedScenario("library").prompt, "ライブラリの未使用アイテムを一覧にして");
    assert.deepEqual(
        selectedScenario("library").tools.map(({ name }) => name),
        ["get_status", "edit_library"],
    );
    assert.match(selectedScenario("library").instruction, /Only get_status and edit_library/);
    assert.match(selectedScenario("library").instruction, /op: "listUnused"/);
    assert.doesNotMatch(selectedScenario("library").instruction, /run_jsfl|write tool/i);
    assert.equal(selectedScenario("capture").prompt, "シーン1の12フレーム目を画像で取得して、見た目を教えて");
    assert.deepEqual(
        selectedScenario("capture").tools.map(({ name }) => name),
        ["get_status", "capture_frame"],
    );
    assert.match(selectedScenario("capture").instruction, /Only get_status and capture_frame/);
    assert.match(selectedScenario("capture").instruction, /exactly frame 12/);
    assert.doesNotMatch(selectedScenario("capture").instruction, /run_jsfl|native/i);
    assert.deepEqual(
        selectedScenario("text").tools.map(({ name }) => name),
        ["get_status", "inspect_timeline", "edit_text"],
    );
    assert.match(selectedScenario("text").instruction, /Only get_status, inspect_timeline, and edit_text/);
    assert.deepEqual(selectedScenario("script").allowlist, [
        "get_status",
        "export_scripts",
        "apply_scripts",
        "read_export_file",
        "write_export_script",
    ]);
    assert.match(selectedScenario("script").instruction, /file: "index\.md"/);
    assert.match(selectedScenario("script").instruction, /relative path/);
    assert.deepEqual(
        selectedScenario("stage").tools.map(({ name }) => name),
        ["get_status", "get_document_info", "set_document_properties"],
    );
    assert.equal(selectedScenario("assets").prompt, "/path/to/hero.png と /path/to/bgm.mp3 をライブラリに取り込んで");
    assert.deepEqual(
        selectedScenario("assets").tools.map(({ name }) => name),
        ["get_status", "import_assets"],
    );
    assert.match(selectedScenario("assets").instruction, /Only get_status and import_assets/);
    assert.match(selectedScenario("assets").instruction, /pinned fixture paths/);
    assert.doesNotMatch(selectedScenario("assets").instruction, /run_jsfl/);
    assert.equal(selectedScenario("publish").prompt, "開いているドキュメントを Publish して、コンパイルエラーを教えて");
    assert.deepEqual(
        selectedScenario("publish").tools.map(({ name }) => name),
        ["get_status", "publish"],
    );
    assert.match(selectedScenario("publish").instruction, /Only get_status and publish/);
    assert.doesNotMatch(selectedScenario("publish").instruction, /run_jsfl|native/i);
    assert.equal(
        selectedScenario("testmovie").prompt,
        "開いている AS3 ドキュメントを Test Movie で実行して、コンパイルエラーと起動直後の出力を教えて",
    );
    assert.deepEqual(
        selectedScenario("testmovie").tools.map(({ name }) => name),
        ["get_status", "test_movie"],
    );
    assert.match(selectedScenario("testmovie").instruction, /Only get_status and test_movie/);
    assert.match(selectedScenario("testmovie").instruction, /execute_write with test_movie/);
    assert.doesNotMatch(selectedScenario("testmovie").instruction, /run_jsfl|native/i);
    assert.equal(selectedScenario("canvas").prompt, "Canvas 出力を Chrome で開いて、コンソールエラーがないか確認して");
    assert.deepEqual(
        selectedScenario("canvas").tools.map(({ name }) => name),
        ["get_status", "verify_canvas_output"],
    );
    assert.match(selectedScenario("canvas").instruction, /Only get_status and verify_canvas_output/);
    assert.doesNotMatch(selectedScenario("canvas").instruction, /run_jsfl|native/i);
    assert.throws(
        () => selectedScenario("invalid"),
        /must be "layer", "stage", "script", "investigate", "text", "tween", "instance", "symbol", "inspect", "library", "capture", "assets", "publish", "testmovie", or "canvas"/,
    );
    const args = claudeArgs("/tmp/mcp.json", selectedScenario("stage").prompt);
    assert.equal(args[1], "ステージを 1280×720、30fps、背景を黒にして");
    const scriptArgs = claudeArgs("/tmp/mcp.json", selectedScenario("script").prompt);
    assert.equal(scriptArgs[scriptArgs.indexOf("--max-turns") + 1], "12");
});

test("publish trace requires a verified compiler-error result and its reply cites the diagnostic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-publish-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const returned = [];
    const responses = [
        { data: { ok: false, compilerOutput: "verified", errors: [{ code: "1084" }] } },
        { data: { ok: true, compilerOutput: "verified", errors: [{ code: "1084" }] } },
        { data: { ok: false, compilerOutput: "unavailable", errors: [{ code: "1084" }] } },
        { data: { ok: false, compilerOutput: "verified", errors: [] } },
        { isError: true, data: { ok: false, compilerOutput: "verified", errors: [{ code: "1084" }] } },
    ];
    let responseIndex = 0;
    const publish = scoped(
        {
            name: "publish",
            run: async (input) => {
                returned.push(input);
                return responses[responseIndex++];
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
    );
    try {
        for (let index = 0; index < responses.length; index++) {
            await publish.run({ document: "user.fla" }, {}, {});
        }
        assert.deepEqual(
            returned.map(({ document }) => document),
            Array(responses.length).fill("disposable.fla"),
        );
        const trace = (await readFile(tracePath, "utf8")).trim();
        assert.deepEqual(
            trace.split("\n").map((line) => {
                const { targetTool, succeeded } = JSON.parse(line);
                assert.equal(targetTool, "publish");
                return succeeded;
            }),
            [true, false, false, false, false],
        );
        assertSuccessfulPublish(
            '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"publish","succeeded":true}',
        );
        for (const invalid of [
            '{"targetTool":"publish","succeeded":false}',
            '{"targetTool":"publish","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
            '{"targetTool":"get_status","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulPublish(invalid));
        }
        assertPublishReply("readmeTotal: error 1084 at line 1; rightparen is required before semicolon.");
        assertPublishReply("1行目のシンタックスエラーで、rightparen が semicolon の前に必要です。");
        for (const reply of [
            "readmeTotal has a syntax error.",
            "A closing parenthesis is missing.",
            "Error 1084 at line 1.",
        ]) {
            assert.throws(() => assertPublishReply(reply));
        }
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("test_movie is scoped to the disposable FLA, validates its result, and closes Player windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-testmovie-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const responses = [
        {
            data: {
                runtimeOutput: "README_TEST_MOVIE_OK",
                compilerDiagnostics: { status: "parsed", errors: [], warnings: [] },
            },
        },
        {
            data: {
                runtimeOutput: "README_TEST_MOVIE_OK",
                compilerDiagnostics: { status: "unavailable", errors: [], warnings: [] },
            },
        },
        {
            data: {
                runtimeOutput: "README_TEST_MOVIE_OK",
                compilerDiagnostics: { status: "parsed", errors: [{}], warnings: [] },
            },
        },
        {
            data: {
                runtimeOutput: "other output",
                compilerDiagnostics: { status: "parsed", errors: [], warnings: [] },
            },
        },
        { isError: true, data: { runtimeOutput: "README_TEST_MOVIE_OK" } },
    ];
    const calls = [];
    let responseIndex = 0;
    const wrapped = scoped(
        {
            name: "test_movie",
            run: async (input) => {
                calls.push(input);
                return responses[responseIndex++];
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
    );
    try {
        for (let index = 0; index < responses.length; index++) {
            await wrapped.run({ document: "user.fla" }, {}, {});
        }
        assert.deepEqual(
            calls.map(({ document }) => document),
            Array(responses.length).fill("disposable.fla"),
        );
        const trace = (await readFile(tracePath, "utf8")).trim();
        assert.deepEqual(
            trace.split("\n").map((line) => {
                const entry = JSON.parse(line);
                assert.equal(entry.targetTool, "test_movie");
                assert.equal("input" in entry, false);
                assert.equal("arguments" in entry, false);
                return entry.succeeded;
            }),
            [true, false, false, false, false],
        );
        assertSuccessfulTestMovie(
            '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"test_movie","succeeded":true}',
        );
        for (const invalid of [
            '{"targetTool":"test_movie","succeeded":false}',
            '{"targetTool":"get_status","succeeded":true}',
            '{"targetTool":"test_movie","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulTestMovie(invalid));
        }
        await assert.rejects(
            scoped(
                { name: "test_movie", run: async () => assert.fail("test_movie ran with another document open") },
                "file:///tmp/disposable.fla",
                async () => ({
                    data: {
                        documents: [
                            { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                            { path: "file:///tmp/user.fla", name: "user.fla" },
                        ],
                    },
                }),
            ).run({}, {}, {}),
            /only the disposable FLA open/,
        );

        let playerCleanupCode;
        let statusCalls = 0;
        await closeTestMoviePlayer(
            async ({ code }) => {
                playerCleanupCode = code;
                return { structuredContent: { result: true } };
            },
            async () => {
                statusCalls += 1;
                return {
                    structuredContent: {
                        documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }],
                    },
                };
            },
            "file:///tmp/disposable.fla",
        );
        assert.match(playerCleanupCode, /fl\.closeAllPlayerDocuments\(\)/);
        assert.equal(statusCalls, 2);
        let unsafeCleanupRan = false;
        await assert.rejects(
            closeTestMoviePlayer(
                async () => {
                    unsafeCleanupRan = true;
                    return { structuredContent: { result: true } };
                },
                async () => ({
                    structuredContent: {
                        documents: [
                            { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                            { path: "file:///tmp/user.fla", name: "user.fla" },
                        ],
                    },
                }),
                "file:///tmp/disposable.fla",
            ),
            /not the only open document/,
        );
        assert.equal(unsafeCleanupRan, false);

        assertTestMovieReply("README_TEST_MOVIE_OK。コンパイルエラーはありません。");
        assertTestMovieReply("README_TEST_MOVIE_OK; no compile errors.");
        assertTestMovieReply("README_TEST_MOVIE_OK — エラーなし。");
        for (const reply of [
            "README_TEST_MOVIE_OK; compile error found.",
            "コンパイルエラーはありません。",
            "README_TEST_MOVIE_OK",
        ]) {
            assert.throws(() => assertTestMovieReply(reply));
        }
        const script = "trace('README_TEST_MOVIE_OK');";
        assertTestMovieScriptUnchanged(script, script);
        assert.throws(() => assertTestMovieScriptUnchanged(script, "trace('changed');"));
        assert.throws(() => assertTestMovieScriptUnchanged("trace('other');", "trace('other');"));
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("Canvas scenario is scoped to the disposable FLA and pins browser output and observation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-canvas-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const marker = "README_CANVAS_ERROR_MARKER";
    const responses = [
        { data: { browserOutput: { consoleErrors: [marker] } } },
        { data: { browserOutput: { consoleErrors: [] } } },
        { data: { browserOutput: { consoleErrors: ["other error"] } } },
        { isError: true, data: { browserOutput: { consoleErrors: [marker] } } },
        { data: {} },
    ];
    const inputs = [
        { document: "user.fla", publish: false, htmlPath: "/outside/user.html", observeMs: 30_000, path: "/outside" },
        { document: "user.fla", publish: false, htmlPath: "/outside/user.html", observeMs: 1_500 },
        { document: "user.fla", observeMs: 5_001 },
        { document: "user.fla", observeMs: 0 },
        { document: "user.fla" },
    ];
    const calls = [];
    let responseIndex = 0;
    const wrapped = scoped(
        {
            name: "verify_canvas_output",
            run: async (input) => {
                calls.push(input);
                return responses[responseIndex++];
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
        directory,
    );
    try {
        for (const input of inputs) {
            await wrapped.run(input, {}, {});
        }
        const pinnedHtmlPath = join(directory, `${basename(directory)}.html`);
        assert.ok(pinnedHtmlPath.startsWith(`${directory}/`));
        assert.deepEqual(
            calls,
            inputs.map((_, index) => ({
                document: "disposable.fla",
                publish: true,
                htmlPath: pinnedHtmlPath,
                observeMs: [5_000, 1_500, 5_000, 0, 3_000][index],
            })),
        );
        const entries = (await readFile(tracePath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            entries.map(({ targetTool, succeeded, failureStage, durationMs, ...entry }) => {
                assert.equal(targetTool, "verify_canvas_output");
                assert.deepEqual(entry, {});
                assert.ok(Number.isFinite(durationMs));
                assert.equal(failureStage, succeeded ? undefined : "tool");
                return succeeded;
            }),
            [true, false, false, false, false],
        );
        assertSuccessfulCanvas(
            '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"verify_canvas_output","succeeded":true}',
        );
        for (const trace of [
            '{"targetTool":"verify_canvas_output","succeeded":false}',
            '{"targetTool":"verify_canvas_output","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
            '{"targetTool":"get_status","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulCanvas(trace));
        }
        const unsafe = scoped(
            {
                name: "verify_canvas_output",
                run: async () => assert.fail("Canvas tool ran with another document open"),
            },
            "file:///tmp/disposable.fla",
            async () => ({
                data: {
                    documents: [
                        { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                        { path: "file:///tmp/user.fla", name: "user.fla" },
                    ],
                },
            }),
            directory,
        );
        await assert.rejects(unsafe.run({ htmlPath: "/outside/user.html" }, {}, {}), /only the disposable FLA open/);

        assertCanvasReply("コンソールエラーが検出されました: README_CANVAS_ERROR_MARKER");
        assertCanvasReply("Console errors were detected: README_CANVAS_ERROR_MARKER");
        for (const reply of [
            "README_CANVAS_ERROR_MARKER, but there are no console errors.",
            "The console is clean.",
            "Console errors were detected.",
        ]) {
            assert.throws(() => assertCanvasReply(reply));
        }
        const script = 'console.error("README_CANVAS_ERROR_MARKER");';
        assertCanvasFrameScriptUnchanged(script, script);
        assert.throws(() => assertCanvasFrameScriptUnchanged(script, 'console.error("changed");'));
        assert.throws(() => assertCanvasFrameScriptUnchanged('console.error("other");', 'console.error("other");'));
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("assets scenario generates disposable fixtures and substitutes their absolute paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-assets-"));
    try {
        const fixture = await createAssetsFixture(directory);
        assert.deepEqual(fixture.paths, [join(directory, "hero.png"), join(directory, "bgm.mp3")]);
        assert.ok(fixture.paths.every((path) => path.startsWith("/")));
        assert.equal(fixture.prompt, `${fixture.paths[0]} と ${fixture.paths[1]} をライブラリに取り込んで`);
        assert.doesNotMatch(fixture.prompt, /\/path\/to\//);
        const png = PNG.sync.read(await readFile(fixture.paths[0]));
        assert.equal(png.width, 1);
        assert.equal(png.height, 1);
        const mp3 = await readFile(fixture.paths[1]);
        assert.ok(mp3.length > 128, "MP3 fixture is empty or truncated");
        assert.ok(mp3.subarray(0, 3).equals(Buffer.from("ID3")) || mp3[0] === 0xff, "MP3 frame header is missing");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("assets import is pinned to exactly the two fixtures and traces a successful import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-assets-scope-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const pinnedPaths = [join(directory, "hero.png"), join(directory, "bgm.mp3")];
    const calls = [];
    const wrapped = scoped(
        {
            name: "import_assets",
            run: async (input) => {
                calls.push(input);
                return { data: { document: "disposable.fla", items: ["hero.png", "bgm.mp3"] } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
        directory,
        pinnedPaths,
    );
    try {
        assert.deepEqual(assertPinnedAssetPaths([...pinnedPaths].reverse(), pinnedPaths), pinnedPaths);
        for (const paths of [
            [...pinnedPaths, join(directory, "extra.png")],
            [pinnedPaths[0], pinnedPaths[0]],
            [pinnedPaths[0], "/tmp/arbitrary.mp3"],
            ["relative.png", pinnedPaths[1]],
        ]) {
            assert.throws(() => assertPinnedAssetPaths(paths, pinnedPaths), /exactly the pinned PNG and MP3/);
            await assert.rejects(wrapped.run({ paths }, {}, {}), /exactly the pinned PNG and MP3/);
        }
        await writeFile(tracePath, "");
        await wrapped.run({ paths: [...pinnedPaths].reverse(), document: "user.fla" }, {}, {});
        assert.deepEqual(calls, [{ paths: pinnedPaths, document: "disposable.fla" }]);
        assertSuccessfulAssetsImport(await readFile(tracePath, "utf8"));
        for (const trace of [
            '{"targetTool":"import_assets","succeeded":false}',
            '{"targetTool":"import_assets","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
            '{"targetTool":"get_status","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulAssetsImport(trace));
        }
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("trusted assets readback requires both Library items and an unchanged stage", async () => {
    const before = "550\t400\t24\t#ffffff\n--LIBRARY--\n\n--STAGE--\n0\t0\tLayer 1\t0\t1\t\t0";
    const after = "550\t400\t24\t#ffffff\n--LIBRARY--\nbgm.mp3\nhero.png\n--STAGE--\n0\t0\tLayer 1\t0\t1\t\t0";
    assertAssetsFixtureAvailable(before);
    assertAssetsImported(before, after);
    assert.throws(() => assertAssetsFixtureAvailable(after), /already contains a fixture Library item name/);
    for (const invalid of [
        before.replace("#ffffff", "#000000"),
        after.replace("hero.png", "hero-copy.png"),
        after.replace("bgm.mp3\nhero.png", "bgm.mp3\nhero.png\nextra.png"),
    ]) {
        assert.throws(() => assertAssetsImported(before, invalid));
    }
    await assert.rejects(
        readAssetsDocumentState(
            async () => ({ structuredContent: { result: "READ_ERROR:document" } }),
            async () => ({ structuredContent: { documents: [{ path: "file:///tmp/disposable.fla" }] } }),
            "file:///tmp/disposable.fla",
        ),
        /Trusted assets verification failed/,
    );
});

test("script investigation requires a successful read-only export/read and fixture-specific diagnosis", () => {
    assertSuccessfulScriptInvestigation(
        '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"read_export_file","succeeded":true}',
    );
    for (const trace of [
        '{"targetTool":"export_scripts","succeeded":false}\n{"targetTool":"read_export_file","succeeded":true}',
        '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"read_export_file","succeeded":false}',
        '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"write_export_script","succeeded":true}',
    ]) {
        assert.throws(() => assertSuccessfulScriptInvestigation(trace));
    }
    assertScriptInvestigationReply("readmeTotal has a missing closing parenthesis after the expression.");
    assert.throws(
        () => assertScriptInvestigationReply("The expression is missing a closing parenthesis."),
        /identify the fixture script/,
    );
    assert.throws(
        () => assertScriptInvestigationReply("readmeTotal has an undefined variable."),
        /missing closing parenthesis/,
    );
});

test("library scenario requires only the successful listUnused operation and the exact unused reply", () => {
    assertSuccessfulLibraryListing(
        '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"edit_library","succeeded":true}',
    );
    for (const trace of [
        '{"targetTool":"edit_library","succeeded":false}',
        '{"targetTool":"edit_library","succeeded":true}\n{"targetTool":"edit_timeline","succeeded":true}',
    ]) {
        assert.throws(() => assertSuccessfulLibraryListing(trace));
    }
    assertLibraryReply("Unused library item: unused_mc");
    assert.throws(() => assertLibraryReply("Unused library item: used_mc"), /omitted the unused item/);
    assert.throws(() => assertLibraryReply("unused_mc and used_mc"), /included the used item/);
    assertLibraryReply("unused_mc");
    assertLibraryFixture("2\n1\nunused_mc\tused_mc\nunused_mc");
    for (const invalid of [
        "2\n1\nunused_mc\tused_mc\n",
        "2\n2\nunused_mc\tused_mc\nunused_mc",
        "2\n1\nunused_mc\tused_mc\nunused_mc\tused_mc",
        "3\n1\nunused_mc\tused_mc\nunused_mc",
    ]) {
        assert.throws(() => assertLibraryFixture(invalid));
    }
    const before = "2\n1\nunused_mc\tused_mc\nunused_mc";
    assertLibraryDocumentUnchanged(before, before);
    for (const after of [
        "3\n1\nextra_mc\tunused_mc\tused_mc\nunused_mc",
        "2\n2\nunused_mc\tused_mc\nunused_mc",
        "2\n1\nunused_mc\tother_mc\nunused_mc",
    ]) {
        assert.throws(() => assertLibraryDocumentUnchanged(before, after));
    }
});

test("capture scenario pins frame 12, verifies PNG output, visual reply, and unchanged fixture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-capture-evidence-"));
    const captureDir = join(directory, "captures");
    await mkdir(captureDir);
    const path = join(captureDir, "12-test.png");
    const png = new PNG({ width: 550, height: 400 });
    for (const [x, y] of [
        [60, 60],
        [240, 90],
    ]) {
        png.data.set([0, 0, 0, 255], (y * png.width + x) * 4);
    }
    const bytes = PNG.sync.write(png);
    await writeFile(path, bytes);
    const metadata = { path, frame: 12, timeline: "シーン 1", width: 550, height: 400 };
    const evidence = {
        data: metadata,
        content: [
            { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
            { type: "text", text: JSON.stringify(metadata) },
        ],
    };
    const report = "シーン 1\t12\t550\t400\t1\tshape\t165\t90\t250\t100";
    try {
        assert.equal(assertCaptureFixture(report), "シーン 1");
        assertCaptureDocumentUnchanged(report, report);
        await assertCaptureEvidence(evidence, directory, "シーン 1");
        assertCaptureReply("黒い長方形と黒い楕円が見えます。");
        assertCaptureReply("黒い正方形と円が見えます。");
        assertCaptureReply("Black square and circle.");
        for (const reply of ["黒い長方形です", "青い円です", "", "black circle and triangle"]) {
            assert.throws(() => assertCaptureReply(reply));
        }
        assert.throws(
            () => assertCaptureReply("black circle and triangle"),
            (error) => {
                assert.match(error.message, /"squareOrRectangle":false/);
                assert.match(error.message, /"circleOrOval":true/);
                assert.match(error.message, /"black":true/);
                assert.match(error.message, /"replyLength":25/);
                assert.doesNotMatch(error.message, /black circle and triangle/);
                return true;
            },
        );
        assertSuccessfulCapture(
            '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"capture_frame","succeeded":true}',
        );
        for (const trace of [
            '{"targetTool":"capture_frame","succeeded":false}',
            '{"targetTool":"capture_frame","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulCapture(trace));
        }
        await assert.rejects(assertCaptureEvidence({ ...evidence, data: { ...metadata, frame: 11 } }, directory));
        await assert.rejects(
            assertCaptureEvidence(
                {
                    ...evidence,
                    content: [
                        { ...evidence.content[0], data: Buffer.from("bad").toString("base64") },
                        evidence.content[1],
                    ],
                },
                directory,
            ),
        );
        assert.throws(() => assertCaptureFixture(report.replace("\t250\t100", "\t249\t100")));
        assert.throws(() => assertCaptureDocumentUnchanged(report, report.replace("\t12\t", "\t11\t")));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("capture fixture readback expects Animate's merged single shape element", async () => {
    let jsfl;
    const report = "シーン 1\t12\t550\t400\t1\tshape\t165\t90\t250\t100";
    assert.equal(
        await readCaptureFixture(
            async ({ code }) => {
                jsfl = code;
                return { structuredContent: { result: report } };
            },
            async () => ({
                structuredContent: { documents: [{ path: "file:///tmp/disposable.fla" }] },
            }),
            "file:///tmp/disposable.fla",
        ),
        report,
    );
    assert.match(jsfl, /elements\.length !== 1/);
    assert.doesNotMatch(jsfl, /elements\.length !== 2/);
});

test("text scenario requires successful edit_text and exact persisted frame/style", () => {
    assertSuccessfulTextEdit('{"targetTool":"edit_text","succeeded":true}');
    assert.throws(
        () => assertSuccessfulTextEdit('{"targetTool":"edit_text","succeeded":false}'),
        /successfully call edit_text/,
    );
    assertGameOverText("テキスト\t29\tGAME OVER\t48\ttrue");
    for (const report of [
        "別レイヤー\t29\tGAME OVER\t48\ttrue",
        "テキスト\t28\tGAME OVER\t48\ttrue",
        "テキスト\t29\tOTHER\t48\ttrue",
        "テキスト\t29\tGAME OVER\t24\ttrue",
        "テキスト\t29\tGAME OVER\t48\tfalse",
    ]) {
        assert.throws(() => assertGameOverText(report), /does not contain/);
    }
});

test("instance scenario requires a successful edit_elements trace and persisted alpha/blur", async () => {
    assertSuccessfulInstanceEdit('{"targetTool":"edit_elements","succeeded":true}');
    assert.throws(
        () => assertSuccessfulInstanceEdit('{"targetTool":"edit_elements","succeeded":false}'),
        /successfully call edit_elements/,
    );
    const report = "BallLayer\t0\t1\tボール\tinstance\talpha\t50\t1\tblurFilter\ttrue\t4\t4\tlow";
    assertBallInstance(report);
    let jsflCode;
    await assertInstanceInDocument(
        async ({ code }) => {
            jsflCode = code;
            return { structuredContent: { result: report } };
        },
        async () => ({ structuredContent: { documents: [{ path: "file:///tmp/disposable.fla" }] } }),
        "file:///tmp/disposable.fla",
    );
    assert.match(jsflCode, /join\(String\.fromCharCode\(9\)\)/);
    for (const invalid of [
        report.replace("ボール", "other"),
        report.replace("\talpha\t", "\tnone\t"),
        report.replace("\t50\t", "\t49.5\t"),
        report.replace("\tblurFilter\t", "\tglowFilter\t"),
        report.replace("\ttrue\t4\t", "\tfalse\t4\t"),
        report.replace("\t4\t4\tlow", "\t2\t4\tlow"),
    ]) {
        assert.throws(() => assertBallInstance(invalid));
    }
});

test("symbol conversion requires the requested movie clip and no loose stage shape", () => {
    assertSuccessfulSymbolConversion('{"targetTool":"convert_to_symbol","succeeded":true}');
    assert.throws(
        () => assertSuccessfulSymbolConversion('{"targetTool":"convert_to_symbol","succeeded":false}'),
        /successfully convert the element to ball_mc/,
    );
    const report = "ball_mc\tmovie clip\tボール\t0\t1\t1\tinstance\tball_mc\tmovie clip\t0";
    assertBallSymbol(report);
    for (const invalid of [
        report.replace("ball_mc", "other"),
        report.replace("movie clip", "graphic"),
        report.replace("ボール", "other"),
        report.replace("\t0\t1\t1\tinstance", "\t1\t1\t1\tinstance"),
        report.replace("\t1\tinstance\t", "\t2\tinstance\t"),
        report.replace("\tinstance\tball_mc", "\tshape\tball_mc"),
        report.replace("\tball_mc\tmovie clip\t0", "\tother\tmovie clip\t0"),
        report.replace("\tmovie clip\t0", "\tgraphic\t0"),
        report.replace("\t0\t1\t1\tinstance", "\t0\t1\t0\tinstance"),
        report.replace("\tmovie clip\t0", "\tmovie clip\t1"),
    ]) {
        assert.throws(() => assertBallSymbol(invalid));
    }
});

test("inspect scenario requires only successful read-only inspections and an accurate final reply", () => {
    assertSuccessfulTimelineInspection(
        '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"inspect_timeline","succeeded":true}',
    );
    assert.throws(
        () =>
            assertSuccessfulTimelineInspection(
                '{"targetTool":"inspect_timeline","succeeded":true}\n{"targetTool":"edit_tween","succeeded":true}',
            ),
        /non-read-only tool/,
    );
    assert.throws(
        () => assertSuccessfulTimelineInspection('{"targetTool":"inspect_timeline","succeeded":false}'),
        /successfully inspect the timeline/,
    );
    assertTimelineInspectionReply("The hero instance has a motion tween.");
    assertTimelineInspectionReply("hero はモーションのトゥイーンです。");
    for (const reply of ["The character moves.", "The hero instance is static.", ""]) {
        assert.throws(() => assertTimelineInspectionReply(reply));
    }
});

test("trusted inspect readback requires unchanged hero tween and frame-12 position", () => {
    const before = "1\t24\tキャラ\t0\t24\thero\t97.35";
    assertInspectDocumentUnchanged(before, before);
    for (const after of [
        "2\t24\tキャラ\t0\t24\thero\t97.35",
        "1\t24\tキャラ\t0\t23\thero\t97.35",
        "1\t24\tキャラ\t0\t24\tother\t97.35",
        "1\t24\tキャラ\t0\t24\thero\t98",
        "1\t24\tother\t0\t24\thero\t97.35",
    ]) {
        assert.throws(() => assertInspectDocumentUnchanged(before, after));
    }
    assert.throws(() => assertInspectDocumentUnchanged(before, "READ_ERROR:timeline"));
});

test("tween trace and persisted readback require the 24-frame backOut motion", () => {
    assertSuccessfulTweenEdit('{"targetTool":"edit_tween","succeeded":true}');
    assert.throws(
        () => assertSuccessfulTweenEdit('{"targetTool":"edit_tween","succeeded":false}'),
        /successfully apply edit_tween/,
    );
    const xml =
        '<MotionObject TimeScale="24000"><Property id="Motion_X"><Keyframe anchor="0,0" next="4024,177" previous="0,0" timevalue="0"/><Keyframe anchor="0,200" next="0,200" previous="-15639,255" timevalue="23000"/></Property></MotionObject>';
    const report = [
        ["BallLayer", "0", "24", "motion object", "ボール", "ボール", "40", "240", "257.3", "24"].join("\t"),
        xml,
    ].join("\n--MOTION_XML--\n");
    assertTweenReadback(report, 40);
    for (const invalid of [
        report.replace("motion object", "motion"),
        report.replace("ボール", "other"),
        report.replace("\t24\tmotion object", "\t23\tmotion object"),
        report.replace("\t240\t", "\t242\t"),
        report.replace("\t257.3\t24", "\t240\t24"),
        report.replace('next="4024,177"', 'next="7667,67"'),
    ]) {
        assert.throws(() => assertTweenReadback(invalid, 40));
    }
    const startKeyframeEase = report
        .replace("4024,177", "5750,50")
        .replace("-15639,255", "-5750,150")
        .replace("\t257.3\t24", "\t231.3\t24");
    assert.throws(
        () => assertTweenReadback(startKeyframeEase, 40),
        /maxX=231\.3, endX=240, Motion_X backOut handles: start=false, end=false/,
    );
});

test("script export bridge only reads and writes the manifested scene-one frame-one AS3 script", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-script-bridge-"));
    const exportDir = join(directory, "export");
    const script = "scenes/Scene 1/Layer 1/1.as";
    const target = join(exportDir, script);
    try {
        await mkdir(join(exportDir, "scenes", "Scene 1", "Layer 1"), { recursive: true });
        await writeFile(target, 'trace("readme initial");');
        await writeFile(join(exportDir, "index.md"), "scene index");
        const structure = `scene structure\nscript: ${script}`;
        await writeFile(join(exportDir, "scenes", "Scene 1", "structure.md"), structure);
        await writeFile(
            join(exportDir, ".export.json"),
            JSON.stringify({
                type: "Flash",
                files: {
                    [script]: { scene: 0, layer: 0, start: 0, script: 'trace("readme initial");' },
                    "scenes/Scene 2/Layer 1/1.as": { scene: 1, layer: 0, start: 0, script: "other scene" },
                },
                timelines: [
                    { dir: "scenes/Scene 1", scene: 0, layers: [] },
                    { dir: "scenes/Scene 2", scene: 1, layers: [] },
                ],
            }),
        );
        assert.deepEqual((await readExportFile(exportDir, "index.md")).data, { content: "scene index" });
        const structureResult = await readExportFile(exportDir, "scenes/Scene 1/structure.md");
        assert.deepEqual(structureResult.data, { content: structure });
        const discoveredScriptPath = structureResult.data.content.split("script: ")[1];
        assert.deepEqual((await readExportFile(exportDir, discoveredScriptPath)).data, {
            content: 'trace("readme initial");',
        });
        await assert.rejects(writeExportScript(exportDir, "index.md", "overwritten"), /may be written/);
        await assert.rejects(
            writeExportScript(exportDir, "scenes/Scene 1/structure.md", "overwritten"),
            /may be written/,
        );
        await writeExportScript(exportDir, script, 'trace("readme initial");\nstop();');
        assert.match((await readExportFile(exportDir, script)).data.content, /stop\(\)/);
        for (const badPath of [
            "../secret.as",
            "/tmp/secret.as",
            "scenes\\Scene 1\\Layer 1\\1.as",
            "scenes/Scene 1/Layer 1/2.as",
            "scenes/Scene 2/Layer 1/1.as",
            "scenes/Scene 2/structure.md",
            "scenes/Scene 1/structure.md/1.as",
            "other.md",
            "scenes/Scene 1/Layer 1/\0.as",
        ]) {
            await assert.rejects(readExportFile(exportDir, badPath));
        }
        await assert.rejects(writeExportScript(exportDir, script, "x".repeat(64 * 1024 + 1)), /64 KB/);
        await rm(target);
        await symlink(join(directory, "outside.as"), target);
        await writeFile(join(directory, "outside.as"), "outside");
        await assert.rejects(readExportFile(exportDir, script));
        await rm(target);
        await rm(join(exportDir, "scenes", "Scene 1", "Layer 1"), { recursive: true });
        await symlink(directory, join(exportDir, "scenes", "Scene 1", "Layer 1"));
        await assert.rejects(readExportFile(exportDir, script), /symlinks/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("script trace requires export, file write, then successful apply", () => {
    assertSuccessfulScriptEdit(
        [
            { targetTool: "export_scripts", succeeded: true },
            { targetTool: "read_export_file", succeeded: true },
            { targetTool: "write_export_script", succeeded: true },
            { targetTool: "apply_scripts", succeeded: true },
        ]
            .map((entry) => JSON.stringify(entry))
            .join("\n"),
    );
    assert.throws(
        () =>
            assertSuccessfulScriptEdit(
                '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"apply_scripts","succeeded":true}',
            ),
        /Expected successful export/,
    );
});

test("persisted timeline assertion requires 背景 and a span through frame 24", () => {
    assertBackground24([{ name: "背景", frameCount: 24, spans: [{ start: 1, end: 24 }] }]);
    assert.throws(() => assertBackground24([]), /背景 layer/);
    assert.throws(
        () => assertBackground24([{ name: "背景", frameCount: 23, spans: [{ start: 1, end: 23 }] }]),
        /only 23 frames/,
    );
    assert.throws(
        () => assertBackground24([{ name: "背景", frameCount: 24, spans: [{ start: 1, end: 23 }] }]),
        /no span reaching frame 24/,
    );
});

test("timeline tools are pinned to the disposable document and stop if another document opens", async () => {
    const calls = [];
    const tool = {
        name: "edit_timeline",
        run: async (args) => {
            calls.push(args);
            return { data: {} };
        },
    };
    const safe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    }));
    await safe.run({ document: "user-document.fla", timeline: 0 }, {}, {});
    assert.equal(calls[0].document, "disposable.fla");

    const unsafe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: {
            documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }, { path: "user-document.fla" }],
        },
    }));
    await assert.rejects(unsafe.run({ timeline: 0 }, {}, {}), /only the disposable FLA open/);
    assert.equal(calls.length, 1);
});

test("edit_text is scoped to the sole disposable document and trace success requires applied edits", async () => {
    let captured;
    const editText = scoped(
        {
            name: "edit_text",
            run: async (input) => {
                captured = input;
                return { data: { applied: 1 } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
    );
    const operation = { timeline: 0, ops: [{ op: "add", layer: "テキスト", frame: 30 }] };
    await editText.run({ ...operation, document: "user.fla" }, {}, {});
    assert.equal(captured.document, "disposable.fla");
    assert.deepEqual(captured.ops, operation.ops);

    const unsafe = scoped(
        { name: "edit_text", run: async () => assert.fail("Out-of-scope edit_text ran") },
        "file:///tmp/disposable.fla",
        async () => ({
            data: {
                documents: [
                    { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                    { path: "file:///tmp/user.fla", name: "user.fla" },
                ],
            },
        }),
    );
    await assert.rejects(unsafe.run(operation, {}, {}), /only the disposable FLA open/);
});

test("capture_frame is scoped to the sole disposable document and pins frame and output directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-capture-scope-"));
    const captured = [];
    const capture = scoped(
        {
            name: "capture_frame",
            run: async (input) => {
                captured.push(input);
                return { data: { frame: 12 }, content: [{ type: "image", data: "png" }] };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
        directory,
    );
    try {
        await capture.run({ frame: 2, dir: "/user/path" }, {}, {});
        assert.deepEqual(captured, [{ frame: 12, dir: join(directory, "captures") }]);
        await assert.rejects(capture.run({ range: { start: 1, end: 12 } }, {}, {}), /ranges are not allowed/);
        const unsafe = scoped(
            { name: "capture_frame", run: async () => assert.fail("Capture ran with another document open") },
            "file:///tmp/disposable.fla",
            async () => ({
                data: {
                    documents: [
                        { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                        { path: "file:///tmp/user.fla", name: "user.fla" },
                    ],
                },
            }),
            directory,
        );
        await assert.rejects(unsafe.run({ frame: 12 }, {}, {}), /only the disposable FLA open/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("edit_tween trace succeeds only when edits were applied with no failed operations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-tween-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    /** Returns the sole disposable document for a scoped edit_tween call.
     * @returns Status result.
     */
    const checkStatus = async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    });
    try {
        for (const data of [
            { applied: [{}], failed: null },
            { applied: [], failed: null },
            { applied: [{}], failed: { error: "failed" } },
        ]) {
            const wrapped = scoped(
                { name: "edit_tween", run: async () => ({ data }) },
                "file:///tmp/disposable.fla",
                checkStatus,
            );
            await wrapped.run({ timeline: 0, ops: [] }, {}, {});
        }
        const entries = (await readFile(tracePath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            entries.map(({ targetTool, succeeded }) => [targetTool, succeeded]),
            [
                ["edit_tween", true],
                ["edit_tween", false],
                ["edit_tween", false],
            ],
        );
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("edit_elements is scoped to the sole disposable document and traces only applied success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-instance-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    /** Returns the sole disposable document for a scoped edit_elements call.
     * @returns Status result.
     */
    const checkStatus = async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    });
    const captured = [];
    try {
        for (const applied of [1, 0]) {
            const wrapped = scoped(
                {
                    name: "edit_elements",
                    run: async (input) => {
                        captured.push(input);
                        return { data: { applied } };
                    },
                },
                "file:///tmp/disposable.fla",
                checkStatus,
            );
            await wrapped.run(
                {
                    document: "user.fla",
                    timeline: 0,
                    ops: [
                        {
                            layer: "BallLayer",
                            frame: 1,
                            element: "ボール",
                            set: {
                                colorEffect: { mode: "alpha", alphaPercent: 50 },
                                filters: [{ name: "blurFilter", blurX: 4, blurY: 4, quality: "low" }],
                            },
                        },
                    ],
                },
                {},
                {},
            );
        }
        assert.deepEqual(
            captured.map(({ document }) => document),
            ["disposable.fla", "disposable.fla"],
        );
        const entries = (await readFile(tracePath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            entries.map(({ targetTool, succeeded }) => [targetTool, succeeded]),
            [
                ["edit_elements", true],
                ["edit_elements", false],
            ],
        );
        assert.ok(entries.every((entry) => !("input" in entry) && !("arguments" in entry)));
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("convert_to_symbol is scoped and traces the requested movie-clip result without inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-symbol-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    /** Returns the sole disposable document for a scoped symbol conversion.
     * @returns Status result.
     */
    const checkStatus = async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    });
    const captured = [];
    try {
        for (const data of [
            { name: "ball_mc", type: "movie clip", registrationPoint: "center" },
            { name: "other", type: "movie clip", registrationPoint: "center" },
            { name: "ball_mc", type: "graphic", registrationPoint: "center" },
        ]) {
            const wrapped = scoped(
                {
                    name: "convert_to_symbol",
                    run: async (input) => {
                        captured.push(input);
                        return { data };
                    },
                },
                "file:///tmp/disposable.fla",
                checkStatus,
            );
            await wrapped.run(
                {
                    document: "user.fla",
                    timeline: 0,
                    frame: 1,
                    elements: [{ layer: "ボール", element: 0 }],
                    name: "ball_mc",
                    type: "movie clip",
                },
                {},
                {},
            );
        }
        assert.deepEqual(
            captured.map(({ document }) => document),
            ["disposable.fla", "disposable.fla", "disposable.fla"],
        );
        const entries = (await readFile(tracePath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        assert.deepEqual(
            entries.map(({ targetTool, succeeded }) => [targetTool, succeeded]),
            [
                ["convert_to_symbol", true],
                ["convert_to_symbol", false],
                ["convert_to_symbol", false],
            ],
        );
        assert.ok(entries.every((entry) => !("input" in entry) && !("arguments" in entry)));
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("inspect_timeline is scoped, injects the disposable document, and traces success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-inspect-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const captured = [];
    const wrapped = scoped(
        {
            name: "inspect_timeline",
            run: async (input) => {
                captured.push(input);
                return { data: { frame: 12, layers: [] } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({ data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] } }),
    );
    try {
        await wrapped.run({ timeline: 0, frame: 12 }, {}, {});
        assert.deepEqual(captured, [{ timeline: 0, frame: 12, document: "disposable.fla" }]);
        const trace = await readFile(tracePath, "utf8");
        assertSuccessfulTimelineInspection(trace);
        assert.match(trace, /"targetTool":"inspect_timeline","succeeded":true/);
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("library scope permits only listUnused and records no tool inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-library-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.README_E2E_TRACE_PATH;
    process.env.README_E2E_TRACE_PATH = tracePath;
    const calls = [];
    const wrapped = scoped(
        {
            name: "edit_library",
            run: async (input) => {
                calls.push(input);
                return { data: { applied: input.ops, failed: null } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({ data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] } }),
    );
    try {
        await wrapped.run({ ops: [{ op: "listUnused" }] }, {}, {});
        await assert.rejects(
            wrapped.run({ ops: [{ op: "deleteItem", item: "used_mc", confirm: true }] }, {}, {}),
            /only the read-only listUnused operation/,
        );
        assert.equal(calls.length, 1);
        const trace = (await readFile(tracePath, "utf8")).trim().split("\n");
        assertSuccessfulLibraryListing(trace.join("\n"));
        assert.deepEqual(
            trace.map((line) => {
                const entry = JSON.parse(line);
                assert.equal("input" in entry, false);
                assert.equal("arguments" in entry, false);
                return [entry.targetTool, entry.succeeded];
            }),
            [
                ["edit_library", true],
                ["edit_library", false],
            ],
        );
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.README_E2E_TRACE_PATH;
        } else {
            process.env.README_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("get_document_info is scoped without an invented document selector", async () => {
    let args;
    let calls = 0;
    const tool = {
        name: "get_document_info",
        run: async (input) => {
            args = input;
            calls += 1;
            return { data: {} };
        },
    };
    const safe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    }));
    await safe.run({}, {}, {});
    assert.deepEqual(args, {});

    const unsafe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: {
            documents: [
                { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                { path: "file:///tmp/user.fla", name: "user.fla" },
            ],
        },
    }));
    await assert.rejects(unsafe.run({}, {}, {}), /only the disposable FLA open/);
    assert.equal(calls, 1);
});

test("stage metadata and successful set_document_properties trace are required", () => {
    assertStageProperties({ width: 1280, height: 720, frameRate: 30, backgroundColor: "#000000" });
    assert.throws(() => assertStageProperties({ width: 1280 }), /Stage height/);
    assert.throws(
        () => assertStageProperties({ width: 1280, height: 720, frameRate: 30, backgroundColor: "#ffffff" }),
        /background is not black/,
    );
    assertSuccessfulStageEdit('{"targetTool":"set_document_properties","succeeded":true}');
    assert.throws(
        () => assertSuccessfulStageEdit('{"targetTool":"set_document_properties","succeeded":false}'),
        /successfully call/,
    );
});

/** Confirms that export/apply wrappers ignore caller-selected targets. */
test("script export/apply pin paths, document, and force to disposable values", async () => {
    const captured = [];
    /** Returns the sole exact disposable document used by the scope wrapper.
     * @returns Status result.
     */
    const checkStatus = async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    });
    for (const [name, input, data] of [
        ["export_scripts", { dir: "/tmp/readme-e2e/export", force: false, document: "user.fla" }, { failed: [] }],
        [
            "apply_scripts",
            { dir: "/tmp/readme-e2e/export", document: "user.fla" },
            { failed: [], applied: ["scenes/Scene 1/as/1.as"] },
        ],
    ]) {
        const wrapped = scoped(
            {
                name,
                run: async (args) => {
                    captured.push(args);
                    return { data };
                },
            },
            "file:///tmp/disposable.fla",
            checkStatus,
            "/tmp/readme-e2e",
        );
        await wrapped.run(input, {}, {});
    }
    assert.equal(captured[0].document, "disposable.fla");
    assert.equal(captured[0].force, false);
    assert.match(captured[0].dir, /export$/);
    assert.equal(captured[1].document, "disposable.fla");
    assert.match(captured[1].dir, /export$/);
    const unsafe = scoped(
        { name: "export_scripts", run: async () => assert.fail("Unsafe export ran") },
        "file:///tmp/disposable.fla",
        checkStatus,
        "/tmp/readme-e2e",
    );
    await assert.rejects(unsafe.run({ dir: "/user/path", force: true }, {}, {}), /export dir is pinned/);
    const unsafeApply = scoped(
        { name: "apply_scripts", run: async () => assert.fail("Unsafe apply ran") },
        "file:///tmp/disposable.fla",
        checkStatus,
        "/tmp/readme-e2e",
    );
    await assert.rejects(unsafeApply.run({ dir: "/user/path" }, {}, {}), /apply dir must be/);
});

test("Claude preapproves only the MCP entrances", () => {
    const args = claudeArgs("/tmp/mcp.json", selectedScenario("publish").prompt);
    const allowedIndex = args.indexOf("--allowedTools");
    assert.deepEqual(args.slice(allowedIndex + 1, allowedIndex + 4), [
        "mcp__animate-readme-e2e__search_tools",
        "mcp__animate-readme-e2e__execute_readonly",
        "mcp__animate-readme-e2e__execute_write",
    ]);
    assert.ok(args.includes("--restricted"));
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
});

test("successful trace requires a successful edit_timeline call", () => {
    assertSuccessfulEdit('{"targetTool":"edit_timeline","succeeded":true}');
    assert.throws(() => assertSuccessfulEdit('{"targetTool":"edit_timeline","succeeded":false}'), /successfully call/);
});

test("fake Claude failures expose only bounded byte counts, not CLI output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-prompt-fake-claude-"));
    const executable = join(directory, "claude");
    await writeFile(
        executable,
        '#!/bin/sh\nprintf "private stdout marker"\nprintf "private stderr marker" >&2\nexit 7\n',
    );
    await chmod(executable, 0o755);
    try {
        await assert.rejects(
            runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
            }),
            (error) => {
                assert.match(error.message, /exit=7/);
                assert.doesNotMatch(error.message, /private .* marker/);
                return true;
            },
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Claude JSON failures report safe categories without result or session content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-prompt-json-failure-"));
    const executable = join(directory, "claude");
    await writeFile(
        executable,
        '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":6,"error":{"type":"permission_denied","message":"private workspace path"},"result":"private prompt content","session_id":"private-session"}\'\nexit 1\n',
    );
    await chmod(executable, 0o755);
    try {
        await assert.rejects(
            runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
                scenario: selectedScenario("publish"),
            }),
            (error) => {
                assert.match(error.message, /subtype=error_max_turns/);
                assert.match(error.message, /error_type=permission_denied/);
                assert.match(error.message, /is_error=true/);
                assert.match(error.message, /num_turns=6/);
                assert.doesNotMatch(error.message, /private workspace path|private prompt content|private-session/);
                return true;
            },
        );
        for (const [result, category] of [
            ["Rate limit exceeded for private workspace /private/workspace/hero.fla", "usage_rate_limit"],
            ["Authentication failed for private user /private/workspace", "auth"],
            ["Billing payment required for private account", "billing"],
            ["Requested model unavailable in private workspace", "model_unavailable"],
            ["MCP tool execution failed for private document", "tool_error"],
            ["Internal failure in private workspace /private/workspace", "other"],
        ]) {
            const payload = JSON.stringify({
                type: "result",
                subtype: "success",
                stop_reason: "stop_sequence",
                is_error: true,
                num_turns: 1,
                permission_denials: [],
                result,
            });
            await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${payload}'\nexit 1\n`);
            await chmod(executable, 0o755);
            await assert.rejects(
                runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
                    scenario: selectedScenario("publish"),
                }),
                (error) => {
                    assert.match(error.message, new RegExp(`result_category=${category}`));
                    assert.doesNotMatch(
                        error.message,
                        /private workspace|private user|private account|private document/,
                    );
                    return true;
                },
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("read-only, capture, publish, and Canvas Claude runs return parsed final results for in-memory validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-prompt-inspect-claude-"));
    const executable = join(directory, "claude");
    await writeFile(executable, '#!/bin/sh\nprintf \'{"result":"hero has a motion tween","is_error":false}\\n\'\n');
    await chmod(executable, 0o755);
    try {
        const result = await runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
            env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
            scenario: selectedScenario("inspect"),
        });
        assert.equal(result, "hero has a motion tween");
        const captureResult = await runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
            env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
            scenario: selectedScenario("capture"),
        });
        assert.equal(captureResult, "hero has a motion tween");
        const publishResult = await runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
            env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
            scenario: selectedScenario("publish"),
        });
        assert.equal(publishResult, "hero has a motion tween");
        const canvasResult = await runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
            env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
            scenario: selectedScenario("canvas"),
        });
        assert.equal(canvasResult, "hero has a motion tween");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Claude timeout waits for the fake process group to close", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-prompt-timeout-"));
    const executable = join(directory, "claude");
    await writeFile(executable, "#!/bin/sh\nsleep 30\n");
    await chmod(executable, 0o755);
    try {
        await assert.rejects(
            runClaude("/tmp/mcp.json", "/tmp/trace.jsonl", "file:///tmp/disposable.fla", {
                env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
                timeoutMs: 25,
            }),
            /timed out; CLI exited/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("restricted MCP discovery omits run_jsfl and document operations", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: { ...process.env, README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla" },
    });
    const client = new Client({ name: "readme-e2e-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["run_jsfl", "open_document", "save_document"]) {
            const result = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("stage MCP discovery exposes only its three tools", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "stage",
        },
    });
    const client = new Client({ name: "readme-e2e-stage-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        const result = await client.callTool({
            name: "execute_write",
            arguments: { name: "edit_timeline", arguments: {} },
        });
        assert.equal(result.isError, true);
    } finally {
        await client.close();
    }
});

test("script MCP discovery exposes only scoped script workflow tools", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-e2e",
            README_PROMPT_E2E_SCENARIO: "script",
        },
    });
    const client = new Client({ name: "readme-e2e-script-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const [name, expected] of [
            ["read_export_file", /Relative file inside the disposable export/],
            ["write_export_script", /Exact relative frame-one AS3 script path/],
        ]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.match(definition.inputSchema.properties.file.description, expected);
        }
        for (const name of ["run_jsfl", "edit_timeline", "read_file"]) {
            const result = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("investigation MCP discovery exposes only get_status, export_scripts, and read_export_file", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-e2e",
            README_PROMPT_E2E_SCENARIO: "investigate",
        },
    });
    const client = new Client({ name: "readme-e2e-investigate-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "export_scripts", "read_export_file"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "read_export_file") {
                assert.match(definition.inputSchema.properties.file.description, /metadata path/);
            }
        }
        for (const name of ["write_export_script", "apply_scripts", "read_file", "write_file", "run_jsfl"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("capture MCP discovery exposes only get_status and capture_frame", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-e2e",
            README_PROMPT_E2E_SCENARIO: "capture",
        },
    });
    const client = new Client({ name: "readme-e2e-capture-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        for (const name of ["get_status", "capture_frame"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        for (const name of ["run_jsfl", "open_document", "save_document", "inspect_timeline"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
        const capture = await client.callTool({ name: "search_tools", arguments: { query: "capture_frame" } });
        const schema = JSON.parse(capture.content[0].text).inputSchema;
        assert.ok(schema.properties.frame);
        assert.ok(schema.properties.range);
        assert.ok(schema.properties.dir);
    } finally {
        await client.close();
    }
});

test("publish MCP discovery exposes only get_status and publish with its document schema", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-publish-e2e",
            README_PROMPT_E2E_SCENARIO: "publish",
        },
    });
    const client = new Client({ name: "readme-e2e-publish-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "publish"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "publish") {
                assert.ok(definition.inputSchema.properties.document);
            }
        }
        for (const name of ["run_jsfl", "open_document", "save_document", "export_scripts", "read_file"]) {
            const found = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(found.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("testmovie MCP discovery exposes only get_status and test_movie without run_jsfl", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "testmovie",
        },
    });
    const client = new Client({ name: "readme-e2e-testmovie-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "test_movie"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "test_movie") {
                assert.ok(definition.inputSchema.properties.document);
            }
        }
        for (const name of ["run_jsfl", "publish", "open_document", "save_document"]) {
            const found = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(found.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("Canvas MCP discovery exposes only get_status and verify_canvas_output without run_jsfl", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-canvas-e2e",
            README_PROMPT_E2E_SCENARIO: "canvas",
        },
    });
    const client = new Client({ name: "readme-e2e-canvas-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "verify_canvas_output"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "verify_canvas_output") {
                assert.ok(definition.inputSchema.properties.document);
                assert.ok(definition.inputSchema.properties.publish);
                assert.ok(definition.inputSchema.properties.htmlPath);
                assert.ok(definition.inputSchema.properties.observeMs);
            }
        }
        for (const name of ["run_jsfl", "publish", "open_document", "save_document"]) {
            const found = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(found.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("assets MCP discovery exposes only get_status and import_assets", async () => {
    const outDir = "/tmp/disposable-assets-e2e";
    const assetPaths = [join(outDir, "hero.png"), join(outDir, "bgm.mp3")];
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: outDir,
            README_E2E_ASSET_PATHS: JSON.stringify(assetPaths),
            README_PROMPT_E2E_SCENARIO: "assets",
        },
    });
    const client = new Client({ name: "readme-e2e-assets-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "import_assets"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        const result = await client.callTool({ name: "search_tools", arguments: { query: "import_assets" } });
        const schema = JSON.parse(result.content[0].text).inputSchema;
        assert.ok(schema.properties.paths);
        assert.ok(schema.properties.document);
        for (const name of ["run_jsfl", "open_document", "save_document"]) {
            const found = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(found.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("text MCP discovery exposes only get_status, inspect_timeline, and edit_text", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "text",
        },
    });
    const client = new Client({ name: "readme-e2e-text-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "inspect_timeline", "edit_text"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        for (const name of ["run_jsfl", "export_scripts", "edit_timeline"]) {
            const result = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("instance MCP discovery exposes only get_status, inspect_timeline, and edit_elements", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "instance",
        },
    });
    const client = new Client({ name: "readme-e2e-instance-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "inspect_timeline", "edit_elements"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        for (const name of ["run_jsfl", "edit_timeline", "edit_tween", "edit_text"]) {
            const result = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("symbol MCP discovery exposes only get_status, inspect_timeline, and convert_to_symbol", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "symbol",
        },
    });
    const client = new Client({ name: "readme-e2e-symbol-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "inspect_timeline", "convert_to_symbol"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        const result = await client.callTool({
            name: "search_tools",
            arguments: { query: "convert_to_symbol" },
        });
        const schema = JSON.parse(result.content[0].text).inputSchema;
        assert.deepEqual(schema.required.sort(), [
            "elements",
            "frame",
            "name",
            "registrationPoint",
            "timeline",
            "type",
        ]);
        assert.deepEqual(schema.properties.type.enum, ["movie clip", "button", "graphic"]);
        assert.ok(schema.properties.elements.items.properties.layer);
        assert.ok(schema.properties.elements.items.properties.element);
        assert.equal(schema.properties.registrationPoint.default, "center");
        for (const name of ["run_jsfl", "edit_timeline", "edit_tween", "edit_elements", "edit_text"]) {
            const denied = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("inspect MCP discovery exposes only get_status and inspect_timeline", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "inspect",
        },
    });
    const client = new Client({ name: "readme-e2e-inspect-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "inspect_timeline"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        for (const name of ["run_jsfl", "edit_timeline", "edit_tween", "edit_elements", "edit_text"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
        }
        const write = await client.callTool({
            name: "execute_write",
            arguments: { name: "edit_tween", arguments: {} },
        });
        assert.equal(write.isError, true);
    } finally {
        await client.close();
    }
});

test("library MCP discovery exposes only get_status and edit_library", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "library",
        },
    });
    const client = new Client({ name: "readme-e2e-library-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "edit_library"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "edit_library") {
                assert.equal(definition.annotations.readOnlyHint, false);
                assert.ok(definition.inputSchema.properties.ops);
                assert.match(definition.description, /list unused items/);
            }
        }
        for (const name of ["run_jsfl", "edit_timeline", "edit_elements", "save_document"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
        }
        const readOnly = await client.callTool({
            name: "execute_readonly",
            arguments: { name: "edit_library", arguments: { ops: [{ op: "listUnused" }] } },
        });
        assert.equal(readOnly.isError, true);
    } finally {
        await client.close();
    }
});

test("tween MCP discovery exposes only get_status, inspect_timeline, and edit_tween", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./readme-prompt-e2e.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_PROMPT_E2E_SCENARIO: "tween",
        },
    });
    const client = new Client({ name: "readme-e2e-tween-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "inspect_timeline", "edit_tween"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        for (const name of ["run_jsfl", "edit_timeline", "edit_text"]) {
            const result = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});
