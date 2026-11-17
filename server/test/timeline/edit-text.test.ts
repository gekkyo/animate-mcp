import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { z } from "zod";
import { createJsflRunner } from "../../src/tools/core/shared.js";
import { registerEditText } from "../../src/tools/timeline/edit-text.js";

/**
 * Creates an Animate JSFL VM context with configurable document and layer state.
 * @param options Fixture variations for document type, lock, tween, and selection.
 * @param options.type Optional document type.
 * @param options.locked Whether the fixture layer starts locked.
 * @param options.tween Optional frame tween type.
 * @param options.text Whether the initial selection is a text element.
 * @returns The VM context containing the fake document.
 */
const fakeDocument = (options: { type?: string; locked?: boolean; tween?: string; text?: boolean } = {}) => {
    const context = createContext({});
    runInContext(
        `var __writes = 0;
var __type = ${JSON.stringify(options.type ?? "Flash")};
var __locked = ${JSON.stringify(options.locked ?? false)};
var __tween = ${JSON.stringify(options.tween ?? "none")};
var __text = ${JSON.stringify(options.text ?? false)};
function makeText(value, selected) {
  var attrs = { face: "Arial", size: 12, fillColor: "#000000", bold: false, italic: false };
  var lineTypeValue = "multiline";
  return { elementType: "text", name: "caption", selected: selected, textType: "static", get lineType() { if (this.textType === "static") throw new Error("lineType is unsupported for static text"); return lineTypeValue; }, set lineType(next) { if (this.textType === "static") throw new Error("lineType is unsupported for static text"); lineTypeValue = next; }, alignment: "left", textRuns: [{ textAttrs: attrs }], value: value,
    getTextString: function () { return this.value; },
    setTextString: function (next) { if (__layer.locked) throw new Error("Layer is locked"); __writes++; this.value = next; },
    setTextAttr: function (name, next) { if (__layer.locked) throw new Error("Layer is locked"); __writes++; attrs[name] = next; }
  };
}
var __initialElement = __text ? makeText("before", true) : { elementType: "instance", name: "selectedInstance", selected: true };
var __frame = { startFrame: 0, duration: 3, tweenType: __tween, elements: [__initialElement] };
var __layer = { name: "Text", layerType: "normal", locked: __locked, visible: true, parentLayer: null, frames: [__frame, __frame, __frame] };
var __timeline = { currentLayer: 0, currentFrame: 2, currentTimeline: 0, selectedFrames: [0, 2, 3], layers: [__layer],
  getSelectedFrames: function () { return this.selectedFrames.slice(); },
  setSelectedFrames: function (frames) { this.selectedFrames = frames.slice(); },
  insertFrames: function (count, _atEnd, from) { var frames = this.layers[this.currentLayer].frames, source = frames[from] || frames[frames.length - 1]; source.duration += count; for (var i = 0; i < count; i++) frames.push(source); },
  insertKeyframe: function (index) { var frames = this.layers[this.currentLayer].frames, source = frames[index], start = source.startFrame; if (index === start) return; var next = { startFrame: index, duration: start + source.duration - index, tweenType: "none", name: "", elements: source.elements.slice() }; source.duration = index - start; for (var i = index; i < index + next.duration; i++) frames[i] = next; }
};
var __doc = { name: "text.fla", type: __type, currentTimeline: 0, timelines: [__timeline], width: 550, height: 400,
  library: { items: [], editItem: function () {} },
  getTimeline: function () { return this.timelines[this.currentTimeline]; },
  exitEditMode: function () {}, editScene: function (index) { this.currentTimeline = index; },
  addNewText: function (rectangle) { if (__layer.locked) throw new Error("Layer is locked"); var element = makeText("", true); element.rectangle = rectangle; __layer.frames[__timeline.currentFrame].elements.push(element); __writes++; },
  selectNone: function () { for (var i = 0; i < __layer.frames.length; i++) for (var j = 0; j < __layer.frames[i].elements.length; j++) __layer.frames[i].elements[j].selected = false; }
};
Object.defineProperty(__doc, "selection", { get: function () { return __layer.frames[__timeline.currentFrame].elements.filter(function (element) { return element.selected; }); } });
var fl = { documents: [__doc], trace: function () {} };`,
        context,
    );
    return context;
};

