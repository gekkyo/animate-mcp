import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PNG } from "pngjs";
import { scoped } from "./mcp-server.mjs";
import {
    assertCanvasFrameScriptUnchanged,
    assertCanvasReply,
    assertCaptureDocumentUnchanged,
    assertCaptureEvidence,
    assertCaptureFixture,
    assertCaptureReply,
    assertPublishReply,
    assertSuccessfulCanvas,
    assertSuccessfulCapture,
    assertSuccessfulPublish,
    assertSuccessfulTestMovie,
    assertTestMovieReply,
    assertTestMovieScriptUnchanged,
    closeTestMoviePlayer,
    readCaptureFixture,
} from "./output.mjs";

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

test("capture MCP discovery exposes only get_status and capture_frame", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
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
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
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
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
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
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
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
