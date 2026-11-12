import assert from "node:assert/strict";
import { test } from "node:test";
import { editTimeline, layersLog, text, withServer } from "./helpers/fake-animate.js";

test("edit_timeline applies layer operations, parenting and relative placement", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client) => {
        const result = await editTimeline(client, 0, [
            { op: "addLayer", name: "Folder", type: "folder" },
            { op: "addLayer", name: "Child", parent: "Folder" },
            { op: "addLayer", name: "Mask", type: "mask" },
            { op: "addLayer", name: "Masked", type: "masked", parent: "Mask" },
            { op: "addLayer", name: "Mover", above: "Other" },
            { op: "addLayer", name: "After", below: "Other" },
            { op: "setLayerType", layer: "Child", type: "masked", parent: "Mask" },
            { op: "setLayerType", layer: "Child", type: "normal", parent: "Folder" },
            { op: "moveLayer", layer: "Mover", below: "Child", parent: "Folder" },
            { op: "renameLayer", layer: "a/b", name: "Renamed" },
            { op: "setLayerType", layer: "Other", type: "guide" },
        ]);
        const summary = result.structuredContent as {
            applied: unknown[];
            failed: unknown;
            skipped: unknown[];
            warnings: string[];
            layers: { name: string; type: string; parent?: string; locked: boolean }[];
        };
        assert.equal(result.isError, undefined, text(result));
        assert.equal(summary.applied.length, 11);
        assert.equal(summary.failed, null);
        assert.deepEqual(summary.skipped, []);
        assert.match(text(result), /Export again before apply_scripts/);
        assert.equal(summary.layers.find((entry) => entry.name === "Child")?.parent, "Folder");
        assert.equal(summary.layers.find((entry) => entry.name === "Masked")?.parent, "Mask");
        assert.equal(summary.layers.find((entry) => entry.name === "Child")?.type, "normal");
        assert.equal(summary.layers.find((entry) => entry.name === "Other")?.type, "guide");
        assert.equal(summary.layers.find((entry) => entry.name === "Mover")?.parent, "Folder");
        assert.ok(
            summary.layers.findIndex((entry) => entry.name === "Mover") >
                summary.layers.findIndex((entry) => entry.name === "Child"),
        );
        assert.ok(
            summary.layers.findIndex((entry) => entry.name === "After") >
                summary.layers.findIndex((entry) => entry.name === "Other"),
        );
    }),
);

test("edit_timeline requires confirmation, stops after failure, and disambiguates duplicate names", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client) => {
        const result = await editTimeline(client, 0, [
            { op: "renameLayer", layer: "a/b", name: "Before failure" },
            { op: "deleteLayer", layer: "Before failure" },
            { op: "renameLayer", layer: "dir", name: "Skipped" },
        ]);
        const summary = result.structuredContent as {
            applied: unknown[];
            failed: { error: string };
            skipped: unknown[];
            layers: { name: string }[];
        };
        assert.equal(summary.applied.length, 1);
        assert.match(summary.failed.error, /confirm required/);
        assert.equal(summary.skipped.length, 1);
        assert.ok(summary.layers.some((entry) => entry.name === "Before failure"));
        assert.ok(!summary.layers.some((entry) => entry.name === "Skipped"));
        const unconfirmedFrames = await editTimeline(client, 0, [
            { op: "removeFrames", layer: "a/b", frame: 1, count: 1 },
        ]);
        assert.match(
            (unconfirmedFrames.structuredContent as { failed: { error: string } }).failed.error,
            /confirm required/,
        );
        const confirmed = await editTimeline(client, 0, [{ op: "deleteLayer", layer: "a/b", confirm: true }]);
        assert.equal((confirmed.structuredContent as { failed: unknown }).failed, null, text(confirmed));
    });
    await withServer({ FAKE_SECOND_LAYER: "a/b" }, async (client) => {
        const ambiguous = await editTimeline(client, 0, [{ op: "renameLayer", layer: "a/b", name: "Nope" }]);
        assert.match((ambiguous.structuredContent as { failed: { error: string } }).failed.error, /ambiguous/);
        const selected = await editTimeline(client, 0, [{ op: "renameLayer", layer: "a/b", index: 1, name: "Second" }]);
        assert.equal((selected.structuredContent as { failed: unknown }).failed, null);
        assert.equal(
            (selected.structuredContent as { layers: { name: string }[] }).layers.filter(
                (entry) => entry.name === "Second",
            ).length,
            1,
        );
    });
});