/**
 * Registers and calls edit_text against an in-memory Animate fixture.
 * @param input Tool arguments to validate and execute.
 * @param options Fixture variations passed to {@link fakeDocument}.
 * @param options.type Optional document type.
 * @param options.locked Whether the fixture layer starts locked.
 * @param options.tween Optional frame tween type.
 * @param options.text Whether the initial selection is a text element.
 * @returns The tool result and VM context for state assertions.
 */
const callEditText = async (
    input: Record<string, unknown>,
    options: { type?: string; locked?: boolean; tween?: string; text?: boolean } = {},
): Promise<{
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: unknown;
    context: ReturnType<typeof createContext>;
}> => {
    const context = fakeDocument(options);
    let handler: ((input: unknown) => Promise<unknown>) | undefined;
    let inputSchema: z.ZodRawShape = {};
    const runner = { execute: async (code: string) => runInContext(code, context) };
    registerEditText(
        {
            registerTool: (_name: string, config: { inputSchema: unknown }, callback: (input: unknown) => unknown) => {
                inputSchema = config.inputSchema as z.ZodRawShape;
                handler = callback as unknown as (input: unknown) => Promise<unknown>;
            },
        } as unknown as Parameters<typeof registerEditText>[0],
        {
            runner,
            jsfl: createJsflRunner(runner),
        },
    );
    const parsed = z.object(inputSchema).safeParse(input);
    if (!parsed.success) {
        // Return schema failures in the same shape as an MCP tool error.
        return { isError: true, content: [{ type: "text", text: parsed.error.message }], context };
    }
    return { ...((await handler?.(parsed.data)) as Record<string, unknown>), context };
};

test("edit_text adds styled text to a locked layer and restores frame and selection", async () => {
    const result = await callEditText(
        {
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "Text",
                    frame: 1,
                    rectangle: { left: 10, top: 20, right: 210, bottom: 70 },
                    text: "Hello",
                    style: {
                        face: "Avenir",
                        size: 24,
                        fillColor: "#123456",
                        bold: true,
                        italic: true,
                        alignment: "center",
                    },
                },
            ],
        },
        // Animate must temporarily unlock the layer to add the text, then restore it.
        { locked: true },
    );
    assert.equal(result.isError, undefined, "edit_text add failed");
    const structured = result.structuredContent as {
        applied: number;
        elements: { text: string; style: Record<string, unknown> }[];
    };
    assert.equal(structured.applied, 1);
    assert.equal(structured.elements[0].text, "Hello");
    assert.deepEqual(structured.elements[0].style, {
        face: "Avenir",
        size: 24,
        fillColor: "#123456",
        bold: true,
        italic: true,
        alignment: "center",
        textType: "static",
        lineType: null,
    });
    assert.equal(runInContext("__layer.locked", result.context as ReturnType<typeof createContext>), true);
    assert.equal(runInContext("__timeline.currentFrame", result.context as ReturnType<typeof createContext>), 2);
    assert.equal(runInContext("__doc.selection.length", result.context as ReturnType<typeof createContext>), 1);
});

test("edit_text sets existing text and refuses non-text elements", async () => {
    const updated = await callEditText(
        {
            timeline: 0,
            ops: [{ op: "set", layer: "Text", frame: 1, element: "caption", text: "Updated", style: { italic: true } }],
        },
        { text: true, locked: true },
    );
    assert.equal(updated.isError, undefined, "edit_text set failed");
    const element = (updated.structuredContent as { elements: { text: string; style: { italic: boolean } }[] })
        .elements[0];
    assert.equal(element.text, "Updated");
    assert.equal(element.style.italic, true);
    assert.equal(runInContext("__layer.locked", updated.context as ReturnType<typeof createContext>), true);

    const rejected = await callEditText({
        timeline: 0,
        ops: [{ op: "set", layer: "Text", frame: 1, element: 0, text: "Nope" }],
    });
    assert.equal(rejected.isError, true);
    assert.match((rejected.content as { text: string }[])[0].text, /Only text elements/);
});

