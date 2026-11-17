import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { scoped } from "../lib/mcp-server.mjs";
import {
    assertScriptInvestigationReply,
    assertSuccessfulScriptEdit,
    assertSuccessfulScriptInvestigation,
} from "../scenarios/scripts.mjs";
import { readExportFile, writeExportScript } from "../lib/workspace.mjs";

test("script investigation requires a successful read-only export/read and fixture-specific diagnosis", () => {
    assertSuccessfulScriptInvestigation(
        '{"targetTool":"get_status","succeeded":true}\n{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"read_export_file","succeeded":true}',
    );
    for (const trace of [
        '{"targetTool":"export_scripts","succeeded":false}\n{"targetTool":"read_export_file","succeeded":true}',
        '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"read_export_file","succeeded":false}',
        '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"write_export_script","succeeded":true}',
    ]) {
        assert.throws(() => assertSuccessfulScriptInvestigation(trace));
    }
    assertScriptInvestigationReply("readmeTotal has a missing closing parenthesis after the expression.");
    assert.throws(
        () => assertScriptInvestigationReply("The expression is missing a closing parenthesis."),
        /identify the fixture script/,
    );
    assert.throws(
        () => assertScriptInvestigationReply("readmeTotal has an undefined variable."),
        /missing closing parenthesis/,
    );
});

