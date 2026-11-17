import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("smoke-run uses the production-wrapped handler for --entrances steps", () => {
    const source = readFileSync(join(root, "server/verification/smoke/scenarios/smoke-run.mjs"), "utf8");
    assert.match(source, /const result = await handler\(args\);/);
    assert.doesNotMatch(source, /entranceHandlers/);
});

test("smoke-lib creates saved AS3 and Canvas documents through their shared lifecycle", async () => {
    const { createSavedAs3Document, createSavedHtmlCanvasDocument } = await import(
        "../../verification/smoke/lib/smoke-lib.mjs"
    );
    const codes: string[] = [];
    /** Records JSFL passed to the lifecycle helper and returns a fake saved document.
     * @param args JSFL request.
     * @param args.code JSFL source.
     * @returns Mock run_jsfl tool result.
     */
    const runJsfl = async ({ code }: { code: string }) => {
        codes.push(code);
        const path = codes.length === 1 ? "file:///tmp/smoke.fla" : "file:///tmp/smoke-canvas.fla";
        return { isError: false, structuredContent: { result: `Smoke\t${path}` } };
    };

    assert.deepEqual(await createSavedAs3Document(runJsfl, "file:///tmp/smoke.fla", "trace('smoke');"), {
        name: "Smoke",
        pathURI: "file:///tmp/smoke.fla",
    });
    assert.match(codes[0], /fl\.createDocument\("timeline"/);
    assert.match(codes[0], /doc\.getTimeline\(\)\.layers\[0\]\.frames\[0\]\.actionScript/);

    assert.deepEqual(await createSavedHtmlCanvasDocument(runJsfl, "file:///tmp/smoke-canvas.fla"), {
        name: "Smoke",
        pathURI: "file:///tmp/smoke-canvas.fla",
    });
    assert.match(codes[1], /fl\.createDocument\("htmlcanvas"/);
    assert.doesNotMatch(codes[1], /actionScript/);
});

test("fixture merge leaves the reviewed run_jsfl fixture unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "merge-smoke-shapes-"));
    const records = join(directory, "records");
    const fixtures = join(directory, "fixtures");
    mkdirSync(records);
    mkdirSync(fixtures);
    const reviewed = {
        shape: { result: "string" },
        optionalKeys: ["details"],
        arguments: { code: '"real-shape-probe";' },
    };
    writeFileSync(join(fixtures, "run_jsfl.json"), JSON.stringify(reviewed));
    writeFileSync(
        join(records, "run_jsfl.jsonl"),
        `${JSON.stringify({
            tool: "run_jsfl",
            arguments: { code: 'fl.trace("PRIVATE_JSFL");', text: "PRIVATE_TEXT", document: "/Users/private.fla" },
            shape: { result: "boolean", details: { type: "object" } },
        })}\n`,
    );

    try {
        execFileSync(
            process.execPath,
            [join(root, "server/verification/smoke/lib/merge-smoke-shapes.mjs"), records, fixtures],
            {
                cwd: root,
            },
        );
        const output = readFileSync(join(fixtures, "run_jsfl.json"), "utf8");
        assert.deepEqual(JSON.parse(output), reviewed);
        for (const privateValue of ["PRIVATE_JSFL", "PRIVATE_TEXT", "/Users/private.fla"]) {
            assert.equal(output.includes(privateValue), false);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("fixture merge updates other result shapes while retaining reviewed arguments", () => {
    const directory = mkdtempSync(join(tmpdir(), "merge-smoke-reviewed-"));
    const records = join(directory, "records");
    const fixtures = join(directory, "fixtures");
    mkdirSync(records);
    mkdirSync(fixtures);
    const reviewed = {
        shape: { ok: "string" },
        optionalKeys: [],
        arguments: { document: "$" + "{TMP}/sample.fla", text: "safe sample" },
    };
    writeFileSync(join(fixtures, "edit_text.json"), JSON.stringify(reviewed));
    writeFileSync(
        join(records, "edit_text.jsonl"),
        `${JSON.stringify({
            tool: "edit_text",
            arguments: { document: "/Users/private.fla", text: "PRIVATE_TEXT" },
            shape: { ok: "boolean" },
        })}\n`,
    );

    try {
        execFileSync(
            process.execPath,
            [join(root, "server/verification/smoke/lib/merge-smoke-shapes.mjs"), records, fixtures],
            {
                cwd: root,
            },
        );
        const output = readFileSync(join(fixtures, "edit_text.json"), "utf8");
        assert.deepEqual(JSON.parse(output), {
            shape: { ok: "boolean" },
            optionalKeys: [],
            arguments: reviewed.arguments,
        });
        assert.equal(output.includes("PRIVATE_TEXT"), false);
        assert.equal(output.includes("/Users/private.fla"), false);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("fixture merge rejects recorded tools without reviewed replay arguments", () => {
    const directory = mkdtempSync(join(tmpdir(), "merge-smoke-unreviewed-"));
    const records = join(directory, "records");
    mkdirSync(records);
    writeFileSync(join(records, "edit_text.jsonl"), '{"arguments":{"text":"PRIVATE"},"shape":{"ok":"boolean"}}\n');
    try {
        const result = spawnSync(
            process.execPath,
            [join(root, "server/verification/smoke/lib/merge-smoke-shapes.mjs"), records, join(directory, "fixtures")],
            { cwd: root, encoding: "utf8" },
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /No reviewed fixture exists for edit_text/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
