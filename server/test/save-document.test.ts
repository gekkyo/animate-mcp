import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerSaveDocument } from "../src/tools/save-document.js";

type FakeDocument = { name: string; pathURI?: string };

const targetJSFL = readFileSync(new URL("../jsfl/shared/document-target.jsfl", import.meta.url), "utf8");
const saveJSFL = readFileSync(new URL("../jsfl/tools/save-document.jsfl", import.meta.url), "utf8");

function setup(
    initial: FakeDocument[],
    files: string[] = [],
    options: { saveResult?: boolean; reportedPath?: string } = {},
) {
    const documents = [...initial];
    const knownFiles = new Set(files);
    const activeDocument = documents[0] ?? null;
    const saveCalls: { document: FakeDocument; uri: string }[] = [];
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
            exists: (uri: string) => knownFiles.has(uri),
        },
        fl: {
            documents,
            saveDocument(document: FakeDocument, uri: string) {
                saveCalls.push({ document, uri });
                if (options.saveResult === false) {
                    return false;
                }
                document.pathURI = options.reportedPath ?? pathToFileURL(fileURLToPath(uri)).href;
                knownFiles.add(uri);
                return true;
            },
        },
    };
    let registered:
        | {
              inputSchema: z.ZodRawShape;
              handler: (input: unknown) => Promise<unknown>;
              description: string;
              annotations: Record<string, unknown>;
          }
        | undefined;
    const server = {
        registerTool(_name: string, options: Omit<NonNullable<typeof registered>, "handler">, handler: unknown) {
            registered = { ...options, handler: handler as (input: unknown) => Promise<unknown> };
        },
    };
    const bundleNames: string[][] = [];
    registerSaveDocument(server as unknown as McpServer, {
        runner: { execute: async (code) => runInNewContext(code, globals) },
        bundle: (...names) => {
            bundleNames.push(names);
            return names.map((name) => (name === "document-target" ? targetJSFL : saveJSFL)).join("\n");
        },
    });
    assert.ok(registered);
    const tool = registered;
    const schema = z.object(tool.inputSchema);
    return {
        call: (input: Record<string, unknown>) => tool.handler(schema.parse(input)),
        activeDocument,
        documents,
        saveCalls,
        bundleNames,
        schema,
        tool,
    };
}

function toolError(result: unknown) {
    const value = result as { isError: boolean; content: { text: string }[] };
    assert.equal(value.isError, true);
    return value.content[0].text;
}

test("save_document requires an explicit unique document and refuses unconfirmed overwrite of its current path", async () => {
    const path = "/projects/hero file.fla";
    const uri = pathToFileURL(path).href;
    const first = { name: "hero file.fla", pathURI: uri };
    const other = { name: "other.fla", pathURI: pathToFileURL("/projects/other.fla").href };
    const app = setup([first, other], [uri, other.pathURI]);

    assert.equal(app.schema.safeParse({}).success, false);
    assert.equal(app.schema.safeParse({ document: first.name, confirm: false }).success, false);
    assert.match(toolError(await app.call({ document: first.name })), /confirm: true/);
    assert.equal(app.saveCalls.length, 0);

    const result = (await app.call({ document: first.name, confirm: true })) as {
        structuredContent: { path: string };
    };
    assert.deepEqual(result.structuredContent, { path: uri });
    assert.deepEqual(app.bundleNames, [
        ["document-target", "save-document"],
        ["document-target", "save-document"],
    ]);
    assert.equal(app.saveCalls.length, 1);
    assert.equal(app.activeDocument, first);
    assert.equal(first.pathURI, uri);
    assert.equal(other.pathURI, pathToFileURL("/projects/other.fla").href);
});

test("save_document gates an existing different destination and allows a new save-as path", async () => {
    const source = { name: "source.fla", pathURI: pathToFileURL("/projects/source.fla").href };
    const existingTarget = pathToFileURL("/projects/existing.fla").href;
    const app = setup([source], [source.pathURI, existingTarget]);

    assert.match(toolError(await app.call({ document: source.name, path: existingTarget })), /confirm: true/);
    assert.equal(app.saveCalls.length, 0);
    const overwritten = (await app.call({ document: source.name, path: existingTarget, confirm: true })) as {
        structuredContent: { path: string };
    };
    assert.deepEqual(overwritten.structuredContent, { path: existingTarget });
    assert.equal(source.pathURI, existingTarget);

    const newPath = "/projects/new.fla";
    const created = (await app.call({ document: source.name, path: newPath })) as {
        structuredContent: { path: string };
    };
    assert.deepEqual(created.structuredContent, { path: pathToFileURL(newPath).href });
    assert.equal(app.saveCalls.length, 2);
});

test("save_document refuses non-FLA save-as paths before saving", async () => {
    const source = { name: "source.fla", pathURI: pathToFileURL("/projects/source.fla").href };
    const app = setup([source]);

    for (const path of ["/projects/invalid.txt", pathToFileURL("/projects/invalid.txt").href]) {
        assert.match(toolError(await app.call({ document: source.name, path })), /must point to a \.fla file/);
    }
    assert.equal(app.saveCalls.length, 0);
});

test("save_document refuses a save-as path owned by another open document even with confirmation", async () => {
    const source = { name: "source.fla", pathURI: pathToFileURL("/projects/source.fla").href };
    const otherPath = "/projects/open other.fla";
    const other = { name: "open other.fla", pathURI: pathToFileURL(otherPath).href };
    const app = setup([source, other]);

    assert.match(
        toolError(await app.call({ document: source.name, path: otherPath, confirm: true })),
        /another open document/,
    );
    assert.equal(app.saveCalls.length, 0);
    assert.equal(source.pathURI, pathToFileURL("/projects/source.fla").href);
    assert.equal(other.pathURI, pathToFileURL(otherPath).href);
});

test("save_document requires a save-as path for an unsaved document and leaves other documents untouched", async () => {
    const unsaved = { name: "Untitled-1" };
    const other = { name: "saved.fla", pathURI: pathToFileURL("/projects/saved.fla").href };
    const app = setup([unsaved, other], [other.pathURI]);

    assert.match(toolError(await app.call({ document: unsaved.name })), /save-as path/);
    assert.equal(app.saveCalls.length, 0);
    const result = (await app.call({ document: unsaved.name, path: "/projects/created.fla" })) as {
        structuredContent: { path: string };
    };
    assert.deepEqual(result.structuredContent, { path: pathToFileURL("/projects/created.fla").href });
    assert.equal(other.pathURI, pathToFileURL("/projects/saved.fla").href);
});

test("save_document refuses ambiguous targets and verifies Animate's save result and reported path", async () => {
    const duplicate = { name: "duplicate.fla", pathURI: pathToFileURL("/projects/duplicate.fla").href };
    const ambiguous = setup([duplicate, { ...duplicate }], [duplicate.pathURI]);
    assert.match(toolError(await ambiguous.call({ document: duplicate.name, confirm: true })), /matched 2/);
    assert.equal(ambiguous.saveCalls.length, 0);

    const path = pathToFileURL("/projects/failure.fla").href;
    const failed = setup([{ name: "failure.fla", pathURI: path }], [path], { saveResult: false });
    assert.match(toolError(await failed.call({ document: "failure.fla", confirm: true })), /did not confirm/);

    const mismatchedPath = pathToFileURL("/projects/other.fla").href;
    const mismatched = setup([{ name: "failure.fla", pathURI: path }], [path], { reportedPath: mismatchedPath });
    assert.match(toolError(await mismatched.call({ document: "failure.fla", confirm: true })), /reported path/);
});
