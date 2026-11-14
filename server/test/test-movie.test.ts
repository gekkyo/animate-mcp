import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

test("test_movie runs AS3 Test Movie and returns the Output delta and compiler diagnostics", {
    timeout: 30_000,
}, async () => {
    const compilerErrorsPanel =
        "**Warning** Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7\tWarning: 1098: Illogical comparison.\n\n0 Error(s), 1 Warning(s)";
    await withServer(
        {
            FAKE_TWO: "1",
            FAKE_OUTPUT_PANEL: "previous trace",
            FAKE_TEST_MOVIE_OUTPUT: "TypeError: #1009",
            FAKE_COMPILER_PANELS: JSON.stringify({
                "a.fla": "**Error** wrong active document\n\n1 Error(s), 0 Warning(s)",
                "b.fla": compilerErrorsPanel,
            }),
        },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "test_movie", arguments: { document: "b.fla" } });
            const expected = {
                runtimeOutput: "\nTypeError: #1009",
                compilerErrorsPanel,
                compilerDiagnostics: {
                    status: "parsed",
                    errors: [],
                    warnings: [
                        {
                            location: "Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7",
                            line: 3,
                            column: 7,
                            code: "1098",
                            message: "Illogical comparison.",
                        },
                    ],
                },
                note: "Runtime output is a single snapshot taken two seconds after Test Movie starts; later output may be missed, concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
            };
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, expected);
            assert.equal(text(result), JSON.stringify(expected));
            assert.deepEqual((await readFile(join(tempDir, "log.test-movie"), "utf8")).trim().split("\n"), [
                '{"document":"b.fla","abortOnErrors":true,"playerOpened":true}',
            ]);
            assert.equal(await readFile(join(tempDir, "log.active-document"), "utf8"), "b.fla");
            const panelLog = (await readFile(join(tempDir, "log.read-output"), "utf8")).trim().split("\n");
            assert.equal(panelLog.filter((entry) => entry === "outputPanel.save").length, 2);
            assert.equal(panelLog.filter((entry) => entry === "compilerErrors.save").length, 2);
            assert.deepEqual((await readFile(join(tempDir, "log"), "utf8")).trim().split("\n"), [
                "start",
                "end",
                "start",
                "end",
                "start",
                "end",
            ]);
            assert.equal(await readFile(join(tempDir, "log.output-panel"), "utf8"), "previous trace\nTypeError: #1009");
            assert.deepEqual((await readFile(join(tempDir, "log.publish"), "utf8")).trim().split("\n"), ["activate"]);
        },
    );
});

test("test_movie returns compiler errors with an empty runtime delta when compilation prevents launch", {
    timeout: 30_000,
}, async () => {
    const compilerErrorsPanel =
        "**Error** Scene 1, Layer 'Layer_1', Frame 1\t1084: Syntax error\n\n1 Error(s), 0 Warning(s)";
    await withServer(
        {
            FAKE_TEST_MOVIE_COMPILE_ERROR: "1",
            FAKE_COMPILER_PANEL: compilerErrorsPanel,
        },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "test_movie", arguments: {} });
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, {
                runtimeOutput: "",
                compilerErrorsPanel,
                compilerDiagnostics: {
                    status: "parsed",
                    errors: [
                        {
                            location: "Scene 1, Layer 'Layer_1', Frame 1",
                            code: "1084",
                            message: "Syntax error",
                        },
                    ],
                    warnings: [],
                },
                note: "Runtime output is a single snapshot taken two seconds after Test Movie starts; later output may be missed, concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
            });
            assert.deepEqual((await readFile(join(tempDir, "log.test-movie"), "utf8")).trim().split("\n"), [
                '{"document":"a.fla","abortOnErrors":true,"playerOpened":false}',
            ]);
            assert.equal(
                (await readFile(join(tempDir, "log.read-output"), "utf8")).match(/outputPanel\.save/g)?.length,
                2,
            );
        },
    );
});

test("test_movie rejects unsupported, AS2, and unsaved documents before reading panels or launching", {
    timeout: 30_000,
}, async () => {
    for (const [env, message] of [
        [{ FAKE_TYPE: "htmlcanvas" }, /AS3/],
        [{ FAKE_AS_VERSION: "AS2" }, /AS3/],
        [{ FAKE_UNSAVED: "1" }, /save first/],
    ] as const) {
        await withServer(env, async (client, tempDir) => {
            const result = await client.callTool({ name: "test_movie", arguments: {} });
            assert.equal(result.isError, true);
            assert.match(text(result), message);
            await assert.rejects(readFile(join(tempDir, "log.test-movie"), "utf8"), { code: "ENOENT" });
            await assert.rejects(readFile(join(tempDir, "log.read-output"), "utf8"), { code: "ENOENT" });
        });
    }
});
