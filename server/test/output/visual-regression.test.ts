import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PNG } from "pngjs";
import type { ZodType } from "zod";
import { type ToolDeps, type ToolExtra, validateJsflResult } from "../../src/tools/core/shared.js";
import { registerVisualRegression, visualRegressionTool } from "../../src/tools/output/visual-regression.js";

/**
 * Encodes a single opaque pixel for baseline comparison tests.
 * @param red Red channel value.
 * @returns PNG bytes.
 */
function image(red: number): Buffer {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([red, 0, 0, 255]);
    return PNG.sync.write(png);
}

/**
 * Creates an isolated capture directory and a configurable fake capture runner.
 * @returns Fixture controls and cleanup function.
 */
async function fixture() {
    const home = await mkdtemp(join(tmpdir(), "animate-mcp-visual-"));
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    const captureDir = join(home, ".animate-mcp", "captures", "doc");
    await mkdir(captureDir, { recursive: true });
    let captures: Array<{ frame: number; width: number; height: number; bytes: Buffer }> = [];
    let documentURI: string | undefined = "file:///projects/doc.fla";
    let failure: Error | undefined;
    const calls: { entry: string; vars: Record<string, unknown> }[] = [];
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                throw new Error("Unexpected direct Runner call");
            },
        },
        jsfl: {
            async run<T>(entry: string, vars: Record<string, unknown>, schema: ZodType<T>) {
                calls.push({ entry, vars });
                if (failure) {
                    throw failure;
                }
                return validateJsflResult(
                    entry,
                    {
                        captures: await Promise.all(
                            captures.map(async ({ frame, width, height, bytes }, index) => {
                                const path = join(captureDir, `${frame}.png`);
                                await writeFile(path, bytes);
                                return {
                                    path,
                                    pathURI: Array.isArray(documentURI) ? documentURI[index] : documentURI,
                                    frame,
                                    timeline: "Scene 1",
                                    width,
                                    height,
                                };
                            }),
                        ),
                    },
                    schema,
                );
            },
        },
    };
    return {
        home,
        deps,
        calls,
        set: (items: typeof captures, uri?: string | Array<string | undefined>) => {
            captures = items;
            if (uri !== undefined) {
                documentURI = uri;
            }
        },
        setUri: (uri: string | undefined) => {
            documentURI = uri;
        },
        fail: (error?: Error) => {
            failure = error;
        },
        // eslint-disable-next-line no-restricted-syntax -- ToolDefinition erases its schema-derived input type to `never`.
        run: (args: unknown) => visualRegressionTool.run(args as never, deps, {} as ToolExtra),
        close: async () => {
            if (oldHome === undefined) {
                delete process.env.HOME;
            } else {
                process.env.HOME = oldHome;
            }
            await rm(home, { recursive: true, force: true });
        },
    };
}

/**
 * Builds the Baseline directory and sibling lock paths used by the tool.
 * @param home Isolated home directory.
 * @param uri Saved document URI.
 * @param name Baseline name.
 * @returns Baseline, save-lock, and recovery-lock paths.
 */
function baselinePaths(home: string, uri: string, name: string) {
    const id = createHash("sha256").update(uri).digest("hex").slice(0, 24);
    const documentDir = join(home, ".animate-mcp", "baselines", `doc-${id}`);
    const lock = join(documentDir, `.${name}.lock`);
    return { target: join(documentDir, name), lock, recovery: `${lock}.recovery` };
}

/**
 * Creates an aged lock directory, optionally with owner metadata.
 * @param path Directory to age.
 * @param owner Optional owner metadata.
 * @returns Nothing.
 */
async function createOldLock(path: string, owner?: string): Promise<void> {
    await mkdir(path, { recursive: true });
    if (owner !== undefined) {
        await writeFile(join(path, "owner.json"), owner);
    }
    const old = new Date(Date.now() - 120_000);
    await utimes(path, old, old);
}

