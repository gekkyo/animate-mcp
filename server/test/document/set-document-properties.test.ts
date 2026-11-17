import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createJsflRunner, type ToolDeps } from "../../src/tools/core/shared.js";
import { registerGetDocumentInfo } from "../../src/tools/document/get-document-info.js";
import { registerSetDocumentProperties } from "../../src/tools/document/set-document-properties.js";
import { createFakeJsfl } from "../helpers/fake-jsfl.js";

/**
 * Registers a document tool against selected fake globals.
 * @param register Tool registration function under test
 * @param globals Animate API globals exposed to JSFL
 * @param expectedName Expected registered tool name
 * @param jsfl JSFL seam supplied to the tool
 * @returns The captured tool registration
 */
function registerTool(
    register: (server: McpServer, deps: ToolDeps) => void,
    globals: Record<string, unknown>,
    expectedName: string,
    jsfl?: ToolDeps["jsfl"],
) {
    let registered:
        | {
              name: string;
              description: string;
              annotations: Record<string, unknown>;
              inputSchema?: z.ZodRawShape;
              handler: (input: unknown) => Promise<unknown>;
          }
        | undefined;
    const server = {
        registerTool(
            name: string,
            options: Omit<NonNullable<typeof registered>, "name" | "handler">,
            handler: unknown,
        ) {
            registered = { name, ...options, handler: handler as (input: unknown) => Promise<unknown> };
        },
    };
    const runner = { execute: async (code: string) => runInNewContext(code, globals) };
    const deps: ToolDeps = { runner, jsfl: jsfl ?? createJsflRunner(runner) };
    register(server as unknown as McpServer, deps);
    assert.equal(registered?.name, expectedName);
    return registered;
}

/**
 * Creates a fake Flash document with observable stage content.
 * @param name Document name
 * @param width Initial document width
 * @param height Initial document height
 * @returns Fake document fixture
 */
function makeDocument(name: string, width = 550, height = 400) {
    return {
        name,
        type: "Flash",
        asVersion: "AS3",
        width,
        height,
        frameRate: 24,
        backgroundColor: "#FFFFFF",
        pathURI: undefined,
        timelines: [{ name: "Scene 1" }],
        content: { x: 73, y: 29 },
    };
}

test("set_document_properties updates selected values and reports read-back without saving or moving content", async () => {
    const document = makeDocument("sample.fla");
    const otherDocument = makeDocument("other.fla", 320, 240);
    const tool = registerTool(
        registerSetDocumentProperties,
        { fl: { documents: [otherDocument, document] } },
        "set_document_properties",
    );
    const schema = z.object(tool?.inputSchema ?? {});
    const result = (await tool?.handler(
        schema.parse({ document: "sample.fla", width: 3840, height: 2160, frameRate: 30, backgroundColor: "#12aBcD" }),
    )) as { structuredContent: Record<string, unknown> };

    assert.equal(result.structuredContent.document, "sample.fla");
    assert.deepEqual(result.structuredContent.properties, {
        width: 3840,
        height: 2160,
        frameRate: 30,
        backgroundColor: "#12aBcD",
    });
    assert.deepEqual(
        {
            width: document.width,
            height: document.height,
            frameRate: document.frameRate,
            backgroundColor: document.backgroundColor,
        },
        { width: 3840, height: 2160, frameRate: 30, backgroundColor: "#12aBcD" },
    );
    assert.deepEqual(document.content, { x: 73, y: 29 });
    assert.deepEqual(
        { width: otherDocument.width, height: otherDocument.height, frameRate: otherDocument.frameRate },
        { width: 320, height: 240, frameRate: 24 },
    );
});

test("set_document_properties requires at least one valid property", async () => {
    const document = makeDocument("sample.fla");
    const tool = registerTool(
        registerSetDocumentProperties,
        { fl: { documents: [document] } },
        "set_document_properties",
    );
    const schema = z.object(tool?.inputSchema ?? {});
    const empty = (await tool?.handler(schema.parse({}))) as { isError: true; content: { text: string }[] };
    assert.equal(empty.isError, true);
    assert.match(empty.content[0].text, /at least one/);
    for (const invalid of [
        { width: 0 },
        { width: 3841 },
        { height: 3841 },
        { height: 1.5 },
        { frameRate: 0 },
        { frameRate: 120.1 },
        { backgroundColor: "red" },
    ]) {
        assert.equal(schema.safeParse(invalid).success, false, JSON.stringify(invalid));
    }
});

test("get_document_info includes the document background color", async () => {
    const document = makeDocument("sample.fla");
    const fake = createFakeJsfl({
        "document/get-document-info": {
            name: "sample.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            backgroundColor: "#FFFFFF",
            timelines: ["Scene 1"],
            asVersion: "AS3",
            folder: null,
        },
    });
    const tool = registerTool(
        registerGetDocumentInfo,
        {
            fl: {
                documents: [document],
                getDocumentDOM: () => document,
            },
        },
        "get_document_info",
        fake.jsfl,
    );
    const result = (await tool?.handler({})) as { structuredContent: Record<string, unknown> };

    assert.equal(result.structuredContent.backgroundColor, "#FFFFFF");
    assert.deepEqual(fake.calls, [{ entry: "document/get-document-info", vars: {} }]);
});
