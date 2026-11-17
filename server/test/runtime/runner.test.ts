import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunner } from "../../src/runtime/runner.js";
import { text, withServer } from "../helpers/fake-animate.js";

test("run_jsfl success, JSFL error, cleanup", { timeout: 20_000 }, () =>
    withServer({}, async (client, _tempDir, runsDir) => {
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

        // Run and Result are transient protocol files and must be removed after both outcomes.
        assert.deepEqual(await readdir(runsDir), [], "Run and Result files are removed");
    }),
);

test("hung Run times out and cleans up", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_TIMEOUT_MS: "500" }, async (client, _tempDir, runsDir) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "/* HANG */ 1" } });
        assert.equal(result.isError, true);
        assert.match(text(result), /timed out/i);
        assert.deepEqual(await readdir(runsDir), []);
    }),
);

test("hung launcher times out; special values survive", { timeout: 20_000 }, async () => {
    await withServer(
        { ANIMATE_MCP_LAUNCH_COMMAND: "/bin/sleep", ANIMATE_MCP_TIMEOUT_MS: "500" },
        async (client, _tempDir, runsDir) => {
            const result = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
            assert.equal(result.isError, true);
            assert.match(text(result), /timed out|Launcher exited/i);
            assert.deepEqual(await readdir(runsDir), []);
        },
    );
    await withServer({}, async (client, _tempDir) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "'a\\tb\\n\"c\"'" } });
        assert.deepEqual(result.structuredContent, { result: 'a\tb\n"c"' });
    });
});

test("Animate not running is a clear error and nothing is launched", { timeout: 20_000 }, () =>
    withServer({ ANIMATE_MCP_PROCESS_PATTERN: "no-such-process-xyzzy" }, async (client, tempDir) => {
        const result = await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        assert.equal(result.isError, true);
        assert.match(text(result), /Animate not running/);
        await assert.rejects(readFile(join(tempDir, "log"), "utf8"), { code: "ENOENT" });
    }),
);

test("concurrent Runs are serialized", { timeout: 20_000 }, () =>
    withServer({}, async (client, tempDir) => {
        await Promise.all(
            [1, 2, 3].map((runNumber) => client.callTool({ name: "run_jsfl", arguments: { code: String(runNumber) } })),
        );
        // Each launch must finish before the next starts, despite concurrent requests.
        assert.equal(
            (await readFile(join(tempDir, "log"), "utf8")).trim().split("\n").join(","),
            "start,end,start,end,start,end",
        );
    }),
);

test("old leftovers in the runs directory are removed on the next Run", { timeout: 20_000 }, () =>
    withServer({}, async (client, _tempDir, runsDir) => {
        await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        const old = join(runsDir, "orphan.result.json");
        await writeFile(old, "{}");
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await utimes(old, twoHoursAgo, twoHoursAgo);
        await client.callTool({ name: "run_jsfl", arguments: { code: "1" } });
        assert.deepEqual(await readdir(runsDir), []);
    }),
);

test("execute accepts a per-run timeout and cleans up on that deadline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-mcp-runner-test-"));
    const runner = createRunner({
        dir,
        launch: () => new Promise(() => {}),
        isRunning: async () => true,
        timeoutMs: 10_000,
    });
    try {
        await assert.rejects(runner.execute("1", 30), /Run timed out after 30 ms/);
        assert.deepEqual(await readdir(dir), []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("a Run Animate started but did not finish says it may still complete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-mcp-runner-test-"));
    const runner = createRunner({
        dir,
        // Fake Animate: starts the Run (marker) but never writes the Result file.
        launch: (runFile) => writeFile(runFile.replace(/\.jsfl$/, ".started"), ""),
        isRunning: async () => true,
        timeoutMs: 50,
        pollMs: 5,
    });
    try {
        await assert.rejects(runner.execute("1"), /started the \.jsfl but did not finish/);
        assert.deepEqual(await readdir(dir), []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("per-call timeout includes queue wait and skips an expired queued Run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-mcp-runner-test-"));
    let releaseFirst: (() => void) | undefined;
    let launches = 0;
    let runningChecks = 0;
    const runner = createRunner({
        dir,
        launch: () => {
            launches++;
            return new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
        },
        isRunning: async () => {
            runningChecks++;
            return true;
        },
        timeoutMs: 10_000,
    });
    try {
        const predecessor = runner.execute("first", 100);
        const queued = runner.execute("queued", 20);
        await assert.rejects(queued, /Run timed out after 20 ms/);
        releaseFirst?.();
        await assert.rejects(predecessor);
        assert.equal(launches, 1, "expired queued Run is never launched");
        assert.equal(runningChecks, 1, "expired queued Run skips the Animate probe");
        assert.deepEqual(await readdir(dir), []);
    } finally {
        releaseFirst?.();
        await rm(dir, { recursive: true, force: true });
    }
});

test("per-call timeout covers a stalled Animate-running check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-mcp-runner-test-"));
    let resolveFirstCheck: ((running: boolean) => void) | undefined;
    let runningChecks = 0;
    let launches = 0;
    const runner = createRunner({
        dir,
        launch: async () => {
            launches++;
        },
        isRunning: () => {
            runningChecks++;
            return runningChecks === 1
                ? new Promise<boolean>((resolve) => {
                      resolveFirstCheck = resolve;
                  })
                : Promise.resolve(false);
        },
        timeoutMs: 10_000,
    });
    try {
        const stalled = runner.execute("stalled", 20);
        await assert.rejects(stalled, /Run timed out after 20 ms/);
        resolveFirstCheck?.(true);
        await assert.rejects(runner.execute("next"), /Animate not running/);
        assert.equal(launches, 0, "stalled Run does not launch after its deadline");
    } finally {
        resolveFirstCheck?.(true);
        await rm(dir, { recursive: true, force: true });
    }
});