test("edit_text rejects tween edits and unsupported Canvas styles before writing", async () => {
    const add = {
        timeline: 0,
        ops: [
            { op: "add", layer: "Text", frame: 2, rectangle: { left: 0, top: 0, right: 10, bottom: 10 }, text: "Nope" },
        ],
    };
    const tween = await callEditText(add, { tween: "motion object" });
    assert.equal(tween.isError, true);
    assert.match((tween.content as { text: string }[])[0].text, /tween/i);
    assert.equal(runInContext("__writes", tween.context as ReturnType<typeof createContext>), 0);

    for (const style of [{ textType: "input" }, { lineType: "single line" }]) {
        const canvas = await callEditText(
            {
                timeline: 0,
                ops: [
                    {
                        op: "add",
                        layer: "Text",
                        frame: 1,
                        rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                        text: "Nope",
                        style,
                    },
                ],
            },
            { type: "htmlcanvas" },
        );
        assert.equal(canvas.isError, true);
        assert.equal(runInContext("__writes", canvas.context as ReturnType<typeof createContext>), 0);
    }
});

test("edit_text refuses to add empty text", async () => {
    const result = await callEditText({
        timeline: 0,
        ops: [{ op: "add", layer: "Text", frame: 1, rectangle: { left: 0, top: 0, right: 10, bottom: 10 }, text: "" }],
    });
    assert.equal(result.isError, true);
    assert.equal(runInContext("__writes", result.context as ReturnType<typeof createContext>), 0);
});

test("edit_text refuses lineType on static text before any write", async () => {
    for (const style of [{ textType: "static", lineType: "single line" }, { lineType: "single line" }]) {
        const add = await callEditText({
            timeline: 0,
            ops: [
                {
                    op: "add",
                    layer: "Text",
                    frame: 1,
                    rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                    text: "Static",
                    style,
                },
            ],
        });
        assert.equal(add.isError, true);
        assert.match((add.content as { text: string }[])[0].text, /lineType requires textType: dynamic or input/);
        assert.equal(runInContext("__writes", add.context as ReturnType<typeof createContext>), 0);
    }

    const set = await callEditText(
        {
            timeline: 0,
            ops: [{ op: "set", layer: "Text", frame: 1, element: "caption", style: { lineType: "single line" } }],
        },
        { text: true },
    );
    assert.equal(set.isError, true);
    assert.match((set.content as { text: string }[])[0].text, /lineType can only be set on dynamic or input text/);
    assert.equal(runInContext("__writes", set.context as ReturnType<typeof createContext>), 0);
});

test("edit_text applies lineType after changing a text element to dynamic", async () => {
    const result = await callEditText(
        {
            timeline: 0,
            ops: [
                {
                    op: "set",
                    layer: "Text",
                    frame: 1,
                    element: "caption",
                    style: { textType: "dynamic", lineType: "single line" },
                },
            ],
        },
        { text: true },
    );
    assert.equal(result.isError, undefined, "edit_text add failed");
    const style = (result.structuredContent as { elements: { style: Record<string, unknown> }[] }).elements[0].style;
    assert.equal(style.textType, "dynamic");
    assert.equal(style.lineType, "single line");
});

test("edit_text makes a normal-span frame a keyframe and extends the timeline", async () => {
    const result = await callEditText({
        timeline: 0,
        ops: [
            {
                op: "add",
                layer: "Text",
                frame: 2,
                rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                text: "Keyframe",
            },
            {
                op: "add",
                layer: "Text",
                frame: 5,
                rectangle: { left: 0, top: 0, right: 10, bottom: 10 },
                text: "Extended",
                style: { textType: "dynamic", lineType: "single line" },
            },
        ],
    });
    assert.equal(result.isError, undefined, "edit_text set failed");
    assert.deepEqual(
        (result.structuredContent as { elements: { frame: number }[] }).elements.map((element) => element.frame),
        [2, 5],
    );
    assert.equal(runInContext("__layer.frames.length", result.context as ReturnType<typeof createContext>), 5);
    assert.equal(runInContext("__layer.frames[1].startFrame", result.context as ReturnType<typeof createContext>), 1);
    assert.equal(runInContext("__layer.frames[4].startFrame", result.context as ReturnType<typeof createContext>), 4);
    assert.equal(
        (result.structuredContent as { elements: { style: { lineType: string | null } }[] }).elements[1].style.lineType,
        "single line",
    );
});
