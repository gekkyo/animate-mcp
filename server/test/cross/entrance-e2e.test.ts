import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "../helpers/fake-animate.js";

test("Entrance stdio keeps serving after a timed-out Run", { timeout: 10_000 }, () =>
    withServer(
        { ANIMATE_MCP_TIMEOUT_MS: "500" },
        async (client) => {
            const result = await client.callTool({ name: "run_jsfl", arguments: { code: "/* HANG */ 1" } });
            assert.equal(result.isError, true);
            assert.match(text(result), /Run timed out after 500 ms/);

            const status = await client.callTool({
                name: "execute_readonly",
                arguments: { name: "get_status", arguments: {} },
            });
            assert.equal(status.isError, undefined, text(status));
            assert.equal((status.structuredContent as { animate: string }).animate, "responding");
        },
        { entrances: true },
    ),
);

test("Entrance stdio accepts cancellation and remains usable", { timeout: 10_000 }, () =>
    withServer(
        {},
        async (client, tempDir) => {
            const controller = new AbortController();
            const call = client.callTool(
                {
                    name: "execute_write",
                    arguments: { name: "test_movie", arguments: {} },
                },
                undefined,
                { signal: controller.signal },
            );

            const logPath = join(tempDir, "log");
            for (let attempt = 0; attempt < 100; attempt += 1) {
                try {
                    if ((await readFile(logPath, "utf8")).includes("start")) {
                        break;
                    }
                } catch {
                    // The fake launcher has not started yet.
                }
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            assert.match(await readFile(logPath, "utf8"), /start/);
            controller.abort();
            await assert.rejects(call);

            const status = await client.callTool({
                name: "execute_readonly",
                arguments: { name: "get_status", arguments: {} },
            });
            assert.equal(status.isError, undefined, text(status));
            assert.equal((status.structuredContent as { animate: string }).animate, "responding");
        },
        { entrances: true },
    ),
);
