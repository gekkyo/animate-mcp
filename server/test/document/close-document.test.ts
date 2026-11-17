import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { createJsflRunner } from "../../src/tools/core/shared.js";
import { registerCloseDocument } from "../../src/tools/document/close-document.js";

type FakeDocument = {
    name: string;
    pathURI?: string;
    selectNone: () => void;
    close: (prompt: boolean) => void;
};

/**
 * Captures the close-document tool and executes its JSFL against fake Animate globals.
 * @param runner Executes bundled JSFL against the test's fake Animate globals
 * @param runner.execute Runs the supplied JSFL code in the fake application
 * @returns Registered tool
 */
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
    const jsfl = createJsflRunner(runner);
    registerCloseDocument(server as unknown as Parameters<typeof registerCloseDocument>[0], {
        runner,
        jsfl,
    });
    assert.ok(registered);
    return { tool: registered };
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
    const order: string[] = [];
    const executions: string[] = [];
    const documents: FakeDocument[] = [];
    const first: FakeDocument = {
        name: "scene.fla",
        pathURI: uri,
        selectNone() {
            order.push("selectNone");
        },
        close(prompt) {
            order.push("close");
            calls.push({ name: this.name, prompt });
            documents.splice(documents.indexOf(this), 1);
        },
    };
    const other: FakeDocument = {
        name: "other.fla",
        selectNone() {},
        close(prompt) {
            calls.push({ name: this.name, prompt });
            documents.splice(documents.indexOf(this), 1);
        },
    };
    documents.push(first, other);
    // The extra open document proves the script closes only the exact target.
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
        },
        fl: {
            documents,
            selectTool(name: string) {
                order.push(`selectTool:${name}`);
                return true;
            },
            closeAllPlayerDocuments() {
                throw new Error("must not close Test Movie Players");
            },
        },
    };
    const { tool } = register({
        execute: async (value) => {
            executions.push(value);
            return runInNewContext(value, globals);
        },
    });

    const result = (await tool.handler({ document: uri, discardUnsavedChanges: true })) as {
        structuredContent: { name: string; path: string | null };
    };

    assert.equal(executions.length, 2);
    assert.ok(executions[0].includes(`var __closeDocumentTarget = ${JSON.stringify(uri)};`));
    assert.ok(executions[0].includes('fl.selectTool("arrow")'));
    assert.ok(executions[1].includes(`var __closeDocumentTarget = ${JSON.stringify(uri)};`));
    assert.equal("isError" in result, false);
    assert.deepEqual(result.structuredContent, { name: "scene.fla", path: uri });
    assert.deepEqual(order, ["selectTool:arrow", "selectNone", "close"]);
    assert.deepEqual(calls, [{ name: "scene.fla", prompt: false }]);
    assert.deepEqual(documents, [other]);
});

test("close_document never closes when the separate Arrow-tool Run fails", async () => {
    for (const selectTool of [
        () => false,
        () => {
            throw new Error("selection failed");
        },
    ]) {
        const uri = pathToFileURL("/projects/scene.fla").href;
        const order: string[] = [];
        const target: FakeDocument = {
            name: "scene.fla",
            pathURI: uri,
            selectNone() {
                order.push("selectNone");
            },
            close() {
                order.push("close");
            },
        };
        const globals = {
            FLfile: {
                platformPathToURI: (path: string) => pathToFileURL(path).href,
                uriToPlatformPath: (path: string) => fileURLToPath(path),
            },
            fl: {
                documents: [target],
                selectTool(name: string) {
                    order.push(`selectTool:${name}`);
                    return selectTool();
                },
            },
        };
        let executions = 0;
        const { tool } = register({
            execute: async (code) => {
                executions++;
                return runInNewContext(code, globals);
            },
        });

        const result = (await tool.handler({ document: uri, discardUnsavedChanges: true })) as {
            isError: boolean;
            content: { text: string }[];
        };

        assert.equal(result.isError, true);
        assert.equal(executions, 1);
        assert.deepEqual(order, ["selectTool:arrow"]);
        assert.deepEqual(globals.fl.documents, [target]);
    }
});

test("close_document refuses missing and ambiguous document targets", async () => {
    const documents: FakeDocument[] = [];
    let selectToolCalls = 0;
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
        },
        fl: {
            documents,
            selectTool() {
                selectToolCalls++;
                return true;
            },
        },
    };
    const { tool } = register({
        execute: async (code) => runInNewContext(code, globals),
    });
    const input = { document: "scene.fla", discardUnsavedChanges: true };

    const missing = (await tool.handler(input)) as { isError: boolean; content: { text: string }[] };
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /matched 0 open documents/);
    assert.equal(selectToolCalls, 0);
    /**
     * Creates a fake document for the ambiguous-target case.
     * @param name Document name shared by the duplicate fixtures
     * @returns A fake document that fails if closed
     */
    const duplicate = (name: string): FakeDocument => ({
        name,
        selectNone: () => assert.fail("must not change selection"),
        close: () => assert.fail("must not close"),
    });
    documents.push(duplicate("scene.fla"), duplicate("scene.fla"));
    const ambiguous = (await tool.handler(input)) as { isError: boolean; content: { text: string }[] };
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.content[0].text, /matched 2 open documents/);
    assert.equal(selectToolCalls, 0);
});