test("edit_timeline supports frame edits and labels", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const result = await editTimeline(client, 0, [
            { op: "insertFrames", layer: "a/b", frame: 3, count: 1 },
            { op: "setLabel", layer: "a/b", frame: 1, label: "intro" },
            { op: "insertKeyframe", layer: "a/b", frame: 2 },
            { op: "clearKeyframe", layer: "a/b", frame: 2 },
            { op: "removeFrames", layer: "a/b", frame: 3, count: 1, confirm: true },
        ]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown; warnings: string[] };
        assert.equal(summary.applied.length, 5);
        assert.equal(summary.failed, null);
        assert.equal(summary.warnings.length, 2, "single-layer frame shifts warn");
        const layers = (await layersLog(tempDir)).at(-1);
        const targetLayer = layers.find((entry: { name: string }) => entry.name === "a/b");
        assert.equal(targetLayer.frames[0].label, "intro");
        assert.equal(targetLayer.frames[0].duration, 2, "clearing the inserted keyframe joins its span");
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);
    }),
);

test("edit_timeline ripple inserts and removes the same range on every layer", { timeout: 30_000 }, () =>
    withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const result = await editTimeline(client, 0, [
            { op: "insertFrames", layer: "a/b", frame: 3, count: 1, ripple: true },
            { op: "removeFrames", layer: "a/b", frame: 3, count: 1, confirm: true, ripple: true },
        ]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null);
        assert.deepEqual((result.structuredContent as { warnings: string[] }).warnings, []);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[0].duration, 2);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);
    }),
);

test("edit_timeline restores locks and edits library-item timelines", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_AS_LAYER: "AS", FAKE_LOCK_AS: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "setLabel", layer: "AS", frame: 1, label: "locked edit" }]);
        const layer = (result.structuredContent as { layers: { name: string; locked: boolean }[] }).layers[0];
        assert.equal(layer.name, "AS");
        assert.equal(layer.locked, true);
    });
    await withServer({}, async (client) => {
        const result = await editTimeline(client, "dir/Hero", [{ op: "renameLayer", layer: "L", name: "Actions" }]);
        assert.equal(result.isError, undefined, text(result));
        assert.equal((result.structuredContent as { layers: { name: string }[] }).layers[0].name, "Actions");
    });
});

test("edit_timeline rejects tween interiors but setSpanLength may resize a tween span", { timeout: 30_000 }, () =>
    withServer({ FAKE_TWEEN: "motion" }, async (client) => {
        for (const op of [
            { op: "insertFrames", layer: "a/b", frame: 4, count: 1 },
            { op: "removeFrames", layer: "a/b", frame: 4, count: 1, confirm: true },
            { op: "insertKeyframe", layer: "a/b", frame: 4 },
            { op: "clearKeyframe", layer: "a/b", frame: 4 },
        ]) {
            const result = await editTimeline(client, 0, [op]);
            assert.match(
                (result.structuredContent as { failed: { error: string } }).failed.error,
                /Frame is inside a tween/,
            );
        }
        const start = await editTimeline(client, 0, [{ op: "insertKeyframe", layer: "a/b", frame: 3 }]);
        assert.equal((start.structuredContent as { failed: unknown }).failed, null);
        const resized = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 4 }]);
        assert.equal((resized.structuredContent as { failed: unknown }).failed, null);
    }),
);

