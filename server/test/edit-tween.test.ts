import assert from "node:assert/strict";
import { test } from "node:test";
import { editTween, layersLog, text, withServer } from "./helpers/fake-animate.js";

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
        };
        assert.equal(summary.applied.length, 0);
        assert.match(summary.failed.error, /Instance must be the only element/);
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
