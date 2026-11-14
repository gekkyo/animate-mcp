import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { registerConvertToSymbol } from "../src/tools/convert-to-symbol.js";

const jsflParts = {
    "select-document": readFileSync(new URL("../jsfl/shared/select-document.jsfl", import.meta.url), "utf8"),
    "edit-state": readFileSync(new URL("../jsfl/shared/edit-state.jsfl", import.meta.url), "utf8"),
    "export-common": readFileSync(new URL("../jsfl/shared/export-common.jsfl", import.meta.url), "utf8"),
    "convert-to-symbol": readFileSync(new URL("../jsfl/tools/convert-to-symbol.jsfl", import.meta.url), "utf8"),
};

function register(
    runner: { execute: (code: string) => Promise<unknown> },
    bundle: (...names: string[]) => string = () => "/* tool bundle */",
) {
    let registered:
        | {
              name: string;
              description: string;
              annotations: Record<string, unknown>;
              inputSchema: z.ZodRawShape;
              handler: (input: unknown) => Promise<unknown>;
          }
        | undefined;
    const server = {
        registerTool(
            name: string,
            options: Omit<NonNullable<typeof registered>, "name" | "handler">,
            handler: unknown,
        ) {
            registered = { name, ...options, handler: handler as (input: unknown) => Promise<unknown> };
        },
    };
    const bundleNames: string[][] = [];
    registerConvertToSymbol(server as never, {
        runner,
        bundle: (...names) => {
            bundleNames.push(names);
            return bundle(...names);
        },
    });
    assert.ok(registered);
    return { tool: registered, bundleNames };
}

function setupAnimate(tweenInterior = false) {
    const targetA = { name: "targetA", elementType: "instance", selected: false };
    const targetB = { name: "targetB", elementType: "shape", selected: false };
    const selectedForConversion = [targetA, targetB];
    const previousSelection = { name: "keepSelected", elementType: "instance", selected: true };
    const tweenStart = { startFrame: 0, tweenType: tweenInterior ? "motion" : "none", elements: [targetA] };
    const tweenMiddle = { startFrame: 0, tweenType: "none", elements: [targetA, previousSelection] };
    const timeline = {
        currentLayer: 1,
        currentFrame: 1,
        selectedFrames: [1, 1, 2],
        layers: [
            {
                name: "Artwork",
                layerType: "normal",
                locked: true,
                frames: [
                    tweenStart,
                    tweenInterior ? tweenMiddle : { startFrame: 1, tweenType: "none", elements: [previousSelection] },
                ],
            },
            {
                name: "Details",
                layerType: "normal",
                locked: true,
                frames: [
                    { startFrame: 0, tweenType: tweenInterior ? "motion" : "none", elements: [targetB] },
                    { startFrame: 1, tweenType: "none", elements: [] },
                ],
            },
        ],
        getSelectedFrames() {
            return this.selectedFrames.slice();
        },
        setSelectedFrames(frames: number[]) {
            this.selectedFrames = frames.slice();
            if (frames.length) {
                this.currentLayer = frames[0];
            }
        },
    };
    const libraryItems: { name: string; itemType: string }[] = [];
    let conversionCalls = 0;
    const document = {
        name: "sample.fla",
        type: "Flash",
        currentTimeline: 0,
        timelines: [timeline],
        library: {
            items: libraryItems,
            editItem() {
                throw new Error("unexpected library timeline");
            },
        },
        getTimeline: () => timeline,
        exitEditMode() {},
        editScene() {},
        get selection() {
            return timeline.layers
                .flatMap((layer) => layer.frames[timeline.currentFrame]?.elements ?? [])
                .filter((element) => element.selected);
        },
        selectNone() {
            for (const layer of timeline.layers) {
                for (const frame of layer.frames) {
                    for (const element of frame.elements) {
                        element.selected = false;
                    }
                }
            }
        },
        convertToSymbol(type: string, name: string, registrationPoint: string) {
            conversionCalls++;
            assert.deepEqual(this.selection.map((element) => element.name).sort(), ["targetA", "targetB"]);
            assert.equal(type, "movie clip");
            assert.equal(name, "Combined");
            assert.equal(registrationPoint, "center");
            assert.equal(timeline.layers[0].locked, false);
            assert.equal(timeline.layers[1].locked, false);
            for (const layer of timeline.layers) {
                layer.frames[0].elements = layer.frames[0].elements.filter(
                    (element) => !selectedForConversion.includes(element),
                );
            }
            timeline.layers[0].frames[0].elements.push({ name, elementType: "instance", selected: true });
            libraryItems.push({ name, itemType: type });
            return { name, itemType: type };
        },
    };
    const globals = {
        fl: {
            documents: [document],
            trace() {},
        },
    };
    const app = register(
        {
            execute: async (code) => runInNewContext(code, globals),
        },
        (...names) => names.map((name) => jsflParts[name as keyof typeof jsflParts]).join("\n"),
    );
    return {
        ...app,
        document,
        timeline,
        previousSelection,
        selectedForConversion,
        libraryItems,
        conversionCalls: () => conversionCalls,
    };
}

