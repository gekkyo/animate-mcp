import assert from "node:assert/strict";
import { test } from "node:test";
import { editTween, layersLog, text, withServer } from "../helpers/fake-animate.js";

test("edit_tween creates a motion tween and reports the applied operation", { timeout: 30_000 }, () =>
    withServer({ FAKE_INSTANCE_CONTINUES: "1", FAKE_INITIAL_X: "30" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [{ frame: 1 }, { frame: 5, dx: 20, ease: "quartInOut" }],
            },
        ]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown; skipped: unknown[] };
        assert.equal(result.isError, undefined, text(result));
        assert.equal(summary.applied.length, 1);
        assert.equal(summary.failed, null);
        assert.deepEqual(summary.skipped, []);
        assert.match(text(result), /Export again before apply_scripts/);
        const frames = (await layersLog(tempDir)).at(-1)[0].frames;
        assert.equal(frames[0].tween, "motion object");
        assert.match(frames[0].motionXML, /anchor="0,20"/);
        assert.match(frames[0].motionXML, /next="3080,0"/);
        assert.match(frames[0].motionXML, /previous="-3300,20"/);
    }),
);

test("edit_tween creates shape spans with default ease and blend", { timeout: 30_000 }, () =>
    withServer({ FAKE_SHAPE_TWEEN: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from: 1, to: 3 }]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown };
        assert.equal(result.isError, undefined, text(result));
        assert.equal(summary.applied.length, 1);
        assert.equal(summary.failed, null);
        const frame = (await layersLog(tempDir)).at(-1)[0].frames[0];
        assert.equal(frame.tween, "shape");
        assert.equal(frame.tweenEasing, 0);
    }),
);

test("edit_tween rejects an intermediate shape-tween keyframe", { timeout: 30_000 }, () =>
    withServer({ FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_INTERMEDIATE: "1" }, async (client) => {
        const result = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from: 1, to: 3 }]);
        assert.match(
            (result.structuredContent as { failed: { error: string } }).failed.error,
            /cannot contain intermediate keyframes/,
        );
    }),
);

test("edit_tween allows adjacent shape tweens to share a destination keyframe", { timeout: 30_000 }, () =>
    withServer({ FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_CHAIN: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            { op: "createShapeTween", layer: "a/b", from: 3, to: 5 },
            { op: "createShapeTween", layer: "a/b", from: 1, to: 3 },
        ]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown };
        assert.equal(result.isError, undefined, text(result));
        assert.equal(summary.applied.length, 2);
        assert.equal(summary.failed, null);
        const frames = (await layersLog(tempDir)).at(-1)[0].frames;
        assert.equal(frames.find((frame: { start: number }) => frame.start === 0).tween, "shape");
        assert.equal(frames.find((frame: { start: number }) => frame.start === 2).tween, "shape");
    }),
);

test("edit_tween setEase updates the ease on an existing shape span", { timeout: 30_000 }, () =>
    withServer({ FAKE_SHAPE_TWEEN_INSPECT: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [{ op: "setEase", layer: "a/b", frame: 2, ease: -50 }]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null);
        const frame = (await layersLog(tempDir)).at(-1)[0].frames[0];
        assert.equal(frame.tween, "shape");
        assert.equal(frame.tweenEasing, -50);
    }),
);

test("edit_tween rejects invalid shape tween settings and invalid keyframe ranges", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_SHAPE_TWEEN: "1" }, async (client) => {
        for (const op of [
            { op: "createShapeTween", layer: "a/b", from: 1, to: 3, ease: -101 },
            { op: "createShapeTween", layer: "a/b", from: 1, to: 3, blend: "radial" },
        ]) {
            const invalid = await editTween(client, 0, [op]);
            assert.equal(invalid.isError, true);
        }

        for (const [from, to, message] of [
            [2, 3, "existing keyframe"],
            [1, 2, "existing keyframe"],
            [3, 3, "from must be less than to"],
            [4, 1, "from must be less than to"],
        ]) {
            const invalid = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from, to }]);
            assert.match(
                (invalid.structuredContent as { failed: { error: string } }).failed.error,
                new RegExp(message),
            );
        }
    });
});

