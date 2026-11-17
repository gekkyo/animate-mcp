import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { text, withServer } from "../helpers/fake-animate.js";

// Refresh fixtures after a real-Animate smoke run with node server/verification/smoke/lib/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>.
const fixtureDir = join(process.cwd(), "server/test/fixtures/real-shapes");
const TMP_TOKEN = "$" + "{TMP}";
const fixtures = readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
        tool: name.slice(0, -5),
        ...JSON.parse(readFileSync(join(fixtureDir, name), "utf8")),
    }));

/**
 * Replaces path placeholders in representative fixture arguments.
 * @param value Fixture argument value
 * @param tempDir Per-test temporary directory
 * @returns Arguments with local paths
 */
function restorePaths(value: unknown, tempDir: string): unknown {
    if (typeof value === "string") {
        return value.replaceAll(TMP_TOKEN, tempDir);
    }
    if (Array.isArray(value)) {
        return value.map((item) => restorePaths(item, tempDir));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restorePaths(item, tempDir)]));
    }
    return value;
}

/**
 * Returns the runtime type used for top-level shape comparison.
 * @param value Result value
 * @returns Primitive, object, or array type
 */
function resultType(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}

/**
 * Creates minimal disposable inputs referenced by a recorded fixture.
 * @param value Fixture arguments
 * @param tempDir Per-test temporary directory
 * @param tool Tool name
 * @param role Argument field that identifies the input's role
 * @returns Nothing
 */
function prepareInputs(value: unknown, tempDir: string, tool: string, role = ""): void {
    if (typeof value === "string") {
        const restored = value.replaceAll(TMP_TOKEN, tempDir);
        if (restored === value || !/\.(?:fla|png|wav|mp3)$/i.test(restored)) {
            return;
        }
        if (tool === "save_document") {
            return;
        }
        mkdirSync(join(restored, ".."), { recursive: true });
        if (/\.fla$/i.test(restored)) {
            writeFileSync(restored, "");
        } else if (/\.png$/i.test(restored)) {
            const pixel = role === "after" ? [255, 0, 0, 255] : [0, 0, 0, 255];
            writeFileSync(restored, PNG.sync.write({ width: 1, height: 1, data: Buffer.from(pixel) }));
        } else {
            writeFileSync(restored, "");
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => {
            prepareInputs(item, tempDir, tool, role);
        });
    } else if (value && typeof value === "object") {
        Object.entries(value).forEach(([key, item]) => {
            prepareInputs(item, tempDir, tool, key);
        });
    }
}

/**
 * Selects the fake document identity and type used by one fixture replay.
 * @param tool Tool name
 * @param args Recorded fixture arguments
 * @param tempDir Per-test temporary directory
 * @returns Fake Animate environment
 */
function replayEnvironment(tool: string, args: Record<string, unknown>, tempDir: string): Record<string, string> {
    const document = typeof args.document === "string" ? (args.document.split(/[\\/]/).pop() ?? "a.fla") : "a.fla";
    const isCanvas = /canvas/i.test(document) || tool === "verify_canvas_output";
    return {
        FAKE_DOCUMENT_NAME: document,
        HOME: tempDir,
        ...(tool === "edit_tween"
            ? { FAKE_SECOND_LAYER: "CanvasSmokeTween", FAKE_SECOND_LAYER_INSTANCE: "CanvasSmokeInstance" }
            : {}),
        ...(tool === "get_air_descriptor" || tool === "set_air_descriptor"
            ? { FAKE_PLAYER_TARGET: "AIR 51.3.1.2 for Desktop" }
            : {}),
        ...(isCanvas ? { FAKE_TYPE: "htmlcanvas" } : {}),
    };
}

/**
 * Adjusts recorded targets to the equivalent disposable fake document.
 * @param tool Tool name
 * @param args Recorded fixture arguments
 * @returns Replay arguments
 */
function replayArguments(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    const replay = structuredClone(args);
    if (tool === "close_document") {
        replay.document = "recorded-path.fla";
    } else if (tool === "convert_to_symbol") {
        replay.elements = [{ layer: 0, element: 0 }];
    } else if (tool === "edit_elements") {
        replay.ops = [{ layer: "a/b", frame: 1, element: 0, set: { name: "CanvasSmokeInstance", x: 72, y: 88 } }];
    } else if (tool === "edit_library") {
        replay.ops = [
            { op: "createFolder", path: "CanvasSmokeFolder" },
            { op: "renameItem", item: "dir/Hero", newName: "CanvasSmokeRenamedSymbol" },
        ];
    } else if (tool === "edit_tween") {
        replay.ops = [
            {
                ...(replay.ops as Record<string, unknown>[])[0],
                layer: "CanvasSmokeTween",
                instance: "CanvasSmokeInstance",
                keyframes: [
                    { frame: 1, x: 72, y: 88 },
                    { frame: 3, x: 162, y: 88 },
                ],
            },
        ];
    } else if (tool === "save_document") {
        replay.confirm = true;
    }
    return replay;
}

