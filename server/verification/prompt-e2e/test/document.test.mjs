import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PNG } from "pngjs";
import { scoped } from "../lib/mcp-server.mjs";
import {
    assertAssetsFixtureAvailable,
    assertAssetsImported,
    assertLibraryDocumentUnchanged,
    assertLibraryFixture,
    assertLibraryReply,
    assertPinnedAssetPaths,
    assertSuccessfulAssetsImport,
    assertSuccessfulLibraryListing,
    readAssetsDocumentState,
} from "../scenarios/document.mjs";
import { createAssetsFixture } from "../scenarios/scenarios.mjs";

test("assets scenario generates disposable fixtures and substitutes their absolute paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-assets-"));
    try {
        const fixture = await createAssetsFixture(directory);
        assert.deepEqual(fixture.paths, [join(directory, "hero.png"), join(directory, "bgm.mp3")]);
        assert.ok(fixture.paths.every((path) => path.startsWith("/")));
        assert.equal(fixture.prompt, `${fixture.paths[0]} と ${fixture.paths[1]} をライブラリに取り込んで`);
        assert.doesNotMatch(fixture.prompt, /\/path\/to\//);
        const png = PNG.sync.read(await readFile(fixture.paths[0]));
        assert.equal(png.width, 1);
        assert.equal(png.height, 1);
        const mp3 = await readFile(fixture.paths[1]);
        assert.ok(mp3.length > 128, "MP3 fixture is empty or truncated");
        assert.ok(mp3.subarray(0, 3).equals(Buffer.from("ID3")) || mp3[0] === 0xff, "MP3 frame header is missing");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("assets import is pinned to exactly the two fixtures and traces a successful import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-assets-scope-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.PROMPT_E2E_TRACE_PATH;
    process.env.PROMPT_E2E_TRACE_PATH = tracePath;
    const pinnedPaths = [join(directory, "hero.png"), join(directory, "bgm.mp3")];
    const calls = [];
    const wrapped = scoped(
        {
            name: "import_assets",
            run: async (input) => {
                calls.push(input);
                return { data: { document: "disposable.fla", items: ["hero.png", "bgm.mp3"] } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({
            data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
        }),
        directory,
        pinnedPaths,
    );
    try {
        assert.deepEqual(assertPinnedAssetPaths([...pinnedPaths].reverse(), pinnedPaths), pinnedPaths);
        for (const paths of [
            [...pinnedPaths, join(directory, "extra.png")],
            [pinnedPaths[0], pinnedPaths[0]],
            [pinnedPaths[0], "/tmp/arbitrary.mp3"],
            ["relative.png", pinnedPaths[1]],
        ]) {
            assert.throws(() => assertPinnedAssetPaths(paths, pinnedPaths), /exactly the pinned PNG and MP3/);
            await assert.rejects(wrapped.run({ paths }, {}, {}), /exactly the pinned PNG and MP3/);
        }
        await writeFile(tracePath, "");
        await wrapped.run({ paths: [...pinnedPaths].reverse(), document: "user.fla" }, {}, {});
        assert.deepEqual(calls, [{ paths: pinnedPaths, document: "disposable.fla" }]);
        assertSuccessfulAssetsImport(await readFile(tracePath, "utf8"));
        for (const trace of [
            '{"targetTool":"import_assets","succeeded":false}',
            '{"targetTool":"import_assets","succeeded":true}\n{"targetTool":"run_jsfl","succeeded":true}',
            '{"targetTool":"get_status","succeeded":true}',
        ]) {
            assert.throws(() => assertSuccessfulAssetsImport(trace));
        }
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.PROMPT_E2E_TRACE_PATH;
        } else {
            process.env.PROMPT_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("trusted assets readback requires both Library items and an unchanged stage", async () => {
    const before = "550\t400\t24\t#ffffff\n--LIBRARY--\n\n--STAGE--\n0\t0\tLayer 1\t0\t1\t\t0";
    const after = "550\t400\t24\t#ffffff\n--LIBRARY--\nbgm.mp3\nhero.png\n--STAGE--\n0\t0\tLayer 1\t0\t1\t\t0";
    assertAssetsFixtureAvailable(before);
    assertAssetsImported(before, after);
    assert.throws(() => assertAssetsFixtureAvailable(after), /already contains a fixture Library item name/);
    for (const invalid of [
        before.replace("#ffffff", "#000000"),
        after.replace("hero.png", "hero-copy.png"),
        after.replace("bgm.mp3\nhero.png", "bgm.mp3\nhero.png\nextra.png"),
    ]) {
        assert.throws(() => assertAssetsImported(before, invalid));
    }
    await assert.rejects(
        readAssetsDocumentState(
            async () => ({ structuredContent: { result: "READ_ERROR:document" } }),
            async () => ({ structuredContent: { documents: [{ path: "file:///tmp/disposable.fla" }] } }),
            "file:///tmp/disposable.fla",
        ),
        /Trusted assets verification failed/,
    );
});

test("library scenario requires only the successful listUnused operation and the exact unused reply", () => {
    assertSuccessfulLibraryListing(
        '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"edit_library","succeeded":true}',
    );
    for (const trace of [
        '{"targetTool":"edit_library","succeeded":false}',
        '{"targetTool":"edit_library","succeeded":true}\n{"targetTool":"edit_timeline","succeeded":true}',
    ]) {
        assert.throws(() => assertSuccessfulLibraryListing(trace));
    }
    assertLibraryReply("Unused library item: unused_mc");
    assert.throws(() => assertLibraryReply("Unused library item: used_mc"), /omitted the unused item/);
    assert.throws(() => assertLibraryReply("unused_mc and used_mc"), /included the used item/);
    assertLibraryReply("unused_mc");
    assertLibraryFixture("2\n1\nunused_mc\tused_mc\nunused_mc");
    for (const invalid of [
        "2\n1\nunused_mc\tused_mc\n",
        "2\n2\nunused_mc\tused_mc\nunused_mc",
        "2\n1\nunused_mc\tused_mc\nunused_mc\tused_mc",
        "3\n1\nunused_mc\tused_mc\nunused_mc",
    ]) {
        assert.throws(() => assertLibraryFixture(invalid));
    }
    const before = "2\n1\nunused_mc\tused_mc\nunused_mc";
    assertLibraryDocumentUnchanged(before, before);
    for (const after of [
        "3\n1\nextra_mc\tunused_mc\tused_mc\nunused_mc",
        "2\n2\nunused_mc\tused_mc\nunused_mc",
        "2\n1\nunused_mc\tother_mc\nunused_mc",
    ]) {
        assert.throws(() => assertLibraryDocumentUnchanged(before, after));
    }
});

test("library scope permits only listUnused and records no tool inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-library-trace-"));
    const tracePath = join(directory, "trace.jsonl");
    const previousTracePath = process.env.PROMPT_E2E_TRACE_PATH;
    process.env.PROMPT_E2E_TRACE_PATH = tracePath;
    const calls = [];
    const wrapped = scoped(
        {
            name: "edit_library",
            run: async (input) => {
                calls.push(input);
                return { data: { applied: input.ops, failed: null } };
            },
        },
        "file:///tmp/disposable.fla",
        async () => ({ data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] } }),
    );
    try {
        await wrapped.run({ ops: [{ op: "listUnused" }] }, {}, {});
        await assert.rejects(
            wrapped.run({ ops: [{ op: "deleteItem", item: "used_mc", confirm: true }] }, {}, {}),
            /only the read-only listUnused operation/,
        );
        assert.equal(calls.length, 1);
        const trace = (await readFile(tracePath, "utf8")).trim().split("\n");
        assertSuccessfulLibraryListing(trace.join("\n"));
        assert.deepEqual(
            trace.map((line) => {
                const entry = JSON.parse(line);
                assert.equal("input" in entry, false);
                assert.equal("arguments" in entry, false);
                return [entry.targetTool, entry.succeeded];
            }),
            [
                ["edit_library", true],
                ["edit_library", false],
            ],
        );
    } finally {
        if (previousTracePath === undefined) {
            delete process.env.PROMPT_E2E_TRACE_PATH;
        } else {
            process.env.PROMPT_E2E_TRACE_PATH = previousTracePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("get_document_info is scoped without an invented document selector", async () => {
    let args;
    let calls = 0;
    const tool = {
        name: "get_document_info",
        run: async (input) => {
            args = input;
            calls += 1;
            return { data: {} };
        },
    };
    const safe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    }));
    await safe.run({}, {}, {});
    assert.deepEqual(args, {});

    const unsafe = scoped(tool, "file:///tmp/disposable.fla", async () => ({
        data: {
            documents: [
                { path: "file:///tmp/disposable.fla", name: "disposable.fla" },
                { path: "file:///tmp/user.fla", name: "user.fla" },
            ],
        },
    }));
    await assert.rejects(unsafe.run({}, {}, {}), /only the disposable FLA open/);
    assert.equal(calls, 1);
});

test("assets MCP discovery exposes only get_status and import_assets", async () => {
    const outDir = "/tmp/disposable-assets-e2e";
    const assetPaths = [join(outDir, "hero.png"), join(outDir, "bgm.mp3")];
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_OUT_DIR: outDir,
            PROMPT_E2E_ASSET_PATHS: JSON.stringify(assetPaths),
            PROMPT_E2E_SCENARIO: "assets",
        },
    });
    const client = new Client({ name: "prompt-e2e-assets-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "import_assets"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.equal(JSON.parse(result.content[0].text).name, name);
        }
        const result = await client.callTool({ name: "search_tools", arguments: { query: "import_assets" } });
        const schema = JSON.parse(result.content[0].text).inputSchema;
        assert.ok(schema.properties.paths);
        assert.ok(schema.properties.document);
        for (const name of ["run_jsfl", "open_document", "save_document"]) {
            const found = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(found.content[0].text).name, name, `${name} was discoverable`);
            const denied = await client.callTool({
                name: "execute_write",
                arguments: { name, arguments: {} },
            });
            assert.equal(denied.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("library MCP discovery exposes only get_status and edit_library", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("../runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            PROMPT_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            PROMPT_E2E_SCENARIO: "library",
        },
    });
    const client = new Client({ name: "prompt-e2e-library-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "edit_library"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "edit_library") {
                assert.equal(definition.annotations.readOnlyHint, false);
                assert.ok(definition.inputSchema.properties.ops);
                assert.match(definition.description, /list unused items/);
            }
        }
        for (const name of ["run_jsfl", "edit_timeline", "edit_elements", "save_document"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
        }
        const readOnly = await client.callTool({
            name: "execute_readonly",
            arguments: { name: "edit_library", arguments: { ops: [{ op: "listUnused" }] } },
        });
        assert.equal(readOnly.isError, true);
    } finally {
        await client.close();
    }
});
