import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { scoped } from "../lib/mcp-server.mjs";
import {
    assertBackground24,
    assertBallInstance,
    assertBallSymbol,
    assertGameOverText,
    assertInspectDocumentUnchanged,
    assertInstanceInDocument,
    assertStageProperties,
    assertSuccessfulEdit,
    assertSuccessfulInstanceEdit,
    assertSuccessfulStageEdit,
    assertSuccessfulSymbolConversion,
    assertSuccessfulTextEdit,
    assertSuccessfulTimelineInspection,
    assertSuccessfulTweenEdit,
    assertTimelineInspectionReply,
    assertTweenReadback,
} from "../scenarios/timeline.mjs";

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

test("edit_tween trace succeeds only when edits were applied with no failed operations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-tween-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.PROMPT_E2E_TRACE_PATH;
    process.env.PROMPT_E2E_TRACE_PATH = tracePath;
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
            delete process.env.PROMPT_E2E_TRACE_PATH;
        } else {
            process.env.PROMPT_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("convert_to_symbol is scoped and traces the requested movie-clip result without inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-symbol-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.PROMPT_E2E_TRACE_PATH;
    process.env.PROMPT_E2E_TRACE_PATH = tracePath;
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
            delete process.env.PROMPT_E2E_TRACE_PATH;
        } else {
            process.env.PROMPT_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("inspect_timeline is scoped, injects the disposable document, and traces success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-inspect-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.PROMPT_E2E_TRACE_PATH;
    process.env.PROMPT_E2E_TRACE_PATH = tracePath;
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
            delete process.env.PROMPT_E2E_TRACE_PATH;
        } else {
            process.env.PROMPT_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
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

test("successful trace requires a successful edit_timeline call", () => {
    assertSuccessfulEdit('{"targetTool":"edit_timeline","succeeded":true}');
    assert.throws(() => assertSuccessfulEdit('{"targetTool":"edit_timeline","succeeded":false}'), /successfully call/);
});

test("stage MCP discovery exposes only its three tools", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "stage",
        },
    });
    const client = new Client({ name: "prompt-e2e-stage-test", version: "1.0.0" });
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

test("text MCP discovery exposes only get_status, inspect_timeline, and edit_text", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "text",
        },
    });
    const client = new Client({ name: "prompt-e2e-text-test", version: "1.0.0" });
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
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "instance",
        },
    });
    const client = new Client({ name: "prompt-e2e-instance-test", version: "1.0.0" });
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
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "symbol",
        },
    });
    const client = new Client({ name: "prompt-e2e-symbol-test", version: "1.0.0" });
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
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "inspect",
        },
    });
    const client = new Client({ name: "prompt-e2e-inspect-test", version: "1.0.0" });
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

test("tween MCP discovery exposes only get_status, inspect_timeline, and edit_tween", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "tween",
        },
    });
    const client = new Client({ name: "prompt-e2e-tween-test", version: "1.0.0" });
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
