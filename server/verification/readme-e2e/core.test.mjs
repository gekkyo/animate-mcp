import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { claudeArgs, runClaude } from "./claude.mjs";
import { scoped } from "./mcp-server.mjs";
import {
    scenarioIsReadOnly,
    scenarioMessage,
    scenarioNeedsPlayerCleanup,
    scenarioRequiresChrome,
} from "./scenario-lifecycle.mjs";
import { prompt, scenarios, selectedScenario } from "./scenarios.mjs";

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

test("all 15 scenario names have a grouped lifecycle and only the intended special gates", () => {
    assert.equal(Object.keys(scenarios).length, 15);
    for (const name of Object.keys(scenarios)) {
        assert.ok(scenarioMessage(name), `${name} has no completion message`);
        assert.equal(scenarioRequiresChrome(name), name === "canvas");
        assert.equal(scenarioNeedsPlayerCleanup(name), name === "testmovie");
        assert.equal(scenarioIsReadOnly(name), name === "inspect" || name === "library");
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
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
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
