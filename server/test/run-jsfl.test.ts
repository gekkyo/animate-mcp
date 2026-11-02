import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 偽の Animate: 最小の FLfile/fl スタブで Run file を実行する。
// HANG を含むコードには応答せず、FAKE_LOG に起動の開始/終了を記録する。
const fakeAnimate = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const src = readFileSync(process.argv[2], "utf8");
const log = (m) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, m + "\\n");
log("start");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
if (!src.includes("HANG")) runInNewContext(src, {
  FLfile: { platformPathToURI: (p) => p, write: (p, t) => writeFileSync(p, t) },
  fl: { trace() {}, getDocumentDOM: () => process.env.FAKE_NO_DOC ? null :
    { name: "a.fla", width: 550, height: 400, frameRate: 24, timelines: [{ name: "Scene 1" }] } },
});
log("end");
`;

/**
 * env 付きで Server を stdio 起動し、MCP クライアントを fn に渡して終了後に閉じる。
 * @param env Server に追加で渡す環境変数
 * @param fn テスト本体。引数は MCP クライアント、一時ディレクトリ、Runs ディレクトリ
 * @returns fn の完了で resolve する Promise<void>
 */
async function withServer(
    env: Record<string, string>,
    fn: (client: Client, dir: string, runsDir: string) => Promise<void>,
) {
    const dir = await mkdtemp(join(tmpdir(), "animate-mcp-test-"));
    const launcher = join(dir, "fake-animate.cjs");
    await writeFile(launcher, fakeAnimate);
    await chmod(launcher, 0o755);
    const runsDir = join(dir, "runs");
    const client = new Client({ name: "animate-mcp-test", version: "0.1.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "server/src/index.ts"],
        cwd: resolve("."),
        env: {
            ...process.env,
            ANIMATE_MCP_LAUNCH_COMMAND: launcher,
            ANIMATE_MCP_RUNS_DIR: runsDir,
            // テストプロセス自身を「Animate 起動中」とみなす
            ANIMATE_MCP_PROCESS_PATTERN: "node",
            FAKE_LOG: join(dir, "log"),
            ...env,
        },
    });
    try {
        await client.connect(transport);
        await fn(client, dir, runsDir);
    } finally {
        await client.close();
        await rm(dir, { recursive: true, force: true });
    }
}

const text = (r: { content?: unknown }) => (r.content as Array<{ text: string }>)[0]?.text ?? "";

test("run_jsfl success, JSFL error, cleanup", { timeout: 20_000 }, () =>
    withServer({}, async (client, _dir, runsDir) => {
        const tools = await client.listTools();
        const runJsfl = tools.tools.find((tool) => tool.name === "run_jsfl");
        assert.match(runJsfl?.description ?? "", /arbitrary code/i);

        const success = await client.callTool({ name: "run_jsfl", arguments: { code: "1 + 2" } });
        assert.deepEqual(success.structuredContent, { result: 3 });

        const failure = await client.callTool({
            name: "run_jsfl",
            arguments: { code: "throw new Error('JSFL exploded');" },
        });
        assert.equal(failure.isError, true);
        assert.equal(text(failure), "JSFL exploded");

        assert.deepEqual(await readdir(runsDir), [], "Run and Result files are removed");
    }),
);

test("hung Run times out and cleans up", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_TIMEOUT_MS: "500" }, async (client, _dir, runsDir) => {
        const r = await client.callTool({ name: "run_jsfl", arguments: { code: "/* HANG */ 1" } });
        assert.equal(r.isError, true);
        assert.match(text(r), /timed out/i);
        assert.deepEqual(await readdir(runsDir), []);
    }),
);

test("hung launcher times out; special values survive", { timeout: 20_000 }, async () => {
    await withServer(
        { ANIMATE_MCP_LAUNCH_COMMAND: "/bin/sleep", ANIMATE_MCP_TIMEOUT_MS: "500" },
        async (client, _dir, runsDir) => {
            const r = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
            assert.equal(r.isError, true);
            assert.match(text(r), /timed out|Launcher exited/i);
            assert.deepEqual(await readdir(runsDir), []);
        },
    );
    await withServer({}, async (client) => {
        const r = await client.callTool({ name: "run_jsfl", arguments: { code: "'a\\tb\\n\"c\"'" } });
        assert.deepEqual(r.structuredContent, { result: 'a\tb\n"c"' });
    });
});

test("Animate not running is a clear error and nothing is launched", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_PROCESS_PATTERN: "no-such-process-xyzzy" }, async (client, dir) => {
        const r = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        assert.equal(r.isError, true);
        assert.match(text(r), /Animate not running/);
        await assert.rejects(readFile(join(dir, "log"), "utf8"), { code: "ENOENT" });
    }),
);

test("concurrent Runs are serialized", { timeout: 20_000 }, () =>
    withServer({}, async (client, dir) => {
        await Promise.all([1, 2, 3].map((n) => client.callTool({ name: "run_jsfl", arguments: { code: String(n) } })));
        assert.equal(
            (await readFile(join(dir, "log"), "utf8")).trim().split("\n").join(","),
            "start,end,start,end,start,end",
        );
    }),
);

test("get_document_info returns info, or a clear error with no document", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const r = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(r.isError, undefined, text(r));
        assert.deepEqual(r.structuredContent, {
            name: "a.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            timelines: ["Scene 1"],
        });
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client) => {
        const r = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(r.isError, true);
        assert.equal(text(r), "No document open");
    });
});
