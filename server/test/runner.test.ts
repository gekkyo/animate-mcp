import assert from "node:assert/strict";
import { readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

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