test("edit_tween rejects non-shape keyframes and existing tween spans for shape tweens", {
    timeout: 30_000,
}, async () => {
    await withServer({ FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_BAD_ELEMENT: "2" }, async (client) => {
        const nonShape = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from: 1, to: 3 }]);
        assert.match((nonShape.structuredContent as { failed: { error: string } }).failed.error, /only raw shapes/);
    });

    for (const env of [
        { FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_GROUP: "2" },
        { FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_DRAWING: "2" },
        { FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_EMPTY: "2" },
    ]) {
        await withServer(env, async (client) => {
            const invalid = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from: 1, to: 3 }]);
            assert.match((invalid.structuredContent as { failed: { error: string } }).failed.error, /raw shapes/);
        });
    }

    await withServer({ FAKE_SHAPE_TWEEN: "1", FAKE_SHAPE_TWEEN_EXISTING: "1" }, async (client) => {
        const overlap = await editTween(client, 0, [{ op: "createShapeTween", layer: "a/b", from: 1, to: 3 }]);
        assert.match(
            (overlap.structuredContent as { failed: { error: string } }).failed.error,
            /Span already has a tween/,
        );
    });
});

test(
    "edit_tween creates classic spans, applies strength easing, and setEase targets the arriving keyframe",
    {
        timeout: 30_000,
    },
    () =>
        withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client, tempDir) => {
            const result = await editTween(client, 0, [
                {
                    op: "createTween",
                    layer: "a/b",
                    instance: "hero",
                    kind: "classic",
                    keyframes: [
                        { frame: 1, x: 0 },
                        { frame: 3, x: 100, ease: 25 },
                    ],
                },
                { op: "setEase", layer: "a/b", frame: 3, ease: -30 },
            ]);
            const summary = result.structuredContent as { applied: unknown[]; failed: unknown };
            assert.equal(summary.applied.length, 2);
            assert.equal(summary.failed, null);
            const frames = (await layersLog(tempDir)).at(-1)[0].frames;
            assert.equal(frames[0].tween, "motion");
            assert.equal(frames[0].tweenEasing, -30);
            assert.equal(frames.find((frame: { start: number }) => frame.start === 2).elements[0].x, 100);
        }),
);

test("edit_tween writes preset Bezier easing into classic property groups", { timeout: 30_000 }, () =>
    withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                kind: "classic",
                keyframes: [
                    { frame: 1, x: 0 },
                    { frame: 3, x: 100, ease: "quartInOut" },
                ],
            },
        ]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null);
        const frame = (await layersLog(tempDir)).at(-1)[0].frames[0];
        assert.equal(frame.hasCustomEase, true);
        assert.equal(frame.useSingleEaseCurve, false);
        assert.deepEqual(frame.customEases.position, [
            { x: 0, y: 0 },
            { x: 0.77, y: 0 },
            { x: 0.175, y: 1 },
            { x: 1, y: 1 },
        ]);
    }),
);

test("edit_tween rejects invalid spans and stops at the first failed operation", { timeout: 30_000 }, async () => {
    await withServer({}, async (client) => {
        const invalid = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [
                    { frame: 1, x: 0 },
                    { frame: 5, x: 100 },
                ],
            },
            { op: "setEase", layer: "a/b", frame: 1, ease: "linear" },
        ]);
        const summary = invalid.structuredContent as {
            applied: unknown[];
            failed: { error: string };
            skipped: unknown[];
            warnings: string[];
        };
        assert.equal(summary.applied.length, 0);
        assert.match(summary.failed.error, /Instance must be the only element/);
        assert.match(summary.warnings[0], /Operation 1 \(createTween\) failed and may have been partially applied/);
        assert.equal(summary.skipped.length, 1);

        const beyond = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [
                    { frame: 1, x: 0 },
                    { frame: 6, x: 100 },
                ],
            },
        ]);
        assert.match(
            (beyond.structuredContent as { failed: { error: string } }).failed.error,
            /Frame beyond timeline length/,
        );

        const conflict = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [
                    { frame: 1, x: 0, dx: 1 },
                    { frame: 2, x: 10 },
                ],
            },
        ]);
        assert.match((conflict.structuredContent as { failed: { error: string } }).failed.error, /only one of x or dx/);
    });

    await withServer({ FAKE_INSTANCE_CONTINUES: "1", FAKE_TWEEN: "motion" }, async (client) => {
        const mismatch = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                kind: "motion",
                keyframes: [{ frame: 3 }, { frame: 5, x: 100 }],
            },
        ]);
        assert.match(
            (mismatch.structuredContent as { failed: { error: string } }).failed.error,
            /differs from the existing tween kind/,
        );

        const overlap = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                kind: "classic",
                keyframes: [{ frame: 3 }, { frame: 5, x: 100 }],
            },
        ]);
        assert.match(
            (overlap.structuredContent as { failed: { error: string } }).failed.error,
            /Span already has a tween/,
        );
    });
});