test("edit_timeline setSpanLength grows, shrinks, enforces minimum, rejects inner keys and ripples", {
    timeout: 30_000,
}, async () => {
    await withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const grew = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 4 }]);
        assert.equal((grew.structuredContent as { failed: unknown }).failed, null);
        assert.match((grew.structuredContent as { warnings: string[] }).warnings[0], /Only layer a\/b shifted/);
        let layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 4);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 5);

        const shrunk = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 4, length: 2 }]);
        assert.equal((shrunk.structuredContent as { failed: unknown }).failed, null);
        layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 2);
    });
    await withServer({ FAKE_SECOND_LAYER: "Other" }, async (client, tempDir) => {
        const ripple = await editTimeline(client, 0, [
            { op: "setSpanLength", layer: "a/b", frame: 4, length: 5, ripple: true },
        ]);
        assert.equal((ripple.structuredContent as { failed: unknown }).failed, null);
        const layers = (await layersLog(tempDir)).at(-1);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "a/b").frames[1].duration, 5);
        assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 7);
        assert.deepEqual((ripple.structuredContent as { warnings: string[] }).warnings, []);
    });
    await withServer({ FAKE_INNER_KEYFRAME: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 3, length: 4 }]);
        assert.match(
            (result.structuredContent as { failed: { error: string } }).failed.error,
            /Another keyframe lies inside the span/,
        );
        const tooShort = await editTimeline(client, 0, [{ op: "setSpanLength", layer: "a/b", frame: 3, length: 1 }]);
        assert.equal(tooShort.isError, true, "length below 2 is rejected by the input schema");
    });
});

test("edit_timeline shiftLayerFrames offsets content without changing span lengths", { timeout: 30_000 }, async () => {
    await withServer(
        { FAKE_TWEEN: "motion", FAKE_SECOND_LAYER: "Other", FAKE_SECOND_LENGTH: "10" },
        async (client, tempDir) => {
            const result = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "a/b", offset: 2 }]);
            assert.equal(result.isError, undefined, text(result));
            const summary = result.structuredContent as {
                applied: unknown[];
                failed: unknown;
                warnings: string[];
            };
            assert.equal(summary.applied.length, 1);
            assert.equal(summary.failed, null);
            assert.match(summary.warnings[0], /other layers were not shifted/);

            const layers = (await layersLog(tempDir)).at(-1);
            const shifted = layers.find((entry: { name: string }) => entry.name === "a/b");
            assert.deepEqual(
                shifted.frames.map((frame: { start: number; duration: number }) => [frame.start, frame.duration]),
                [
                    [0, 2],
                    [2, 2],
                    [4, 3],
                ],
            );
            assert.equal(shifted.frames[0].script, "", "the leading offset is empty");
            assert.equal(shifted.frames[1].script, "stop();\n// 日本語");
            assert.equal(shifted.frames[1].tween, "none");
            assert.equal(shifted.frames[2].tween, "motion", "the tween type is preserved");
            assert.equal(
                shifted.frames.reduce((length: number, frame: { duration: number }) => length + frame.duration, 0),
                7,
            );
            assert.equal(layers.find((entry: { name: string }) => entry.name === "Other").frames[0].duration, 10);
        },
    );

    await withServer({ FAKE_AS_LAYER: "AS", FAKE_LOCK_AS: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "AS", offset: 1 }]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null, text(result));
        assert.equal((result.structuredContent as { layers: { locked: boolean }[] }).layers[0].locked, true);
    });

    await withServer({ FAKE_SECOND_LAYER: "a/b" }, async (client) => {
        const invalidOffset = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "dir", offset: 0 }]);
        assert.equal(invalidOffset.isError, true);
        assert.match(text(invalidOffset), /offset/);
        const ambiguous = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "a/b", offset: 1 }]);
        assert.match((ambiguous.structuredContent as { failed: { error: string } }).failed.error, /ambiguous/);
        const missing = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "missing", offset: 1 }]);
        assert.match((missing.structuredContent as { failed: { error: string } }).failed.error, /Layer not found/);
        const empty = await editTimeline(client, 0, [{ op: "shiftLayerFrames", layer: "dir", offset: 1 }]);
        assert.match((empty.structuredContent as { failed: { error: string } }).failed.error, /no frames/);
    });
});

