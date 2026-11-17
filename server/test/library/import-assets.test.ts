import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { createJsflRunner, type ToolDeps } from "../../src/tools/core/shared.js";
import { registerImportAssets } from "../../src/tools/library/import-assets.js";

/**
 * Registers import_assets against a fake document and the validated JSFL seam.
 * @param document Fake document exposed to JSFL
 * @returns Tool-call helpers and recorded JSFL calls
 */
function setup(document: object) {
    let registered:
        | {
              annotations: Record<string, unknown>;
              inputSchema: z.ZodRawShape;
              handler: (input: unknown) => Promise<unknown>;
          }
        | undefined;
    const server = {
        registerTool(_name: string, options: Omit<NonNullable<typeof registered>, "handler">, handler: unknown) {
            registered = { ...options, handler: handler as (input: unknown) => Promise<unknown> };
        },
    };
    const jsflCalls: { entry: string; vars: Record<string, unknown> }[] = [];
    const runner: ToolDeps["runner"] = {
        execute: async (code) =>
            runInNewContext(code, {
                fl: { documents: [document] },
            }),
    };
    const jsflRunner = createJsflRunner(runner);
    const jsfl: ToolDeps["jsfl"] = {
        async run(entry, vars, schema, opts) {
            jsflCalls.push({ entry, vars });
            return jsflRunner.run(entry, vars, schema, opts);
        },
    };
    registerImportAssets(server as unknown as Parameters<typeof registerImportAssets>[0], {
        runner,
        jsfl,
    });
    assert.ok(registered);
    const tool = registered;
    const schema = z.object(tool.inputSchema);
    return {
        call: (input: Record<string, unknown>) => tool.handler(schema.parse(input)),
        annotations: tool.annotations,
        jsflCalls,
        schema,
    };
}

/**
 * Creates a fake document that records imports and Library selection.
 * @param existing Existing Library item paths
 * @returns Fake document and observable import state
 */
function makeDocument(existing: string[] = []) {
    const libraryItems = existing.map((name) => ({ name, itemType: name.includes(".") ? "bitmap" : "folder" }));
    const stage = [{ name: "stage-content" }];
    const importCalls: { uri: string; toLibrary: boolean; showDialog: boolean }[] = [];
    let selectedItems: { name: string; itemType: string }[] = [];
    const document = {
        name: "sample.fla",
        type: "Flash",
        stage,
        library: {
            items: libraryItems,
            itemExists: (name: string) => libraryItems.some((item) => item.name === name),
            getSelectedItems: () => selectedItems.slice(),
            selectNone() {
                selectedItems = [];
            },
            selectItem(name: string, replaceCurrentSelection = true) {
                const item = libraryItems.find((candidate) => candidate.name === name);
                if (!item) {
                    throw new Error(`missing fake Library item: ${name}`);
                }
                if (replaceCurrentSelection) {
                    selectedItems = [];
                }
                if (!selectedItems.includes(item)) {
                    selectedItems.push(item);
                }
            },
        },
        importFile(uri: string, toLibrary: boolean, showDialog: boolean) {
            importCalls.push({ uri, toLibrary, showDialog });
            const folder = selectedItems.find((item) => item.itemType === "folder");
            const name = basename(fileURLToPath(uri));
            libraryItems.push({ name: folder ? `${folder.name}/${name}` : name, itemType: "bitmap" });
            return true;
        },
    };
    return {
        document,
        importCalls,
        libraryItems,
        stage,
        selectedItems: () => selectedItems.map((item) => item.name),
    };
}

