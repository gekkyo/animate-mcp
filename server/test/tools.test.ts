import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTRUCTIONS, TOOLS } from "../src/index.js";
import { text, withServer } from "./helpers/fake-animate.js";

test("registry keeps all tools and the original client instructions", () => {
    assert.equal(TOOLS.length, 29);
    assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, 29);
    assert.equal(
        INSTRUCTIONS,
        `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; use save_document after asking the user before overwriting, or save in Animate.
- To add a script to a frame with none, create <timeline dir>/as/<frame>.as (or .js for HTML Canvas), avoid tween spans, and run apply_scripts.
- Use edit_timeline for layer or frame structure changes. shiftLayerFrames moves one layer's content later without shifting other layers. Always run export_scripts again before editing or applying scripts; delete operations require confirm: true.
- Use edit_elements to set instance properties on keyframes; tween interiors are refused, and the .fla is not saved.
- Use edit_text to add or update whole text fields; Canvas does not support input or single-line text. Use import_assets for images/audio and set_document_properties for stage settings; neither saves the .fla.
- Use inspect_timeline to check instances and tweens instead of run_jsfl; use the distributeToLayers operation to split a layer.
- Use edit_tween to animate instances; motion is the default and ease presets include quad, cubic, quart, quint, sine, expo, circ and back.
- Use edit_library to organize library folders and items. Re-export with export_scripts before apply_scripts; deleteItem requires confirm: true and refuses items in use.
- edit_library can also create/duplicate symbols and find direct usages; edit_elements can swap a symbol and set graphic loop/firstFrame.
- If a frame changed in Animate before you applied, Export is refused and Apply skips that frame. Export again to pull in the change.
- If get_document_info reports greensock: true, use TweenLite/TweenMax (import com.greensock.*). For AS3 with greensock: false, use fl.transitions.Tween or propose install_greensock (confirm: true; AS3 only).
- For HTML5 Canvas, use createjs.Tween; install_greensock does not support Canvas.
- Use publish to publish AS3 or HTML5 Canvas documents and check the Build result; outputs at the document's publish settings are overwritten. Canvas compile errors cannot be detected.
- Use capture_frame to inspect the active timeline as PNG images; request one frame or an inclusive range of up to 24 frames. It saves new images under ~/.animate-mcp/captures/<document>/ and restores the current frame.
- Use diff_captures with absolute before/after paths returned by capture_frame. It creates a non-overwriting red-highlight PNG alongside the earlier Capture.
- Use audit_document for read-only document hygiene suggestions. Review every finding before changing content; unused Library items may be intentional, especially when linkage is enabled.
- Use verify_canvas_output to check a published HTML5 Canvas page in Chrome. By default Publish overwrites the document's configured outputs; use publish: false to avoid publishing or htmlPath to specify custom output. Page scripts run in Chrome.
- Use get_air_descriptor to inspect AIR app settings; the AIR settings dialog's OK may rewrite its descriptor.
- Use set_air_descriptor to edit AIR app settings; dryRun first. The AIR settings dialog's OK may rewrite the descriptor.
- Use preflight_publish to review known risks before Publish. AIR signing, ambiguous output-file paths, and compilation are not verified.
- Save a named Baseline, then compare the same timeline and frames later. Saving over an existing Baseline requires overwrite: true.

Notes:
- When several documents are open, document is required. get_document_info returns the name.
- AS3 and HTML5 Canvas have different APIs. Check the document type before trying things with run_jsfl.
- Use read_output to inspect the current Output and Compiler Errors panels; their contents may be stale or mixed because Animate does not identify their source document or run.
- When a script fails with a null error, first check the layer's frame length and instance names with run_jsfl.
- If you add debug traces, always remove them after checking and Apply again.
- run_jsfl runs arbitrary code. Ask the user before any operation that modifies the document.`,
    );
});

test("get_document_info returns info, or a clear error with no document", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            name: "a.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            backgroundColor: "#FFFFFF",
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
            get_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            inspect_timeline: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            export_scripts: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
            edit_timeline: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            edit_elements: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            edit_text: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
            import_assets: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            set_document_properties: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            edit_tween: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            edit_library: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            apply_scripts: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
            publish: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            read_output: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            test_movie: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            capture_frame: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            diff_captures: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            audit_document: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            get_air_descriptor: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            set_air_descriptor: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            preflight_publish: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            visual_regression: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            verify_canvas_output: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true,
            },
            install_greensock: {
                readOnlyHint: false,
                destructiveHint: false,
                openWorldHint: true,
                idempotentHint: true,
            },
            open_document: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            save_document: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            close_document: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            convert_to_symbol: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            run_jsfl: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        };

        assert.deepEqual(
            [...byName.keys()].sort(),
            Object.keys(annotations).sort(),
            "every tool needs an annotations entry",
        );
        for (const definition of TOOLS) {
            const listed = byName.get(definition.name);
            assert.equal(listed?.description, definition.description, definition.name);
            const expectedSchema = definition.inputSchema as
                | (Record<string, unknown> & { shape?: Record<string, unknown> })
                | undefined;
            assert.deepEqual(
                Object.keys(listed?.inputSchema.properties ?? {}).sort(),
                Object.keys(expectedSchema?.shape ?? expectedSchema ?? {}).sort(),
                `${definition.name} input schema`,
            );
        }
        for (const [name, expected] of Object.entries(annotations)) {
            assert.deepEqual(byName.get(name)?.annotations, expected, name);
        }

        const runJsfl = byName.get("run_jsfl");
        assert.match(runJsfl?.description ?? "", /^Execute arbitrary code as JSFL.*last resort/i);
        assert.match(JSON.stringify(runJsfl?.inputSchema.properties?.code), /dedicated tools/i);
        for (const name of [
            "edit_timeline",
            "edit_elements",
            "edit_text",
            "edit_tween",
            "edit_library",
            "import_assets",
            "set_document_properties",
        ]) {
            assert.match(byName.get(name)?.description ?? "", /do not save the \.fla; use save_document/i, name);
        }
        assert.match(byName.get("publish")?.description ?? "", /overwrites outputs.*publish settings/i);
        assert.match(byName.get("publish")?.description ?? "", /compile errors are returned as a normal result/i);
        assert.match(byName.get("publish")?.description ?? "", /compilerOutput is "verified".*"unavailable"/i);
        assert.match(byName.get("read_output")?.description ?? "", /stale or mixed/i);
        assert.match(byName.get("read_output")?.description ?? "", /does not mean a clean compile/i);
        assert.match(
            byName.get("test_movie")?.description ?? "",
            /single Output-panel delta captured once two seconds after launch/i,
        );
        assert.match(byName.get("test_movie")?.description ?? "", /empty delta does not prove/i);
        assert.match(
            byName.get("publish")?.description ?? "",
            /HTML5 Canvas compilerOutput is "not_checked"; compile errors are unverified and ok only means Publish ran/i,
        );
    });
});