test("convert_to_symbol builds a targeted JSFL request and returns the handler result", async () => {
    let code = "";
    const { tool, bundleNames } = register({
        execute: async (value) => {
            code = value;
            return JSON.stringify({ name: "Hero", type: "movie clip", registrationPoint: "center" });
        },
    });
    const input = {
        timeline: "characters/Hero",
        document: "scene.fla",
        frame: 4,
        elements: [
            { layer: 1, element: 0 },
            { layer: "Foreground", element: "hand" },
        ],
        name: "Hero",
        type: "movie clip",
    };

    const result = (await tool.handler(z.object(tool.inputSchema).parse(input))) as {
        structuredContent: { name: string; type: string; registrationPoint: string };
    };

    assert.deepEqual(bundleNames, [["select-document", "edit-state", "export-common", "convert-to-symbol"]]);
    assert.match(code, /var __docName = "scene\.fla"/);
    assert.match(code, /var __timelineRef = "characters\/Hero"/);
    assert.match(code, /var __request = /);
    assert.match(code, /"registrationPoint":"center"/);
    assert.deepEqual(result.structuredContent, {
        name: "Hero",
        type: "movie clip",
        registrationPoint: "center",
    });
});

test("convert_to_symbol validates references, type, registration point, and plain unique-name shape", () => {
    const { tool } = register({ execute: async () => "{}" });
    const schema = z.object(tool.inputSchema);
    const valid = {
        timeline: 0,
        frame: 1,
        elements: [{ layer: "Artwork", element: 0 }],
        name: "NewSymbol",
        type: "graphic",
    };

    const parsed = schema.parse(valid);
    assert.equal(parsed.registrationPoint, "center");
    for (const invalid of [
        { ...valid, frame: 0 },
        { ...valid, elements: [] },
        { ...valid, name: "folder/NewSymbol" },
        { ...valid, type: "bitmap" },
        { ...valid, registrationPoint: "middle" },
    ]) {
        assert.equal(schema.safeParse(invalid).success, false);
    }
});

test("convert_to_symbol turns runner failures into MCP tool errors", async () => {
    const { tool } = register({
        execute: async () => {
            throw new Error("tween interior");
        },
    });
    const result = (await tool.handler({
        timeline: 0,
        frame: 3,
        elements: [{ layer: 0, element: 0 }],
        name: "Hero",
        type: "button",
    })) as { isError: boolean; content: { text: string }[] };

    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "tween interior");
});

test("convert_to_symbol executes bundled JSFL, converts elements across layers, and restores state", async () => {
    const app = setupAnimate();
    const result = (await app.tool.handler(
        z.object(app.tool.inputSchema).parse({
            timeline: 0,
            frame: 1,
            elements: [
                { layer: "Artwork", element: "targetA" },
                { layer: "Details", element: "targetB" },
            ],
            name: "Combined",
            type: "movie clip",
        }),
    )) as { isError?: boolean; content?: { text: string }[]; structuredContent: unknown };

    assert.equal(result.isError, undefined, result.content?.[0].text);
    assert.deepEqual(result.structuredContent, { name: "Combined", type: "movie clip", registrationPoint: "center" });
    assert.equal(app.conversionCalls(), 1);
    assert.deepEqual(app.libraryItems, [{ name: "Combined", itemType: "movie clip" }]);
    assert.deepEqual(
        app.timeline.layers.map((layer) => layer.frames[0].elements.map((element) => element.name)),
        [["Combined"], []],
    );
    assert.deepEqual(
        app.timeline.layers.map((layer) => layer.locked),
        [true, true],
    );
    assert.equal(app.timeline.currentFrame, 1);
    assert.equal(app.timeline.currentLayer, 1);
    assert.deepEqual(app.timeline.getSelectedFrames(), [1, 1, 2]);
    assert.equal(app.previousSelection.selected, true);
});

test("convert_to_symbol executes JSFL validation and refuses tween interiors before conversion", async () => {
    const app = setupAnimate(true);
    const result = (await app.tool.handler(
        z.object(app.tool.inputSchema).parse({
            timeline: 0,
            frame: 2,
            elements: [{ layer: "Artwork", element: "targetA" }],
            name: "Combined",
            type: "movie clip",
        }),
    )) as { isError: boolean; content: { text: string }[] };

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /inside a tween span/i);
    assert.equal(app.conversionCalls(), 0);
    assert.deepEqual(
        app.timeline.layers.map((layer) => layer.locked),
        [true, true],
    );
    assert.equal(app.timeline.currentFrame, 1);
    assert.equal(app.timeline.currentLayer, 1);
    assert.deepEqual(app.timeline.getSelectedFrames(), [1, 1, 2]);
    assert.equal(app.previousSelection.selected, true);
    assert.deepEqual(
        app.selectedForConversion.map((element) => element.selected),
        [false, false],
    );
});
