import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

test("read_output returns raw panels and parsed compiler diagnostics without changing Animate state", {
    timeout: 20_000,
}, async () => {
    const outputPanel = "trace: first\nTypeError: #1009\ntrace: 🍣";
    const compilerErrorsPanel =
        "**Error** Scene 1, Layer 'Layer_1', Frame 1, Line 2, Column 5\t1172: Definition foo:Bar could not be found.\n**Warning** Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7\tWarning: 1098: Illogical comparison.\n\n1 Error(s), 1 Warning(s)";
    await withServer(
        { FAKE_OUTPUT_PANEL: outputPanel, FAKE_COMPILER_PANEL: compilerErrorsPanel },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "read_output" });
            const expected = {
                outputPanel,
                compilerErrorsPanel,
                compilerDiagnostics: {
                    status: "parsed",
                    errors: [
                        {
                            location: "Scene 1, Layer 'Layer_1', Frame 1, Line 2, Column 5",
                            line: 2,
                            column: 5,
                            code: "1172",
                            message: "Definition foo:Bar could not be found.",
                        },
                    ],
                    warnings: [
                        {
                            location: "Scene 1, Layer 'Layer_1', Frame 1, Line 3, Column 7",
                            line: 3,
                            column: 7,
                            code: "1098",
                            message: "Illogical comparison.",
                        },
                    ],
                },
                note: "Panel contents may be stale or mixed; Animate does not identify their source document or run. An unavailable compilerDiagnostics status does not mean a clean compile.",
            };
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, expected);
            assert.equal(text(result), JSON.stringify(expected));
            assert.deepEqual((await readFile(join(tempDir, "log.read-output"), "utf8")).trim().split("\n"), [
                "outputPanel.save",
                "compilerErrors.save",
                "outputPanel.remove",
                "compilerErrors.remove",
            ]);
            assert.deepEqual((await readFile(join(tempDir, "log"), "utf8")).trim().split("\n"), ["start", "end"]);
            await assert.rejects(readFile(join(tempDir, "log.publish"), "utf8"), { code: "ENOENT" });
        },
    );
});

test("read_output preserves empty and incomplete compiler panels without claiming verified diagnostics", {
    timeout: 20_000,
}, async () => {
    for (const compilerErrorsPanel of ["", "**Error** incomplete output"]) {
        await withServer({ FAKE_OUTPUT_PANEL: "", FAKE_COMPILER_PANEL: compilerErrorsPanel }, async (client) => {
            const result = await client.callTool({ name: "read_output" });
            assert.equal(result.isError, undefined, text(result));
            assert.deepEqual(result.structuredContent, {
                outputPanel: "",
                compilerErrorsPanel,
                compilerDiagnostics: { status: "unavailable", errors: [], warnings: [] },
                note: "Panel contents may be stale or mixed; Animate does not identify their source document or run. An unavailable compilerDiagnostics status does not mean a clean compile.",
            });
        });
    }
});

test("read_output keeps Output text when Animate cannot save the Compiler Errors panel", {
    timeout: 20_000,
}, async () => {
    const outputPanel = "trace: canvas output";
    await withServer({ FAKE_OUTPUT_PANEL: outputPanel, FAKE_TYPE: "htmlcanvas" }, async (client) => {
        const result = await client.callTool({ name: "read_output" });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            outputPanel,
            compilerErrorsPanel: "",
            compilerDiagnostics: { status: "unavailable", errors: [], warnings: [] },
            note: "Panel contents may be stale or mixed; Animate does not identify their source document or run. An unavailable compilerDiagnostics status does not mean a clean compile.",
        });
    });
});
