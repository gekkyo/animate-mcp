import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { registerCloseDocument } from "../src/tools/close-document.js";

type FakeDocument = {
    name: string;
    pathURI?: string;
    close: (prompt: boolean) => void;
};

const targetJSFL = readFileSync(new URL("../jsfl/shared/document-target.jsfl", import.meta.url), "utf8");
const closeJSFL = readFileSync(new URL("../jsfl/tools/close-document.jsfl", import.meta.url), "utf8");

function register(runner: { execute: (code: string) => Promise<unknown> }) {
    let registered:
        | {
              name: string;
              description: string;
              annotations: Record<string, unknown>;
              inputSchema: z.ZodRawShape;
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
    const bundleNames: string[][] = [];
    registerCloseDocument(server as never, {
        runner,
        bundle: (...names) => {
            bundleNames.push(names);
            return names.map((name) => (name === "document-target" ? targetJSFL : closeJSFL)).join("\n");
        },
    });
    assert.ok(registered);
    return { tool: registered, bundleNames };
}

test("close_document requires explicit discard consent and does not run without it", async () => {
    let calls = 0;
    const { tool } = register({
        execute: async () => {
            calls++;
            return "";
        },
    });
    const schema = z.object(tool.inputSchema);
    const valid = { document: "scene.fla" };

    assert.equal(schema.safeParse(valid).success, true);
    for (const input of [valid, { ...valid, discardUnsavedChanges: false }]) {
        const result = (await tool.handler(input)) as { isError: boolean; content: { text: string }[] };
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /save_document/);
    }
    assert.equal(calls, 0);
});

test("close_document closes only the exact target without prompting or saving", async () => {
    const uri = pathToFileURL("/projects/scene.fla").href;
    const calls: { name: string; prompt: boolean }[] = [];
    const documents: FakeDocument[] = [];
    const first: FakeDocument = {
        name: "scene.fla",
        pathURI: uri,
        close(prompt) {
            calls.push({ name: this.name, prompt });
            documents.splice(documents.indexOf(this), 1);
        },
    };
    const other: FakeDocument = {
        name: "other.fla",
        close(prompt) {
            calls.push({ name: this.name, prompt });
            documents.splice(documents.indexOf(this), 1);
        },
    };
    documents.push(first, other);
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
        },
        fl: {
            documents,
            closeAllPlayerDocuments() {
                throw new Error("must not close Test Movie Players");
            },
        },
    };
    let code = "";
    const { tool, bundleNames } = register({
        execute: async (value) => {
            code = value;
            return runInNewContext(value, globals);
        },
    });

    const result = (await tool.handler({ document: uri, discardUnsavedChanges: true })) as {
        structuredContent: { name: string; path: string | null };
    };

    assert.deepEqual(bundleNames, [["document-target", "close-document"]]);
    assert.ok(code.includes(`var __closeDocumentTarget = ${JSON.stringify(uri)};`));
    assert.equal("isError" in result, false);
    assert.deepEqual(result.structuredContent, { name: "scene.fla", path: uri });
    assert.deepEqual(calls, [{ name: "scene.fla", prompt: false }]);
    assert.deepEqual(documents, [other]);
});

test("close_document refuses missing and ambiguous document targets", async () => {
    const documents: FakeDocument[] = [];
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
        },
        fl: { documents },
    };
    const { tool } = register({ execute: async (code) => runInNewContext(code, globals) });
    const input = { document: "scene.fla", discardUnsavedChanges: true };

    const missing = (await tool.handler(input)) as { isError: boolean; content: { text: string }[] };
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /matched 0 open documents/);

    const duplicate = (name: string): FakeDocument => ({ name, close: () => assert.fail("must not close") });
    documents.push(duplicate("scene.fla"), duplicate("scene.fla"));
    const ambiguous = (await tool.handler(input)) as { isError: boolean; content: { text: string }[] };
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.content[0].text, /matched 2 open documents/);
});
