import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetStatus } from "../../src/tools/document/get-status.js";

const statusJSFL = readFileSync(new URL("../../jsfl/document/get-status.jsfl", import.meta.url), "utf8");
/**
 * Builds a fake application and captures the registered get_status handler.
 * @param documents Open document fixtures
 * @param active Active document fixture, if any
 * @param execute JSFL runner used by the tool
 * @returns A helper that invokes the registered handler
 */
function setup(
    documents: Record<string, unknown>[] = [],
    active: Record<string, unknown> | null = documents[0] ?? null,
    execute: (code: string, timeoutMs?: number) => Promise<unknown> = async () =>
        runInNewContext(statusJSFL, {
            fl: {
                documents,
                getDocumentDOM: () => active,
            },
            serialize: JSON.stringify,
        }),
) {
    let handler: ToolCallback | undefined;
    const server = {
        registerTool(_name: string, _config: unknown, callback: ToolCallback) {
            handler = callback;
        },
    } as unknown as McpServer;
    registerGetStatus(server, {
        runner: { execute },
        bundle: () => statusJSFL,
    });
    return {
        call: () => {
            assert.ok(handler, "get_status handler was registered");
            return handler({});
        },
    };
}

test("get_status reports all open documents and identifies the active one", async () => {
    const first = { name: "a.fla", pathURI: "file:///projects/a.fla", type: "Flash" };
    const second = { name: "b.fla", pathURI: "file:///projects/b.fla", type: "HTML5 Canvas" };
    const result = await setup([first, second], second).call();
    assert.deepEqual(result.structuredContent, {
        animate: "responding",
        documents: [
            { name: "a.fla", path: "file:///projects/a.fla", type: "Flash" },
            { name: "b.fla", path: "file:///projects/b.fla", type: "HTML5 Canvas" },
        ],
        activeDocument: { name: "b.fla", path: "file:///projects/b.fla", type: "HTML5 Canvas" },
    });
    assert.doesNotMatch(JSON.stringify(result.structuredContent), /modified|dirty|unsaved/i);
});

test("get_status distinguishes no open document from Animate not responding", async () => {
    const empty = await setup([]).call();
    assert.deepEqual(empty.structuredContent, {
        animate: "responding",
        documents: [],
        activeDocument: null,
    });

    const timedOut = await setup([], null, async (_code, timeoutMs) => {
        assert.equal(timeoutMs, 5_000);
        throw new Error("Run timed out after 5000 ms");
    }).call();
    assert.deepEqual(timedOut.structuredContent, {
        animate: "not_responding",
        documents: [],
        activeDocument: null,
    });

    const notStarted = await setup([], null, async () => {
        throw new Error("Animate not running: start Adobe Animate and try again");
    }).call();
    assert.deepEqual(notStarted.structuredContent, {
        animate: "not_responding",
        documents: [],
        activeDocument: null,
    });
});