test("edit_tween rejects unsupported ease names and joined classic position eases", { timeout: 30_000 }, async () => {
    await withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client) => {
        const unsupported = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [{ frame: 1 }, { frame: 3, x: 100, ease: "bounceOut" }],
            },
        ]);
        assert.equal(unsupported.isError, true);

        const separateEases = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                kind: "classic",
                keyframes: [{ frame: 1 }, { frame: 3, x: 100, y: 100, ease: { x: "quartIn", y: "linear" } }],
            },
        ]);
        assert.match(
            (separateEases.structuredContent as { failed: { error: string } }).failed.error,
            /Classic tweens ease x\/y together/,
        );
    });
});

test("edit_tween setEase updates motion XML at the arriving property keyframe", { timeout: 30_000 }, () =>
    withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [
                    { frame: 1, x: 0 },
                    { frame: 5, x: 100, ease: "quartInOut" },
                ],
            },
            { op: "setEase", layer: "a/b", frame: 5, ease: "linear" },
        ]);
        const summary = result.structuredContent as { applied: unknown[]; failed: unknown };
        assert.equal(summary.applied.length, 2);
        assert.equal(summary.failed, null);
        const xml = (await layersLog(tempDir)).at(-1)[0].frames[0].motionXML;
        assert.match(xml, /next="1000,25"/);
        assert.match(xml, /previous="-1000,75"/);
    }),
);

test(
    "edit_tween rejects mutually exclusive Animate color modes instead of dropping a channel",
    { timeout: 30_000 },
    () =>
        withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client) => {
            const result = await editTween(client, 0, [
                {
                    op: "createTween",
                    layer: "a/b",
                    instance: "hero",
                    keyframes: [
                        { frame: 1, alpha: 100 },
                        { frame: 3, tint: { color: "#ff0000", amount: 50 } },
                    ],
                },
            ]);
            assert.match(
                (result.structuredContent as { failed: { error: string } }).failed.error,
                /only one of alpha, brightness, or tint/,
            );
        }),
);

test("edit_tween preserves the starting brightness when generating a brightness channel", { timeout: 30_000 }, () =>
    withServer({ FAKE_INSTANCE_CONTINUES: "1", FAKE_INITIAL_BRIGHTNESS: "35" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                keyframes: [{ frame: 1 }, { frame: 3, brightness: 60 }],
            },
        ]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null, text(result));
        const xml = (await layersLog(tempDir)).at(-1)[0].frames[0].motionXML;
        assert.match(xml, /id="Brightness_Amount">[\s\S]*anchor="0,35"[\s\S]*anchor="0,60"/);
    }),
);

test("edit_tween calls Animate scale and rotation APIs with valid arguments", { timeout: 30_000 }, () =>
    withServer({ FAKE_INSTANCE_CONTINUES: "1" }, async (client, tempDir) => {
        const result = await editTween(client, 0, [
            {
                op: "createTween",
                layer: "a/b",
                instance: "hero",
                kind: "classic",
                keyframes: [{ frame: 1 }, { frame: 3, scaleX: 2, scaleY: 3, rotation: 45 }],
            },
        ]);
        assert.equal((result.structuredContent as { failed: unknown }).failed, null, text(result));
        const frames = (await layersLog(tempDir)).at(-1)[0].frames;
        const target = frames.find((frame: { start: number }) => frame.start === 2).elements[0];
        assert.equal(target.scaleX, 2);
        assert.equal(target.scaleY, 3);
        assert.equal(target.rotation, 45);
    }),
);
