import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunner } from "../src/runtime/runner.js";

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