test("import_assets imports supported absolute files to the Library without changing the stage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-assets-"));
    try {
        const image = join(dir, "hero image.PNG");
        const sound = join(dir, "theme.mp3");
        await writeFile(image, "png");
        await writeFile(sound, "mp3");
        const appState = makeDocument();
        const app = setup(appState.document);
        assert.equal(app.annotations.destructiveHint, false);

        const result = (await app.call({ paths: [image, sound], document: "sample.fla" })) as {
            isError?: boolean;
            content?: { text: string }[];
            structuredContent: { document: string; items: string[] };
        };

        assert.equal(result.isError, undefined, result.content?.[0]?.text);
        assert.deepEqual(result.structuredContent, { document: "sample.fla", items: ["hero image.PNG", "theme.mp3"] });
        assert.deepEqual(appState.importCalls, [
            { uri: pathToFileURL(image).href, toLibrary: true, showDialog: false },
            { uri: pathToFileURL(sound).href, toLibrary: true, showDialog: false },
        ]);
        assert.deepEqual(appState.stage, [{ name: "stage-content" }]);
        assert.deepEqual(app.jsflCalls, [
            {
                entry: "library/import-assets",
                vars: {
                    __docName: "sample.fla",
                    __assets: [
                        { name: "hero image.PNG", uri: pathToFileURL(image).href },
                        { name: "theme.mp3", uri: pathToFileURL(sound).href },
                    ],
                },
            },
        ]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("import_assets validates every path before running Animate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-assets-"));
    try {
        const valid = join(dir, "valid.png");
        const unsupported = join(dir, "unsupported.svg");
        await writeFile(valid, "png");
        await writeFile(unsupported, "svg");
        const app = setup(makeDocument().document);
        for (const paths of [["relative.png"], [valid, unsupported], [join(dir, "missing.wav")]]) {
            const result = (await app.call({ paths })) as { isError: true; content: { text: string }[] };
            assert.equal(result.isError, true);
            assert.match(result.content[0].text, /absolute|supported|exist/i);
        }
        assert.deepEqual(app.jsflCalls, []);
        assert.equal(app.schema.safeParse({ paths: [] }).success, false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("import_assets refuses root and nested basename collisions before importing anything", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-assets-"));
    try {
        const first = join(dir, "new.png");
        const collision = join(dir, "taken.wav");
        await writeFile(first, "png");
        await writeFile(collision, "wav");
        const appState = makeDocument(["Assets", "Nested/taken.wav"]);
        appState.document.library.selectItem("Assets");
        const app = setup(appState.document);

        const result = (await app.call({ paths: [first, collision] })) as {
            isError: true;
            content: { text: string }[];
        };

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /already exists|collision/i);
        assert.deepEqual(appState.importCalls, []);
        assert.deepEqual(
            appState.libraryItems.map((item) => item.name),
            ["Assets", "Nested/taken.wav"],
        );
        assert.deepEqual(appState.selectedItems(), ["Assets"]);
        assert.deepEqual(app.jsflCalls, [
            {
                entry: "library/import-assets",
                vars: {
                    __docName: "",
                    __assets: [
                        { name: "new.png", uri: pathToFileURL(first).href },
                        { name: "taken.wav", uri: pathToFileURL(collision).href },
                    ],
                },
            },
        ]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("import_assets imports at the Library root and restores the selected folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-assets-"));
    try {
        const image = join(dir, "root-item.png");
        await writeFile(image, "png");
        const appState = makeDocument(["Assets"]);
        appState.document.library.selectItem("Assets");
        const app = setup(appState.document);

        const result = (await app.call({ paths: [image] })) as {
            structuredContent: { document: string; items: string[] };
        };

        assert.deepEqual(result.structuredContent.items, ["root-item.png"]);
        assert.ok(appState.libraryItems.some((item) => item.name === "root-item.png"));
        assert.ok(!appState.libraryItems.some((item) => item.name === "Assets/root-item.png"));
        assert.deepEqual(appState.selectedItems(), ["Assets"]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("import_assets reports earlier imports when a later file fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animate-assets-"));
    try {
        const first = join(dir, "first.png");
        const second = join(dir, "second.wav");
        await writeFile(first, "png");
        await writeFile(second, "wav");
        const appState = makeDocument();
        let calls = 0;
        const importFile = appState.document.importFile;
        appState.document.importFile = (uri, toLibrary, showDialog) => {
            calls++;
            if (calls === 2) {
                return false;
            }
            return importFile(uri, toLibrary, showDialog);
        };
        const app = setup(appState.document);

        const result = (await app.call({ paths: [first, second] })) as { isError: true; content: { text: string }[] };

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /already imported: first\.png/);
        assert.ok(appState.libraryItems.some((item) => item.name === "first.png"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
