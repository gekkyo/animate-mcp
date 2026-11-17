import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { INSTRUCTIONS } from "../../src/index.js";
import { registerEntrances } from "../../src/tools/core/entrance.js";
import type { ToolDefinition } from "../../src/tools/core/shared.js";
import { text, withServer } from "../helpers/fake-animate.js";

test("entrances search exact names, all query terms, and prioritize name matches", { timeout: 20_000 }, async () => {
    await withServer(
        {},
        async (client) => {
            const exact = await client.callTool({ name: "search_tools", arguments: { query: "get_air_descriptor" } });
            const details = JSON.parse(text(exact));
            assert.equal(details.name, "get_air_descriptor");
            assert.ok(details.inputSchema.properties.descriptorPath);
            assert.ok(details.description.includes("AIR"));
            const matches = JSON.parse(
                text(await client.callTool({ name: "search_tools", arguments: { query: "timeline" } })),
            );
            assert.ok(matches.length <= 5);
            assert.ok(matches.some((tool: { name: string }) => tool.name === "inspect_timeline"));

            const publishAir = JSON.parse(
                text(await client.callTool({ name: "search_tools", arguments: { query: "publish air" } })),
            );
            assert.ok(publishAir.some((tool: { name: string }) => tool.name === "preflight_publish"));

            const editTimeline = JSON.parse(
                text(await client.callTool({ name: "search_tools", arguments: { query: "edit timeline" } })),
            );
            assert.equal(editTimeline[0].name, "edit_timeline");
        },
        { entrances: true },
    );
});

test("entrances dispatch real tools, preserve image content and enforce routing and schemas", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {},
        async (client, tempDir) => {
            const descriptorPath = join(tempDir, "test-app.xml");
            await writeFile(descriptorPath, "<application><id>test.app</id></application>");
            const read = await client.callTool({
                name: "execute_readonly",
                arguments: { name: "get_air_descriptor", arguments: { descriptorPath } },
            });
            assert.equal(read.isError, undefined, text(read));
            assert.equal((read.structuredContent as { id: string }).id, "test.app");

            const readonlyReject = await client.callTool({
                name: "execute_write",
                arguments: { name: "get_status", arguments: {} },
            });
            assert.equal(readonlyReject.isError, true);
            assert.match(text(readonlyReject), /execute_readonly.*Nothing ran/);
            await assert.rejects(readFile(join(tempDir, "log")));

            const write = await client.callTool({
                name: "execute_write",
                arguments: { name: "test_movie", arguments: {} },
            });
            assert.equal(write.isError, undefined, text(write));
            const dryRun = await client.callTool({
                name: "execute_write",
                arguments: {
                    name: "set_air_descriptor",
                    arguments: { descriptorPath, versionNumber: "1.0", dryRun: true },
                },
            });
            assert.equal(dryRun.isError, undefined, text(dryRun));

            const image = await client.callTool({
                name: "execute_write",
                arguments: { name: "capture_frame", arguments: { frame: 1 } },
            });
            assert.equal(image.isError, undefined, text(image));
            assert.ok(image.content.some((part) => part.type === "image"));

            for (const tool of ["execute_readonly", "execute_write"]) {
                const logPath = join(tempDir, "log");
                const previousLog = await readFile(logPath, "utf8");
                const directReject = await client.callTool({
                    name: tool,
                    arguments: { name: "run_jsfl", arguments: {} },
                });
                assert.equal(directReject.isError, true);
                assert.match(text(directReject), /run_jsfl.*directly/);
                assert.equal(await readFile(logPath, "utf8"), previousLog);
                const beforeUnknown = await readFile(logPath, "utf8");
                const unknown = await client.callTool({ name: tool, arguments: { name: "not_a_tool", arguments: {} } });
                assert.equal(unknown.isError, true);
                assert.match(text(unknown), /Suggestions/);
                assert.equal(await readFile(logPath, "utf8"), beforeUnknown);
                const typo = await client.callTool({ name: tool, arguments: { name: "get_doc_info", arguments: {} } });
                assert.match(text(typo), /get_document_info/);
                assert.equal(await readFile(logPath, "utf8"), beforeUnknown);
            }

            const logPath = join(tempDir, "log");
            const previousLog = await readFile(logPath, "utf8");
            const invalid = await client.callTool({
                name: "execute_write",
                arguments: { name: "edit_timeline", arguments: { operations: [{ type: "deleteLayer" }] } },
            });
            assert.equal(invalid.isError, true);
            assert.match(text(invalid), /Input schema:/);
            assert.match(text(invalid), /Warnings:/);
            assert.equal(await readFile(logPath, "utf8"), previousLog);
        },
        { entrances: true },
    );
});

test("entrance tools and compact instructions stay within the initial-byte budget", { timeout: 20_000 }, async () => {
    await withServer(
        {},
        async (client) => {
            const { tools } = await client.listTools();
            assert.deepEqual(
                tools.map((tool) => tool.name).sort(),
                ["execute_readonly", "execute_write", "run_jsfl", "search_tools"].sort(),
            );
            const bytes = Buffer.byteLength(JSON.stringify(tools)) + Buffer.byteLength(INSTRUCTIONS);
            assert.ok(bytes <= 11_500, `entrance metadata is ${bytes} bytes`);
        },
        { entrances: true },
    );
});

test("execute_write forwards request cancellation to the target tool", { timeout: 10_000 }, async () => {
    let seenSignal: AbortSignal | undefined;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
    });
    const slowTool: ToolDefinition = {
        name: "slow_write",
        description: "Waits until cancelled.",
        guidance: {},
        run: async (_args, _deps, extra) => {
            seenSignal = extra.signal;
            started();
            await new Promise((resolve) => extra.signal.addEventListener("abort", resolve));
            return { data: {} };
        },
    };
    const server = new McpServer({ name: "t", version: "0" });
    registerEntrances(server, [slowTool], {
        runner: { execute: async () => Promise.reject(new Error("unused")) },
        jsfl: {
            run: async () => {
                throw new Error("unused");
            },
        },
    });
    const client = new Client({ name: "c", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
        const controller = new AbortController();
        const call = client.callTool({ name: "execute_write", arguments: { name: "slow_write" } }, undefined, {
            signal: controller.signal,
        });
        await startedPromise;
        controller.abort();
        await assert.rejects(call);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(seenSignal?.aborted, true);
    } finally {
        await client.close();
        await server.close();
    }
});

test("execute_write forwards target-tool progress notifications", { timeout: 30_000 }, async () => {
    await withServer(
        {},
        async (client) => {
            const progress: number[] = [];
            client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
                if (notification.params.progressToken === "entrance-progress") {
                    progress.push(notification.params.progress);
                }
            });
            const result = await client.callTool({
                name: "execute_write",
                arguments: { name: "export_scripts", arguments: {} },
                _meta: { progressToken: "entrance-progress" },
            });
            assert.equal(result.isError, undefined, text(result));
            assert.ok(progress.length > 0);
        },
        { entrances: true },
    );
});