test("edit_timeline reverses bottom-to-top elements into layer order and preserves instance properties", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_DISTRIBUTE: "1",
            FAKE_LOCK_DISTRIBUTE: "1",
            FAKE_READONLY_COLOR_PROPERTIES: "1",
            FAKE_DISTRIBUTE_BRIGHTNESS: "1",
        },
        async (client, tempDir) => {
            const result = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            const summary = result.structuredContent as {
                applied: { createdLayers?: string[] }[];
                failed: { error: string } | null;
                layers: { name: string; locked: boolean }[];
            };
            assert.equal(summary.failed, null, text(result));
            assert.deepEqual(summary.applied[0].createdLayers, ["hero_2", "Hero", "hero"], text(result));
            assert.deepEqual(
                summary.layers.slice(0, 3).map((entry) => entry.name),
                ["hero_2", "Hero", "hero"],
            );
            assert.ok(summary.layers.slice(0, 3).every((entry) => entry.locked));
            const layers = (await layersLog(tempDir)).at(-1);
            assert.deepEqual(
                layers.slice(0, 3).map((entry: { frames: { duration: number }[] }) => entry.frames[0].duration),
                [5, 5, 5],
            );
            // The fake frame stores elements bottom-to-top, so the top layer gets the last element.
            const elements = layers
                .slice(0, 3)
                .map((entry: { frames: { elements: unknown[] }[] }) => entry.frames[0].elements[0]);
            assert.deepEqual(
                elements.map((element: { name: string }) => element.name),
                ["hero", "", "hero"],
            );
            assert.deepEqual(
                elements.map((element: { x: number }) => element.x),
                [30, 20, 10],
            );
            assert.deepEqual(
                elements.map((element: { matrix: { tx: number } }) => element.matrix.tx),
                [30, 20, 10],
            );
            assert.deepEqual(
                elements.map(
                    (element: { transformationPoint: { x: number; y: number } }) => element.transformationPoint,
                ),
                [
                    { x: 2, y: 3 },
                    { x: 2, y: 3 },
                    { x: 2, y: 3 },
                ],
            );
            assert.deepEqual(
                elements.map((element: { colorMode: string }) => element.colorMode),
                ["brightness", "tint", "alpha"],
            );
            assert.equal((elements[0] as { brightness: number }).brightness, 42);
            assert.equal((elements[1] as { tintColor: string }).tintColor, "#336699");
            assert.equal((elements[1] as { tintPercent: number }).tintPercent, 35);
            assert.deepEqual((elements[0] as { filters: object[] }).filters, [
                {
                    name: "blurFilter",
                    blurX: 8,
                    blurY: 6,
                    quality: "high",
                    enabled: false,
                    color: "#123456",
                    distance: 9,
                    angle: 30,
                    inner: true,
                    knockout: true,
                    hideObject: true,
                },
            ]);
            assert.ok(!summary.layers.some((entry) => entry.name === "a/b"), "the emptied source layer is removed");
        },
    );
});

test("edit_timeline keeps native distribution in top-to-bottom layer order", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_DISTRIBUTE: "1", FAKE_NATIVE_DISTRIBUTE: "1" }, async (client) => {
        const result = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
        const summary = result.structuredContent as {
            applied: { createdLayers?: string[] }[];
            failed: { error: string } | null;
            layers: { name: string }[];
        };
        assert.equal(summary.failed, null, text(result));
        assert.deepEqual(summary.applied[0].createdLayers, ["hero_2", "Hero", "hero"]);
        assert.deepEqual(
            summary.layers.slice(0, 3).map((entry) => entry.name),
            ["hero_2", "Hero", "hero"],
        );
    });
});