test("script export bridge only reads and writes the manifested scene-one frame-one AS3 script", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readme-script-bridge-"));
    const exportDir = join(directory, "export");
    const script = "scenes/Scene 1/Layer 1/1.as";
    const target = join(exportDir, script);
    try {
        await mkdir(join(exportDir, "scenes", "Scene 1", "Layer 1"), { recursive: true });
        await writeFile(target, 'trace("readme initial");');
        await writeFile(join(exportDir, "index.md"), "scene index");
        const structure = `scene structure\nscript: ${script}`;
        await writeFile(join(exportDir, "scenes", "Scene 1", "structure.md"), structure);
        await writeFile(
            join(exportDir, ".export.json"),
            JSON.stringify({
                type: "Flash",
                files: {
                    [script]: { scene: 0, layer: 0, start: 0, script: 'trace("readme initial");' },
                    "scenes/Scene 2/Layer 1/1.as": { scene: 1, layer: 0, start: 0, script: "other scene" },
                },
                timelines: [
                    { dir: "scenes/Scene 1", scene: 0, layers: [] },
                    { dir: "scenes/Scene 2", scene: 1, layers: [] },
                ],
            }),
        );
        assert.deepEqual((await readExportFile(exportDir, "index.md")).data, { content: "scene index" });
        const structureResult = await readExportFile(exportDir, "scenes/Scene 1/structure.md");
        assert.deepEqual(structureResult.data, { content: structure });
        const discoveredScriptPath = structureResult.data.content.split("script: ")[1];
        assert.deepEqual((await readExportFile(exportDir, discoveredScriptPath)).data, {
            content: 'trace("readme initial");',
        });
        await assert.rejects(writeExportScript(exportDir, "index.md", "overwritten"), /may be written/);
        await assert.rejects(
            writeExportScript(exportDir, "scenes/Scene 1/structure.md", "overwritten"),
            /may be written/,
        );
        await writeExportScript(exportDir, script, 'trace("readme initial");\nstop();');
        assert.match((await readExportFile(exportDir, script)).data.content, /stop\(\)/);
        for (const badPath of [
            "../secret.as",
            "/tmp/secret.as",
            "scenes\\Scene 1\\Layer 1\\1.as",
            "scenes/Scene 1/Layer 1/2.as",
            "scenes/Scene 2/Layer 1/1.as",
            "scenes/Scene 2/structure.md",
            "scenes/Scene 1/structure.md/1.as",
            "other.md",
            "scenes/Scene 1/Layer 1/\0.as",
        ]) {
            await assert.rejects(readExportFile(exportDir, badPath));
        }
        await assert.rejects(writeExportScript(exportDir, script, "x".repeat(64 * 1024 + 1)), /64 KB/);
        await rm(target);
        await symlink(join(directory, "outside.as"), target);
        await writeFile(join(directory, "outside.as"), "outside");
        await assert.rejects(readExportFile(exportDir, script));
        await rm(target);
        await rm(join(exportDir, "scenes", "Scene 1", "Layer 1"), { recursive: true });
        await symlink(directory, join(exportDir, "scenes", "Scene 1", "Layer 1"));
        await assert.rejects(readExportFile(exportDir, script), /symlinks/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("script trace requires export, file write, then successful apply", () => {
    assertSuccessfulScriptEdit(
        [
            { targetTool: "export_scripts", succeeded: true },
            { targetTool: "read_export_file", succeeded: true },
            { targetTool: "write_export_script", succeeded: true },
            { targetTool: "apply_scripts", succeeded: true },
        ]
            .map((entry) => JSON.stringify(entry))
            .join("\n"),
    );
    assert.throws(
        () =>
            assertSuccessfulScriptEdit(
                '{"targetTool":"export_scripts","succeeded":true}\n{"targetTool":"apply_scripts","succeeded":true}',
            ),
        /Expected successful export/,
    );
});

test("script export/apply pin paths, document, and force to disposable values", async () => {
    const captured = [];
    /** Returns the sole exact disposable document used by the scope wrapper.
     * @returns Status result.
     */
    const checkStatus = async () => ({
        data: { documents: [{ path: "file:///tmp/disposable.fla", name: "disposable.fla" }] },
    });
    for (const [name, input, data] of [
        ["export_scripts", { dir: "/tmp/readme-e2e/export", force: false, document: "user.fla" }, { failed: [] }],
        [
            "apply_scripts",
            { dir: "/tmp/readme-e2e/export", document: "user.fla" },
            { failed: [], applied: ["scenes/Scene 1/as/1.as"] },
        ],
    ]) {
        const wrapped = scoped(
            {
                name,
                run: async (args) => {
                    captured.push(args);
                    return { data };
                },
            },
            "file:///tmp/disposable.fla",
            checkStatus,
            "/tmp/readme-e2e",
        );
        await wrapped.run(input, {}, {});
    }
    assert.equal(captured[0].document, "disposable.fla");
    assert.equal(captured[0].force, false);
    assert.match(captured[0].dir, /export$/);
    assert.equal(captured[1].document, "disposable.fla");
    assert.match(captured[1].dir, /export$/);
    const unsafe = scoped(
        { name: "export_scripts", run: async () => assert.fail("Unsafe export ran") },
        "file:///tmp/disposable.fla",
        checkStatus,
        "/tmp/readme-e2e",
    );
    await assert.rejects(unsafe.run({ dir: "/user/path", force: true }, {}, {}), /export dir is pinned/);
    const unsafeApply = scoped(
        { name: "apply_scripts", run: async () => assert.fail("Unsafe apply ran") },
        "file:///tmp/disposable.fla",
        checkStatus,
        "/tmp/readme-e2e",
    );
    await assert.rejects(unsafeApply.run({ dir: "/user/path" }, {}, {}), /apply dir must be/);
});

test("script MCP discovery exposes only scoped script workflow tools", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-e2e",
            README_PROMPT_E2E_SCENARIO: "script",
        },
    });
    const client = new Client({ name: "readme-e2e-script-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const [name, expected] of [
            ["read_export_file", /Relative file inside the disposable export/],
            ["write_export_script", /Exact relative frame-one AS3 script path/],
        ]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.match(definition.inputSchema.properties.file.description, expected);
        }
        for (const name of ["run_jsfl", "edit_timeline", "read_file"]) {
            const result = await client.callTool({ name: "execute_write", arguments: { name, arguments: {} } });
            assert.equal(result.isError, true, `${name} was not rejected`);
        }
    } finally {
        await client.close();
    }
});

test("investigation MCP discovery exposes only get_status, export_scripts, and read_export_file", async () => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [new URL("./runner.mjs", import.meta.url).pathname, "--mcp-server"],
        env: {
            ...process.env,
            README_E2E_DOCUMENT_URI: "file:///tmp/disposable.fla",
            README_E2E_OUT_DIR: "/tmp/disposable-e2e",
            README_PROMPT_E2E_SCENARIO: "investigate",
        },
    });
    const client = new Client({ name: "readme-e2e-investigate-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(({ name }) => name).sort(), ["execute_readonly", "execute_write", "search_tools"]);
        for (const name of ["get_status", "export_scripts", "read_export_file"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            const definition = JSON.parse(result.content[0].text);
            assert.equal(definition.name, name);
            if (name === "read_export_file") {
                assert.match(definition.inputSchema.properties.file.description, /metadata path/);
            }
        }
        for (const name of ["write_export_script", "apply_scripts", "read_file", "write_file", "run_jsfl"]) {
            const result = await client.callTool({ name: "search_tools", arguments: { query: name } });
            assert.notEqual(JSON.parse(result.content[0].text).name, name, `${name} was discoverable`);
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
