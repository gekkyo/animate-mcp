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
const lib = { name: "Hero", itemType: "movie clip" };
const kf = (startFrame, duration, extra) => Object.assign({ startFrame, duration, name: "", tweenType: "none", actionScript: "", elements: [] }, extra);
// 実 Animate と同じく layer.frames は 1 フレームごとに 1 要素（キーフレームの frame を duration 回並べる）
const expand = (kfs) => kfs.flatMap((k) => Array(k.duration).fill(k));
const doc = (name, type) => ({ name, type, width: 550, height: 400, frameRate: 24, timelines: [{ name: "Scene 1", layers: [
  { name: "a/b", layerType: "normal", frames: expand([
    kf(0, 2, { actionScript: "stop();\\n// 日本語", elements: [{ name: "hero", elementType: "instance", libraryItem: lib }] }),
    kf(2, 3, { name: "end", elements: [{ name: "", elementType: "instance", libraryItem: lib }] })]) },
  { name: "dir", layerType: "folder", frames: [] }] }] });
const docs = process.env.FAKE_NO_DOC ? [] : [doc("a.fla", process.env.FAKE_TYPE || "Flash")].concat(process.env.FAKE_TWO ? [doc("b.fla", "Flash")] : []);
if (!src.includes("HANG")) runInNewContext(src, {
  FLfile: { platformPathToURI: (p) => p, write: (p, t) => writeFileSync(p, t) },
  fl: { trace() {}, documents: docs, getDocumentDOM: () => docs[0] || null },
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

test("export_scripts writes scripts, structure.md and manifest; Canvas uses .js", { timeout: 20_000 }, async () => {
    await withServer({}, async (client, dir) => {
        const out = join(dir, "out");
        const r = await client.callTool({ name: "export_scripts", arguments: { dir: out } });
        assert.equal(r.isError, undefined, text(r));
        assert.equal(await readFile(join(out, "scenes/Scene 1/a_b/1.as"), "utf8"), "stop();\n// 日本語");
        const md = await readFile(join(out, "scenes/Scene 1/structure.md"), "utf8");
        assert.match(md, /\| hero \| a\/b: 1-2 \|/);
        assert.match(md, /\| Hero \| a\/b: 3-5 \|/, "unnamed instance is listed by library item name");
        assert.match(md, /\| end \|/);
        assert.match(await readFile(join(out, "index.md"), "utf8"), /Scene 1/);
        assert.ok(JSON.parse(await readFile(join(out, ".export.json"), "utf8")).files["scenes/Scene 1/a_b/1.as"]);
    });
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, dir) => {
        const out = join(dir, "out");
        await client.callTool({ name: "export_scripts", arguments: { dir: out } });
        assert.match(await readFile(join(out, "scenes/Scene 1/a_b/1.js"), "utf8"), /^stop\(\)/);
    });
});

test("export_scripts errors: multiple documents list names; no document", { timeout: 20_000 }, async () => {
    await withServer({ FAKE_TWO: "1" }, async (client, dir) => {
        const r = await client.callTool({ name: "export_scripts", arguments: { dir: join(dir, "out") } });
        assert.equal(r.isError, true);
        assert.match(text(r), /a\.fla, b\.fla/);
        const ok = await client.callTool({
            name: "export_scripts",
            arguments: { document: "b.fla", dir: join(dir, "out") },
        });
        assert.equal(ok.isError, undefined, text(ok));
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client, dir) => {
        const r = await client.callTool({ name: "export_scripts", arguments: { dir: join(dir, "out") } });
        assert.equal(text(r), "No document open");
    });
});

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