test("fake tool results remain compatible with recorded real Animate shapes", { timeout: 120_000 }, async (t) => {
    let replayed = 0;
    for (const fixture of fixtures) {
        await t.test(fixture.tool, async () => {
            const args = (fixture.arguments ?? {}) as Record<string, unknown>;
            await withServer(
                (tempDir) => replayEnvironment(fixture.tool, args, tempDir),
                async (client, tempDir) => {
                    prepareInputs(args, tempDir, fixture.tool);
                    if (fixture.tool === "get_air_descriptor" || fixture.tool === "set_air_descriptor") {
                        mkdirSync(join(tempDir, "document"), { recursive: true });
                        writeFileSync(
                            join(tempDir, "document", "desktop-app.xml"),
                            '<application xmlns="http://ns.adobe.com/air/application/1.0"><id>example</id><versionNumber>1.0</versionNumber><versionLabel>Smoke</versionLabel><filename>desktop</filename><initialWindow><content>desktop.swf</content><renderMode>auto</renderMode><aspectRatio>landscape</aspectRatio><autoOrients>true</autoOrients><fullScreen>false</fullScreen></initialWindow><icon/><extensions/></application>',
                        );
                    }
                    if (fixture.tool === "verify_canvas_output") {
                        mkdirSync(join(tempDir, "document"), { recursive: true });
                        const documentName = String(args.document).split(/[\\/]/).pop() ?? "a.fla";
                        writeFileSync(
                            join(tempDir, "document", `${documentName.replace(/\.fla$/i, "")}.html`),
                            "<!doctype html><title>smoke</title>",
                        );
                    }
                    const toolArgs = restorePaths(replayArguments(fixture.tool, args), tempDir);
                    if (fixture.tool === "apply_scripts") {
                        const metadataResult = await client.callTool({
                            name: "search_tools",
                            arguments: { query: "export_scripts" },
                        });
                        const metadata = JSON.parse(text(metadataResult));
                        const entrance =
                            metadata.annotations?.readOnlyHint === true ? "execute_readonly" : "execute_write";
                        const exported = await client.callTool({
                            name: entrance,
                            arguments: {
                                name: "export_scripts",
                                arguments: { dir: (toolArgs as Record<string, unknown>).dir },
                            },
                        });
                        assert.notEqual(exported.isError, true, `apply_scripts setup failed: ${text(exported)}`);
                    }
                    const result =
                        fixture.tool === "run_jsfl"
                            ? await client.callTool({ name: fixture.tool, arguments: toolArgs })
                            : await (async () => {
                                  const metadataResult = await client.callTool({
                                      name: "search_tools",
                                      arguments: { query: fixture.tool },
                                  });
                                  const metadata = JSON.parse(text(metadataResult));
                                  const entrance =
                                      metadata.annotations?.readOnlyHint === true
                                          ? "execute_readonly"
                                          : "execute_write";
                                  return client.callTool({
                                      name: entrance,
                                      arguments: { name: fixture.tool, arguments: toolArgs },
                                  });
                              })();
                    assert.notEqual(result.isError, true, `fake replay failed for ${fixture.tool}: ${text(result)}`);
                    assert.ok(
                        result.structuredContent,
                        `fake replay returned no structuredContent for ${fixture.tool}`,
                    );
                    replayed++;
                    const actual = result.structuredContent as Record<string, unknown>;
                    const expectedKeys = Object.keys(fixture.shape);
                    for (const key of expectedKeys) {
                        if (fixture.optionalKeys.includes(key) && !(key in actual)) {
                            continue;
                        }
                        assert.ok(key in actual, `missing real result key ${key}`);
                        let expectedType = "object";
                        if (Array.isArray(fixture.shape[key])) {
                            expectedType = "array";
                        } else if (typeof fixture.shape[key] === "string") {
                            expectedType = fixture.shape[key];
                        }
                        assert.ok(
                            expectedType.split("|").includes(resultType(actual[key])),
                            `type mismatch for ${key}: ${JSON.stringify(actual[key])}`,
                        );
                    }
                    assert.deepEqual(Object.keys(actual).sort(), expectedKeys.filter((key) => key in actual).sort());
                },
                { entrances: true },
            );
        });
    }
    assert.equal(replayed, fixtures.length, "every real-shape fixture must replay");
    console.log(`Real-shape replay: ${replayed} replayed, ${fixtures.length} fixtures.`);
});
