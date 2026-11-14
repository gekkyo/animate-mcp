import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOpenDocument } from "../src/tools/open-document.js";

type FakeDocument = { name: string; pathURI?: string; type: string; asVersion?: string };

const targetJSFL = readFileSync(new URL("../jsfl/shared/document-target.jsfl", import.meta.url), "utf8");
const openJSFL = readFileSync(new URL("../jsfl/tools/open-document.jsfl", import.meta.url), "utf8");

function setup(initial: FakeDocument[] = [], files: Record<string, "valid" | "invalid"> = {}) {
    const documents = [...initial];
    const knownFiles = new Map(Object.entries(files));
    let activeDocument: FakeDocument | null = documents[0] ?? null;
    let nextUntitled = 1;
    let openCalls = 0;
    const globals = {
        FLfile: {
            platformPathToURI: (path: string) => pathToFileURL(path).href,
            uriToPlatformPath: (uri: string) => fileURLToPath(uri),
            exists: (uri: string) => knownFiles.has(uri),
        },
        fl: {
            documents,
            openDocument(uri: string) {
                openCalls++;
                if (knownFiles.get(uri) !== "valid") {
                    return false;
                }
                const pathURI = pathToFileURL(fileURLToPath(uri)).href;
                const name = fileURLToPath(uri).split(/[\\/]/).at(-1) ?? "";
                const document = { name, pathURI, type: "Flash", asVersion: "3" };
                documents.push(document);
                activeDocument = document;
                return true;
            },
            createDocument(type: string) {
                const document = {
                    name: `Untitled-${nextUntitled++}`,
                    type: type === "htmlcanvas" ? "htmlcanvas" : "Flash",
                    ...(type === "timeline" ? { asVersion: "3" } : {}),
                };
                documents.push(document);
                activeDocument = document;
                return true;
            },
            setActiveWindow(document: FakeDocument) {
                activeDocument = document;
            },
        },
    };
    let handler: ToolCallback | undefined;
    const server = {
        registerTool(_name: string, _config: unknown, callback: ToolCallback) {
            handler = callback;
        },
    } as unknown as McpServer;
    registerOpenDocument(server, {
        runner: { execute: async (code: string) => runInNewContext(code, globals) },
        bundle: (...names: string[]) =>
            names.map((name) => (name === "document-target" ? targetJSFL : openJSFL)).join("\n"),
    });
    return {
        call: (input: Record<string, unknown>) => {
            if (!handler) {
                throw new Error("open_document handler was not registered");
            }
            return handler(input as never);
        },
        active: () => activeDocument,
        openCalls: () => openCalls,
        documents,
        resolve: (target: string) =>
            runInNewContext(`${targetJSFL}\nresolveDocumentTarget(${JSON.stringify(target)})`, globals),
    };
}

test("open_document opens an existing FLA and reuses an already-open exact path", async () => {
    const path = "/projects/hero file.fla";
    const uri = pathToFileURL(path).href;
    const app = setup([], { [uri]: "valid" });
    const result = await app.call({ path });
    assert.deepEqual(result.structuredContent, { name: "hero file.fla", path: uri });
    assert.equal(app.openCalls(), 1);
    const existing = app.documents[0];
    const reuse = await app.call({ path: uri });
    assert.deepEqual(reuse.structuredContent, { name: "hero file.fla", path: uri });
    assert.equal(app.openCalls(), 1);
    assert.equal(app.active(), existing);
});

test("open_document reports missing and invalid FLA files and rejects other extensions", async () => {
    const app = setup([], { [pathToFileURL("/projects/bad.fla").href]: "invalid" });
    const missing = await app.call({ path: "/projects/missing.fla" });
    assert.equal(missing.isError, true);
    assert.match((missing.content as { text: string }[])[0].text, /does not exist/);
    const invalid = await app.call({ path: "/projects/bad.fla" });
    assert.equal(invalid.isError, true);
    assert.match((invalid.content as { text: string }[])[0].text, /could not open a valid FLA/);
    const extension = await app.call({ path: "/projects/not-a-fla.txt" });
    assert.equal(extension.isError, true);
    assert.match((extension.content as { text: string }[])[0].text, /\.fla/);
});

test("open_document creates default AS3 and HTML5 Canvas documents", async () => {
    const app = setup();
    const as3 = await app.call({ type: "timeline" });
    assert.deepEqual(as3.structuredContent, { name: "Untitled-1", path: null });
    const canvas = await app.call({ type: "htmlcanvas" });
    assert.deepEqual(canvas.structuredContent, { name: "Untitled-2", path: null });
    assert.equal(app.documents[0].type, "Flash");
    assert.equal(app.documents[1].type, "htmlcanvas");
});

test("open_document requires exactly one mode and document targets resolve exactly", async () => {
    const uri = pathToFileURL("/projects/hero.fla").href;
    const first = { name: "hero.fla", pathURI: uri, type: "Flash" };
    const app = setup([first]);
    assert.equal((await app.call({})).isError, true);
    assert.equal((await app.call({ path: "/projects/hero.fla", type: "timeline" })).isError, true);
    assert.equal(app.resolve("hero.fla").name, "hero.fla");
    assert.equal(app.resolve("/projects/hero.fla").pathURI, uri);
    assert.throws(() => app.resolve("missing.fla"), /matched 0 open documents/);
    const duplicate = setup([first, { ...first }]);
    assert.throws(() => duplicate.resolve("hero.fla"), /matched 2 open documents/);
});