test("edit_timeline distributeToLayers rejects unsupported or multi-span sources without deleting them", {
    timeout: 30_000,
}, async () => {
    await withServer({}, async (client) => {
        const invalid = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
        assert.match(
            (invalid.structuredContent as { failed: { error: string } }).failed.error,
            /exactly one keyframe span/,
        );
        assert.ok(
            (invalid.structuredContent as { layers: { name: string }[] }).layers.some((entry) => entry.name === "a/b"),
        );
    });
    await withServer(
        { FAKE_DISTRIBUTE: "1", FAKE_DISTRIBUTE_BAD_ELEMENT: "1", FAKE_LOCK_DISTRIBUTE: "1" },
        async (client) => {
            const invalid = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            assert.match((invalid.structuredContent as { failed: { error: string } }).failed.error, /symbol instances/);
            assert.ok(
                (invalid.structuredContent as { layers: { name: string; locked: boolean }[] }).layers.some(
                    (entry) => entry.name === "a/b" && entry.locked,
                ),
            );
        },
    );
    await withServer({ FAKE_DISTRIBUTE: "1", FAKE_DISTRIBUTE_TWEEN: "motion object" }, async (client) => {
        const invalid = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
        assert.match(
            (invalid.structuredContent as { failed: { error: string } }).failed.error,
            /cannot contain a tween/,
        );
    });
    for (const env of [{ FAKE_DISTRIBUTE_ACTIONSCRIPT: "1" }, { FAKE_DISTRIBUTE_LABEL: "1" }]) {
        await withServer({ FAKE_DISTRIBUTE: "1", FAKE_LOCK_DISTRIBUTE: "1", ...env }, async (client, tempDir) => {
            const rejected = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            const summary = rejected.structuredContent as {
                failed: { error: string };
                layers: { name: string; locked: boolean }[];
            };
            assert.match(summary.failed.error, /ActionScript or a label/);
            assert.deepEqual(
                summary.layers.map((entry) => entry.name),
                ["a/b", "dir"],
            );
            assert.equal(summary.layers[0].locked, true);
            const source = (await layersLog(tempDir)).at(-1)[0];
            assert.equal(source.frames[0].elements.length, 3);
        });
    }
    await withServer(
        { FAKE_DISTRIBUTE: "1", FAKE_FAIL_ADD_ITEM_AFTER: "1", FAKE_LOCK_DISTRIBUTE: "1" },
        async (client, tempDir) => {
            const failed = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            const summary = failed.structuredContent as {
                failed: { error: string };
                layers: { name: string; locked: boolean }[];
            };
            assert.match(summary.failed.error, /fake addItemToDocument failure/);
            assert.ok(
                summary.layers.some((entry) => entry.name === "a/b" && entry.locked),
                "the source layer remains after a copy failure",
            );
            assert.equal(summary.layers.filter((entry) => ["hero", "Hero", "hero_2"].includes(entry.name)).length, 0);
            const source = (await layersLog(tempDir)).at(-1).find((entry: { name: string }) => entry.name === "a/b");
            assert.equal(source.frames[0].elements.length, 3, "the original source instances remain intact");
        },
    );
});

test("edit_timeline keeps every element after native distribution partially mutates then fails", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_DISTRIBUTE: "1",
            FAKE_NATIVE_DISTRIBUTE: "1",
            FAKE_NATIVE_DISTRIBUTE_PARTIAL_FAILURE: "1",
            FAKE_LOCK_DISTRIBUTE: "1",
        },
        async (client, tempDir) => {
            const result = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            const summary = result.structuredContent as {
                failed: { error: string };
                layers: { name: string; locked: boolean }[];
            };
            assert.match(summary.failed.error, /fake native distribution failure after partial mutation/);
            assert.match(summary.failed.error, /Undo in Animate/);
            assert.ok(summary.layers.some((entry) => entry.name === "a/b" && entry.locked));
            assert.ok(summary.layers.some((entry) => entry.name === "Native partial"));
            const layers = (await layersLog(tempDir)).at(-1);
            const elements = layers.flatMap((entry: { frames: { elements: { x: number }[] }[] }) =>
                entry.frames.flatMap((frame) => frame.elements),
            );
            assert.deepEqual(elements.map((element: { x: number }) => element.x).sort(), [10, 20, 30]);
        },
    );
});

test("edit_timeline keeps native layers when post-distribution validation fails", { timeout: 30_000 }, async () => {
    await withServer(
        {
            FAKE_DISTRIBUTE: "1",
            FAKE_NATIVE_DISTRIBUTE: "1",
            FAKE_NATIVE_DISTRIBUTE_BAD_COUNT: "1",
            FAKE_LOCK_DISTRIBUTE: "1",
        },
        async (client, tempDir) => {
            const result = await editTimeline(client, 0, [{ op: "distributeToLayers", layer: "a/b" }]);
            const summary = result.structuredContent as {
                failed: { error: string };
                layers: { name: string; locked: boolean }[];
            };
            assert.match(summary.failed.error, /unexpected number of layers/);
            assert.match(summary.failed.error, /Undo in Animate/);
            assert.ok(summary.layers.some((entry) => entry.name === "a/b" && entry.locked));
            assert.ok(summary.layers.some((entry) => entry.name === "Native validation"));
            const layers = (await layersLog(tempDir)).at(-1);
            const elements = layers.flatMap((entry: { frames: { elements: { x: number }[] }[] }) =>
                entry.frames.flatMap((frame) => frame.elements),
            );
            assert.deepEqual(elements.map((element: { x: number }) => element.x).sort(), [10, 20, 30]);
        },
    );
});