test("visual_regression handles missing frames, stage mismatches, pass results, and fail-only diff images", async () => {
    const f = await fixture();
    try {
        f.set([
            { frame: 1, width: 1, height: 1, bytes: image(20) },
            { frame: 2, width: 1, height: 1, bytes: image(20) },
        ]);
        const saved = await f.run({ action: "save", name: "golden", range: { start: 1, end: 2 } });
        assert.equal(f.calls[0].entry, "output/capture-frame");
        assert.deepEqual(f.calls[0].vars, {
            __captureFrame: null,
            __captureRange: { start: 1, end: 2 },
            __captureDir: "",
            __captureIncludeDocumentURI: true,
            __captureRoot: join(f.home, ".animate-mcp", "captures"),
        });
        assert.equal(saved.data.action, "save");
        await assert.rejects(f.run({ action: "save", name: "golden", frame: 1 }), /already exists/);
        f.fail(new Error("simulated capture failure"));
        await assert.rejects(
            f.run({ action: "save", name: "golden", frame: 1, overwrite: true }),
            /simulated capture failure/,
        );
        f.fail();
        const preserved = await f.run({ action: "compare", name: "golden", range: { start: 1, end: 2 } });
        assert.equal(preserved.data.passed, true);

        f.set([{ frame: 3, width: 1, height: 1, bytes: image(20) }]);
        const missing = await f.run({ action: "compare", name: "golden", frame: 3 });
        assert.equal(missing.data.passed, false);
        assert.match((missing.data.frames as Array<{ reason: string }>)[0].reason, /Baseline frame is missing/);

        f.set([{ frame: 1, width: 2, height: 1, bytes: PNG.sync.write(new PNG({ width: 2, height: 1 })) }]);
        const mismatch = await f.run({ action: "compare", name: "golden", frame: 1 });
        assert.equal(mismatch.data.passed, false);
        assert.match((mismatch.data.frames as Array<{ reason: string }>)[0].reason, /Stage size differs/);

        f.set([
            { frame: 1, width: 1, height: 1, bytes: image(28) },
            { frame: 2, width: 1, height: 1, bytes: image(20) },
        ]);
        const pass = await f.run({
            action: "compare",
            name: "golden",
            range: { start: 1, end: 2 },
            tolerance: 8,
        });
        assert.equal(pass.data.passed, true);
        assert.equal((pass.content ?? []).filter(({ type }) => type === "image").length, 0);

        f.set([{ frame: 1, width: 1, height: 1, bytes: image(40) }]);
        const fail = await f.run({ action: "compare", name: "golden", frame: 1 });
        const frame = (fail.data.frames as Array<{ passed: boolean; changedPixels: number; diff: string }>)[0];
        assert.equal(frame.passed, false);
        assert.equal(frame.changedPixels, 1);
        assert.deepEqual(await readFile(frame.diff), image(255));
        assert.equal((fail.content ?? []).filter(({ type }) => type === "image").length, 1);

        f.set([{ frame: 1, width: 1, height: 1, bytes: image(40) }]);
        assert.equal((await f.run({ action: "save", name: "golden", frame: 1, overwrite: true })).data.action, "save");
    } finally {
        await f.close();
    }
});

test("visual_regression rejects oversized ranges and unsafe baseline names through MCP registration", async () => {
    const f = await fixture();
    const server = new McpServer({ name: "visual-regression-test", version: "1.0" });
    const client = new Client({ name: "visual-regression-test", version: "1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        registerVisualRegression(server, f.deps);
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const listed = await client.listTools();
        const schema = listed.tools.find(({ name }) => name === "visual_regression")?.inputSchema as {
            properties?: Record<string, unknown>;
        };
        assert.ok(schema.properties?.action);
        assert.ok(schema.properties?.name);
        assert.ok(schema.properties?.tolerance);
        assert.ok(schema.properties?.maxChangedPercent);
        assert.ok(schema.properties?.overwrite);
        assert.equal(schema.properties?.frame !== undefined, true);
        assert.equal(schema.properties?.range !== undefined, true);
        const invalidSave = await client.callTool({
            name: "visual_regression",
            arguments: { action: "save", name: "golden", frame: 1, tolerance: 8 },
        });
        assert.equal(invalidSave.isError, true);
        const invalidCompare = await client.callTool({
            name: "visual_regression",
            arguments: { action: "compare", name: "golden", frame: 1, overwrite: true },
        });
        assert.equal(invalidCompare.isError, true);
        const oversized = await client.callTool({
            name: "visual_regression",
            arguments: { action: "save", name: "golden", range: { start: 1, end: 25 } },
        });
        assert.equal(oversized.isError, true);
        const traversal = await client.callTool({
            name: "visual_regression",
            arguments: { action: "save", name: "../outside", frame: 1 },
        });
        assert.equal(traversal.isError, true);
    } finally {
        await client.close();
        await server.close();
        await f.close();
    }
});

test("visual_regression recovers an old lock owned by a dead process", async () => {
    const f = await fixture();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        const { target, lock, recovery } = baselinePaths(f.home, "file:///projects/doc.fla", "stale");
        await createOldLock(lock, JSON.stringify({ pid: 2_147_483_647 }));
        const results = await Promise.allSettled([
            f.run({ action: "save", name: "stale", frame: 1 }),
            f.run({ action: "save", name: "stale", frame: 1 }),
        ]);
        assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
        assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
        await readFile(join(target, "metadata.json"));
        await assert.rejects(readFile(join(lock, "owner.json")), { code: "ENOENT" });
        await assert.rejects(readFile(join(recovery, "owner.json")), { code: "ENOENT" });
    } finally {
        await f.close();
    }
});

