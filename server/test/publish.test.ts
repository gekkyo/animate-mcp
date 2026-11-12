import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parseCompilerOutput } from "../src/tools/publish.js";
import { text, withServer } from "./helpers/fake-animate.js";

test("compiler output parser handles Japanese and English diagnostics, duplicates and clean summaries", () => {
    const syntax = parseCompilerOutput(
        "**Error** シーン 1, レイヤー 'レイヤー_1', フレーム 1\t1084: 構文エラー\n\n1 個のエラー, 0 個の警告",
    );
    assert.deepEqual(syntax, {
        errors: [
            {
                location: "シーン 1, レイヤー 'レイヤー_1', フレーム 1",
                code: "1084",
                message: "構文エラー",
            },
        ],
        warnings: [],
    });

    const japanese = parseCompilerOutput(
        [
            "**Error** シーン 1, レイヤー 'レイヤー_1', フレーム 1、行 2、列 5\t1172: 定義 foo:Bar が見つかりません。",
            "**Error** シーン 1, レイヤー 'レイヤー_1', フレーム 1、行 2、列 17\t1046: 型が見つかりません。",
            "**Error** シーン 1, レイヤー 'レイヤー_1', フレーム 1、行 2、列 5\t1172: 定義 foo:Bar が見つかりません。",
            "2 個のエラー, 0 個の警告",
        ].join("\n"),
    );
    assert.deepEqual(
        japanese.errors.map(({ code, line, column }) => ({ code, line, column })),
        [
            { code: "1172", line: 2, column: 5 },
            { code: "1046", line: 2, column: 17 },
        ],
    );

    const english = parseCompilerOutput(
        [
            "**Error** Scene 1, Layer 'Layer_1', Frame 1, Line 2, Column 5\t1172: Definition foo:Bar could not be found.",
            "**Error** Scene 1, Layer 'Layer_1', Frame 1, Line 2, Column 17\t1180: Call to a possibly undefined method.",
            "2 Error(s), 0 Warning(s)",
        ].join("\n"),
    );
    assert.deepEqual(
        english.errors.map(({ code, line, column }) => ({ code, line, column })),
        [
            { code: "1172", line: 2, column: 5 },
            { code: "1180", line: 2, column: 17 },
        ],
    );
    assert.deepEqual(parseCompilerOutput("0 個のエラー, 0 個の警告"), { errors: [], warnings: [] });
    assert.deepEqual(parseCompilerOutput("0 Error(s), 0 Warning(s)"), { errors: [], warnings: [] });
    assert.throws(() => parseCompilerOutput("**Error** incomplete output"), /retry publish/);
});

test("publish activates then publishes in separate Runs and returns compile errors normally", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_COMPILER_OUTPUT:
                "**Error** Scene 1, Layer 'Layer_1', Frame 1\t1084: Syntax error\n\n1 Error(s), 0 Warning(s)",
        },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "publish", arguments: { document: "a.fla" } });
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, {
                ok: false,
                errors: [
                    {
                        location: "Scene 1, Layer 'Layer_1', Frame 1",
                        code: "1084",
                        message: "Syntax error",
                    },
                ],
                warnings: [],
            });
            assert.deepEqual((await readFile(join(tempDir, "log.publish"), "utf8")).trim().split("\n"), [
                "activate",
                "publish",
                "compilerErrors.save",
                "remove",
            ]);
            assert.equal((await readFile(join(tempDir, "log"), "utf8")).match(/^start$/gm)?.length, 2);
        },
    );
});

test("publish refuses unsaved documents before publishing", { timeout: 20_000 }, async () => {
    await withServer({ FAKE_UNSAVED: "1" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "publish", arguments: {} });
        assert.equal(result.isError, true);
        assert.match(text(result), /save first/);
        assert.equal((await readFile(join(tempDir, "log"), "utf8")).match(/^start$/gm)?.length, 1);
        await assert.rejects(readFile(join(tempDir, "log.publish"), "utf8"), { code: "ENOENT" });
    });
});

test("publish reports HTML5 Canvas as not supported yet", { timeout: 20_000 }, async () => {
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "publish", arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(text(result), "HTML5 Canvas is not supported yet");
        assert.equal((await readFile(join(tempDir, "log"), "utf8")).match(/^start$/gm)?.length, 1);
        await assert.rejects(readFile(join(tempDir, "log.publish"), "utf8"), { code: "ENOENT" });
    });
});
