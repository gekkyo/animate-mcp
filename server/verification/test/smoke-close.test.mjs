import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { closeDocumentByPath, closeUnsavedDocumentByName, createSavedAs3Document } from "../smoke/lib/smoke-lib.mjs";

/** Creates a fake raw JSFL handler that executes each Run against shared Animate globals.
 * @param globals Fake Animate and FLfile globals.
 * @param calls Captured JSFL Runs.
 * @returns Fake run_jsfl handler.
 */
function fakeRunJsfl(globals, calls) {
    return async ({ code }) => {
        calls.push(code);
        try {
            return { structuredContent: { result: runInNewContext(code, globals) } };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: error.message }] };
        }
    };
}

/** Creates the minimum exact-path fake document used by the close tests.
 * @param name Document name.
 * @param pathURI Optional saved document URI.
 * @param events Ordered fake Animate side effects.
 * @param documents Open fake documents.
 * @returns Fake document.
 */
function fakeDocument(name, pathURI, events, documents) {
    return {
        name,
        pathURI,
        type: "Flash",
        asVersion: "3",
        getTimeline() {
            return { layers: [{ frames: [{}] }] };
        },
        selectNone() {
            events.push("selectNone");
        },
        close(prompt) {
            events.push(`close:${prompt}`);
            documents.splice(documents.indexOf(this), 1);
        },
    };
}

/**
 * Builds fake Animate globals for document-path resolution.
 * @param documents Open fake documents.
 * @param events Ordered fake Animate side effects.
 * @param selectTool Fake tool selector.
 * @returns Globals shared between the JSFL Runs.
 */
function fakeGlobals(documents, events, selectTool = () => true) {
    return {
        FLfile: {
            platformPathToURI: (platformPath) => pathToFileURL(platformPath).href,
            uriToPlatformPath: (uri) => fileURLToPath(uri),
        },
        fl: {
            documents,
            selectTool(tool) {
                events.push(`selectTool:${tool}`);
                return selectTool();
            },
        },
    };
}

test("shared saved-document cleanup runs Arrow preparation before exact-path close", async () => {
    const events = [];
    const calls = [];
    const documents = [];
    const targetPath = pathToFileURL("/tmp/disposable.fla").href;
    const target = fakeDocument("disposable.fla", targetPath, events, documents);
    const other = fakeDocument("user.fla", pathToFileURL("/tmp/user.fla").href, events, documents);
    documents.push(target, other);
    const runJsfl = fakeRunJsfl(fakeGlobals(documents, events), calls);

    await closeDocumentByPath(runJsfl, targetPath);

    assert.equal(calls.length, 2);
    assert.match(calls[0], /resolveDocumentTarget/);
    assert.match(calls[0], new RegExp(targetPath.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(calls[0], /fl\.selectTool\("arrow"\)/);
    assert.match(calls[1], /\.close\(false\)/);
    assert.deepEqual(events, ["selectTool:arrow", "selectNone", "close:false"]);
    assert.deepEqual(documents, [other]);
});

test("shared unsaved-document cleanup validates its exact unsaved name before separate close", async () => {
    const events = [];
    const calls = [];
    const documents = [];
    const target = fakeDocument("Untitled-1", undefined, events, documents);
    const other = fakeDocument("user.fla", pathToFileURL("/tmp/user.fla").href, events, documents);
    documents.push(target, other);
    const runJsfl = fakeRunJsfl(fakeGlobals(documents, events), calls);

    await closeUnsavedDocumentByName(runJsfl, target.name);

    assert.equal(calls.length, 2);
    assert.match(calls[0], /__closeDocumentRequireUnsaved = true/);
    assert.match(calls[0], /fl\.selectTool\("arrow"\)/);
    assert.match(calls[1], /\.close\(false\)/);
    assert.deepEqual(events, ["selectTool:arrow", "selectNone", "close:false"]);
    assert.deepEqual(documents, [other]);
});

test("shared cleanup refuses Arrow-tool failures, missing targets, and non-disposable unsaved targets", async () => {
    for (const selectTool of [
        () => false,
        () => {
            throw new Error("selection failed");
        },
    ]) {
        const events = [];
        const calls = [];
        const documents = [];
        const targetPath = pathToFileURL("/tmp/disposable.fla").href;
        const target = fakeDocument("disposable.fla", targetPath, events, documents);
        documents.push(target);
        const runJsfl = fakeRunJsfl(fakeGlobals(documents, events, selectTool), calls);

        await assert.rejects(closeDocumentByPath(runJsfl, targetPath), /Arrow tool selection|selection failed/);
        assert.equal(calls.length, 1);
        assert.deepEqual(events, ["selectTool:arrow"]);
        assert.deepEqual(documents, [target]);
    }

    for (const documents of [
        [],
        [
            fakeDocument("Untitled-1", pathToFileURL("/tmp/a.fla").href, [], []),
            fakeDocument("Untitled-1", pathToFileURL("/tmp/b.fla").href, [], []),
        ],
        [fakeDocument("Untitled-1", pathToFileURL("/tmp/Untitled-1.fla").href, [], [])],
    ]) {
        const events = [];
        const calls = [];
        const originalDocuments = [...documents];
        const runJsfl = fakeRunJsfl(fakeGlobals(documents, events), calls);
        let targetError = /expected the exact disposable document to be unsaved/i;
        if (documents.length === 0) {
            targetError = /matched 0 open documents/;
        }
        if (documents.length > 1) {
            targetError = /matched 2 open documents/;
        }

        await assert.rejects(closeUnsavedDocumentByName(runJsfl, "Untitled-1"), targetError);
        assert.equal(calls.length, 1);
        assert.deepEqual(events, []);
        assert.deepEqual(documents, originalDocuments);
    }
});

test("fixture-creation failure closes its owned unsaved document in a separate Arrow Run", async () => {
    const events = [];
    const calls = [];
    let created;
    const documents = [];
    const fake = fakeDocument("failed-fixture.fla", undefined, events, documents);
    const globals = fakeGlobals(documents, events);
    globals.fl.createDocument = (_type, _width, _height, _frameRate) => {
        created = fake;
        documents.push(created);
    };
    globals.fl.getDocumentDOM = () => created;
    globals.fl.saveDocument = () => false;
    const runJsfl = fakeRunJsfl(globals, calls);

    await assert.rejects(
        createSavedAs3Document(runJsfl, pathToFileURL("/tmp/failed-fixture.fla").href, ""),
        /fl\.saveDocument returned false/,
    );

    assert.equal(calls.length, 3);
    assert.ok(calls[0].includes("fl.saveDocument"));
    assert.ok(calls[1].includes('fl.selectTool("arrow")'));
    assert.ok(calls[2].includes(".close(false)"));
    assert.deepEqual(events, ["selectTool:arrow", "selectNone", "close:false"]);
    assert.deepEqual(documents, []);
});
