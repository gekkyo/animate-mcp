import assert from "node:assert/strict";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

test("get_document_info returns info, or a clear error with no document", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            name: "a.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            timelines: ["Scene 1"],
            asVersion: "AS3",
            greensock: false,
        });
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(text(result), "No document open");
    });
});

test("tool metadata describes behavior and the run_jsfl last-resort boundary", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const { tools } = await client.listTools();
        const byName = new Map(tools.map((tool) => [tool.name, tool]));
        const annotations = {
            get_document_info: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            inspect_timeline: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            export_scripts: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
            edit_timeline: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            edit_tween: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            edit_library: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            apply_scripts: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
            install_greensock: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: true,
                idempotentHint: true,
            },
            run_jsfl: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        };

        for (const [name, expected] of Object.entries(annotations)) {
            assert.deepEqual(byName.get(name)?.annotations, expected, name);
        }

        const runJsfl = byName.get("run_jsfl");
        assert.match(runJsfl?.description ?? "", /^Execute arbitrary code as JSFL.*last resort/i);
        assert.match(JSON.stringify(runJsfl?.inputSchema.properties?.code), /dedicated tools/i);
        for (const name of ["edit_timeline", "edit_tween", "edit_library"]) {
            assert.match(byName.get(name)?.description ?? "", /do not save the \.fla; save it in Animate/i, name);
        }
    });
});