test("visual_regression recovers old locks with missing or corrupt owners", async () => {
    const f = await fixture();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        for (const [name, owner] of [
            ["ownerless", undefined],
            ["corrupt-owner", "{not json"],
        ] as const) {
            const { target, lock } = baselinePaths(f.home, "file:///projects/doc.fla", name);
            await createOldLock(lock, owner);
            await f.run({ action: "save", name, frame: 1 });
            await readFile(join(target, "metadata.json"));
            await assert.rejects(readFile(join(lock, "owner.json")), { code: "ENOENT" });
        }
    } finally {
        await f.close();
    }
});

test("visual_regression recovers an old recovery guard but rejects a fresh guard and a live lock owner", async () => {
    const f = await fixture();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        const stale = baselinePaths(f.home, "file:///projects/doc.fla", "stale-guard");
        await createOldLock(stale.lock, JSON.stringify({ pid: 2_147_483_647 }));
        await createOldLock(stale.recovery, JSON.stringify({ pid: 2_147_483_647 }));
        await f.run({ action: "save", name: "stale-guard", frame: 1 });
        await assert.rejects(readFile(join(stale.recovery, "owner.json")), { code: "ENOENT" });

        const fresh = baselinePaths(f.home, "file:///projects/doc.fla", "fresh-guard");
        await createOldLock(fresh.lock, JSON.stringify({ pid: 2_147_483_647 }));
        await mkdir(fresh.recovery);
        await writeFile(join(fresh.recovery, "owner.json"), JSON.stringify({ pid: process.pid }));
        await assert.rejects(f.run({ action: "save", name: "fresh-guard", frame: 1 }), /already in progress/);
        await readFile(join(fresh.recovery, "owner.json"));

        const live = baselinePaths(f.home, "file:///projects/doc.fla", "live-owner");
        await createOldLock(live.lock, JSON.stringify({ pid: process.pid }));
        await assert.rejects(f.run({ action: "save", name: "live-owner", frame: 1 }), /already in progress/);
        await readFile(join(live.lock, "owner.json"));
        await assert.rejects(readFile(join(live.recovery, "owner.json")), { code: "ENOENT" });
    } finally {
        await f.close();
    }
});

test("Baseline names ending in .lock do not collide with sibling save locks", async () => {
    const f = await fixture();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        const lockNamed = await f.run({ action: "save", name: "sample.lock", frame: 1 });
        const baseNamed = await f.run({ action: "save", name: "sample", frame: 1 });
        assert.equal(lockNamed.data.action, "save");
        assert.equal(baseNamed.data.action, "save");
        await readFile(join(baselinePaths(f.home, "file:///projects/doc.fla", "sample.lock").target, "metadata.json"));
        await readFile(join(baselinePaths(f.home, "file:///projects/doc.fla", "sample").target, "metadata.json"));
    } finally {
        await f.close();
    }
});

test("visual_regression isolates same-named FLAs by saved pathURI and rejects missing or mixed identities", async () => {
    const f = await fixture();
    try {
        const item = [{ frame: 1, width: 1, height: 1, bytes: image(20) }];
        f.set(item, "file:///one/project/doc.fla");
        const first = await f.run({ action: "save", name: "shared", frame: 1 });
        assert.equal(first.data.document, "doc");
        assert.equal(JSON.stringify(first).includes("file:///one/project/doc.fla"), false);

        f.set(item, "file:///two/project/doc.fla");
        await f.run({ action: "save", name: "shared", frame: 1 });
        assert.equal((await f.run({ action: "compare", name: "shared", frame: 1 })).data.passed, true);
        f.set(item, "file:///one/project/doc.fla");
        assert.equal((await f.run({ action: "compare", name: "shared", frame: 1 })).data.passed, true);

        f.setUri(undefined);
        await assert.rejects(f.run({ action: "save", name: "unsaved", frame: 1 }), /saved document identity/);

        // Simulate an inconsistent range response containing two document identities.
        f.set(
            [
                { ...item[0], bytes: image(20) },
                { ...item[0], frame: 2, bytes: image(20) },
            ],
            ["file:///one/project/doc.fla", "file:///two/project/doc.fla"],
        );
        await assert.rejects(
            f.run({ action: "save", name: "mixed", range: { start: 1, end: 2 } }),
            /saved document identity/,
        );
    } finally {
        await f.close();
    }
});

test("concurrent saves without overwrite allow only one Baseline creation", async () => {
    const f = await fixture();
    try {
        f.set([{ frame: 1, width: 1, height: 1, bytes: image(20) }]);
        const results = await Promise.allSettled([
            f.run({ action: "save", name: "race", frame: 1 }),
            f.run({ action: "save", name: "race", frame: 1 }),
        ]);
        assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
        assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
    } finally {
        await f.close();
    }
});
