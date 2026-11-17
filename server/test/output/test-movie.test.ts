import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { testMovieTool } from "../../src/tools/output/test-movie.js";
import { invokeToolDefinition, type ToolDeps, type ToolExtra } from "../../src/tools/shared.js";
import { text, withServer } from "../helpers/fake-animate.js";

/** Encodes the Output and Compiler Errors panel fields used by read-output.jsfl.
 * @param output Output-panel text.
 * @param compiler Compiler Errors panel text.
 * @returns Length-prefixed panel snapshot.
 */
function encodePanelSnapshot(output: string, compiler = "0 Error(s), 0 Warning(s)") {
    return `1${output.length}:${output}${compiler.length}:${compiler}`;
}

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
                note: "Output polling starts two seconds after Test Movie starts and repeats every 500 ms until non-empty output is unchanged across two consecutive reads, stopping by six seconds after launch. If still empty, a final Output-panel snapshot follows a two-second Player startup grace. Polling stops after the first snapshot if compilation errors prevent launch. Concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
            };
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, expected);
            assert.equal(text(result), JSON.stringify(expected));
            assert.deepEqual((await readFile(join(tempDir, "log.test-movie"), "utf8")).trim().split("\n"), [
                '{"document":"b.fla","abortOnErrors":true,"playerOpened":true}',
            ]);
            assert.equal(await readFile(join(tempDir, "log.active-document"), "utf8"), "b.fla");
            const panelLog = (await readFile(join(tempDir, "log.read-output"), "utf8")).trim().split("\n");
            assert.equal(panelLog.filter((entry) => entry === "outputPanel.save").length, 3);
            assert.equal(panelLog.filter((entry) => entry === "compilerErrors.save").length, 3);
            assert.deepEqual((await readFile(join(tempDir, "log"), "utf8")).trim().split("\n"), [
                "start",
                "end",
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

test("test_movie returns a marker that appears on a later poll and uses the last compiler snapshot", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    const previousOutput = "previous trace";
    const markerOutput = `${previousOutput}\nREADME_TEST_MOVIE_OK`;
    const finalCompiler =
        "**Warning** Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7\tWarning: 1098: Late panel warning.\n\n0 Error(s), 1 Warning(s)";
    const snapshotTimes: number[] = [];
    let executions = 0;
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                const call = executions++;
                if (call === 0) {
                    return "Flash";
                }
                if (call === 1) {
                    return `${Date.now()}|${encodePanelSnapshot(previousOutput)}`;
                }
                snapshotTimes.push(Date.now());
                return encodePanelSnapshot(
                    Date.now() < 3_500 ? previousOutput : markerOutput,
                    Date.now() < 4_000 ? "0 Error(s), 0 Warning(s)" : finalCompiler,
                );
            },
        },
        bundle: (...names) => names.join("\n"),
    };
    let settled = false;
    const pending = invokeToolDefinition(testMovieTool, { document: "b.fla" }, deps, {} as ToolExtra).finally(() => {
        settled = true;
    });
    for (let turn = 0; turn < 100 && !settled; turn++) {
        await Promise.resolve();
        t.mock.timers.runAll();
    }
    assert.equal(settled, true, "mock timers did not settle test_movie polling");
    const result = await pending;
    assert.deepEqual(snapshotTimes, [3_000, 3_500, 4_000]);
    assert.equal(result.structuredContent?.runtimeOutput, "\nREADME_TEST_MOVIE_OK");
    assert.equal(result.structuredContent?.compilerErrorsPanel, finalCompiler);
    assert.deepEqual(result.structuredContent?.compilerDiagnostics, {
        status: "parsed",
        errors: [],
        warnings: [
            {
                location: "Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7",
                line: 3,
                column: 7,
                code: "1098",
                message: "Late panel warning.",
            },
        ],
    });
});

test("test_movie returns the full output when the Output panel prefix changes", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    let executions = 0;
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                const call = executions++;
                if (call === 0) {
                    return "Flash";
                }
                if (call === 1) {
                    return `${Date.now()}|${encodePanelSnapshot("old panel")}`;
                }
                return encodePanelSnapshot("new panel output");
            },
        },
        bundle: (...names) => names.join("\n"),
    };
    let settled = false;
    const pending = invokeToolDefinition(testMovieTool, { document: "b.fla" }, deps, {} as ToolExtra).finally(() => {
        settled = true;
    });
    for (let turn = 0; turn < 100 && !settled; turn++) {
        await Promise.resolve();
        t.mock.timers.runAll();
    }
    assert.equal(settled, true, "mock timers did not settle test_movie polling after a panel reset");
    assert.equal((await pending).structuredContent?.runtimeOutput, "new panel output");
});

test("test_movie returns an empty runtime delta after the poll cap and final grace snapshot", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    const previousOutput = "previous trace";
    const snapshotTimes: number[] = [];
    let executions = 0;
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                const call = executions++;
                if (call === 0) {
                    return "Flash";
                }
                if (call === 1) {
                    return `${Date.now()}|${encodePanelSnapshot(previousOutput)}`;
                }
                snapshotTimes.push(Date.now());
                return encodePanelSnapshot(previousOutput);
            },
        },
        bundle: (...names) => names.join("\n"),
    };
    let settled = false;
    const pending = invokeToolDefinition(testMovieTool, { document: "b.fla" }, deps, {} as ToolExtra).finally(() => {
        settled = true;
    });
    for (let turn = 0; turn < 100 && !settled; turn++) {
        await Promise.resolve();
        t.mock.timers.runAll();
    }
    assert.equal(settled, true, "mock timers did not settle test_movie polling at the cap");
    const result = await pending;
    assert.equal(snapshotTimes[0], 3_000);
    assert.equal(snapshotTimes.at(-1), 9_000);
    assert.equal(snapshotTimes.length, 10);
    assert.equal(result.structuredContent?.runtimeOutput, "");
});

test("test_movie recovers output arriving during the final Player startup grace", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    const previousOutput = "previous trace";
    const markerOutput = `${previousOutput}\nREADME_TEST_MOVIE_OK`;
    let executions = 0;
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                const call = executions++;
                if (call === 0) {
                    return "Flash";
                }
                if (call === 1) {
                    return `${Date.now()}|${encodePanelSnapshot(previousOutput)}`;
                }
                return encodePanelSnapshot(Date.now() >= 9_000 ? markerOutput : previousOutput);
            },
        },
        bundle: (...names) => names.join("\n"),
    };
    let settled = false;
    const pending = invokeToolDefinition(testMovieTool, { document: "b.fla" }, deps, {} as ToolExtra).finally(() => {
        settled = true;
    });
    for (let turn = 0; turn < 100 && !settled; turn++) {
        await Promise.resolve();
        t.mock.timers.runAll();
    }
    assert.equal(settled, true, "mock timers did not settle final Player startup grace");
    const result = await pending;
    assert.equal(result.structuredContent?.runtimeOutput, "\nREADME_TEST_MOVIE_OK");
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
                note: "Output polling starts two seconds after Test Movie starts and repeats every 500 ms until non-empty output is unchanged across two consecutive reads, stopping by six seconds after launch. If still empty, a final Output-panel snapshot follows a two-second Player startup grace. Polling stops after the first snapshot if compilation errors prevent launch. Concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
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
