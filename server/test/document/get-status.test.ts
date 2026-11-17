import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../../src/tools/core/shared.js";
import { registerGetStatus } from "../../src/tools/document/get-status.js";
import { createFakeJsfl } from "../helpers/fake-jsfl.js";

/**
 * Registers get_status with canned seam results.
 * @param result Canned status response
 * @param error Optional JSFL execution error
 * @returns Captured handler and fake call log
 */
function setup(result: unknown, error?: Error) {
    const fake = createFakeJsfl({ "document/get-status": result }, error ? { "document/get-status": error } : {});
    let handler: ToolCallback | undefined;
    const server = {
        registerTool(_name: string, _config: unknown, callback: ToolCallback) {
            handler = callback;
        },
    } as unknown as McpServer;
    const deps: ToolDeps = {
        runner: { execute: async () => undefined },
        jsfl: fake.jsfl,
    };
    registerGetStatus(server, deps);
    return {
        calls: fake.calls,
        call: () => {
            assert.ok(handler, "get_status handler was registered");
            return handler({});
        },
    };
}

test("get_status reports all open documents and identifies the active one", async () => {
    const first = { name: "a.fla", path: "file:///projects/a.fla", type: "Flash" };
    const second = { name: "b.fla", path: "file:///projects/b.fla", type: "HTML5 Canvas" };
    const fake = setup({
        animate: "responding",
        documents: [first, second],
        activeDocument: second,
    });
    const result = await fake.call();
    assert.deepEqual(result.structuredContent, {
        animate: "responding",
        documents: [first, second],
        activeDocument: second,
    });
    assert.deepEqual(fake.calls, [{ entry: "document/get-status", vars: {} }]);
    assert.doesNotMatch(JSON.stringify(result.structuredContent), /modified|dirty|unsaved/i);
});

test("get_status distinguishes no open document from Animate not responding", async () => {
    const empty = await setup({ animate: "responding", documents: [], activeDocument: null }).call();
    assert.deepEqual(empty.structuredContent, {
        animate: "responding",
        documents: [],
        activeDocument: null,
    });

    const timedOut = await setup({}, new Error("Run timed out after 5000 ms")).call();
    assert.deepEqual(timedOut.structuredContent, {
        animate: "not_responding",
        documents: [],
        activeDocument: null,
    });

    const notStarted = await setup({}, new Error("Animate not running: start Adobe Animate and try again")).call();
    assert.deepEqual(notStarted.structuredContent, {
        animate: "not_responding",
        documents: [],
        activeDocument: null,
    });
});
