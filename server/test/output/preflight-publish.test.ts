import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import type { ToolDeps } from "../../src/tools/core/shared.js";
import { validateJsflResult } from "../../src/tools/core/shared.js";
import { runPreflightPublish } from "../../src/tools/output/preflight-publish.js";

const fixture = JSON.parse(await readFile("server/test/fixtures/preflight-publish/active-canvas.json", "utf8")) as {
    document: { name: string; pathURI: string; type: string; profile: string };
    existingOutputs: string[];
    audit: { document: string; findings: unknown[]; warnings: string[] };
};
fixture.document.profile = await readFile("server/test/fixtures/preflight-publish/canvas-profile.xml", "utf8");
const preflightJsfl = await readFile("server/jsfl/output/preflight-publish.jsfl", "utf8");

/**
 * Creates a recording seam fake with the active-document result followed by its output probe.
 * @param info Initial document facts.
 * @param audit Existing audit result.
 * @param probe Optional output-probe document facts.
 * @returns Tool dependencies and recorded entry calls.
 */
function fakeDeps(info: Record<string, unknown>, audit = fixture.audit, probe = info) {
    const results: Record<string, unknown[]> = {
        "output/preflight-publish": [
            { sameDocument: true, outputFiles: [], ...info },
            { sameDocument: true, outputFiles: [], ...probe },
        ],
        "document/audit-document": [audit],
    };
    const calls: { entry: string; vars: Record<string, unknown> }[] = [];
    const deps: ToolDeps = {
        runner: {
            execute: async () => {
                throw new Error("Unexpected direct Runner call");
            },
        },
        jsfl: {
            async run<T>(entry: string, vars: Record<string, unknown>, schema: ZodType<T>) {
                calls.push({ entry, vars });
                const result = results[entry]?.shift();
                if (result === undefined) {
                    throw new Error(`Unexpected JSFL entry: ${entry}`);
                }
                return validateJsflResult(entry, result, schema);
            },
        },
    };
    return { deps, calls };
}

test("preflight reports documented checks and existing audit findings without publishing or writing", async () => {
    const { deps, calls } = fakeDeps(fixture.document, fixture.audit);
    const result = await runPreflightPublish(undefined, deps);

    assert.deepEqual(result, {
        document: "animation.fla",
        type: "htmlcanvas",
        checks: {
            saved: { status: "pass", detail: "Document has a saved path; pending edits are unchecked." },
            documentType: { status: "pass", detail: "Supported document type: htmlcanvas." },
            publishFormats: {
                status: "pass",
                formats: [
                    { name: "SVG Image", enabled: false },
                    { name: "JavaScript/HTML", enabled: true },
                ],
            },
            outputFiles: {
                status: "unchecked",
                candidates: [],
                warnings: [],
                detail: "Some output paths could not be safely determined.",
            },
            compilation: {
                status: "unchecked",
                detail: "Preflight does not compile; use Publish for an actual Build result.",
            },
        },
        audit: {
            status: "fail",
            document: fixture.audit.document,
            findings: {
                unusedLibraryItems: fixture.audit.findings,
                emptyKeyframes: [],
                defaultNames: [],
            },
            warnings: [],
        },
    });
    assert.deepEqual(
        calls.map(({ entry }) => entry),
        ["output/preflight-publish", "document/audit-document", "output/preflight-publish"],
    );
    assert.deepEqual(calls[2].vars.__outputFiles, []);
    assert.equal(preflightJsfl.includes("publishDocument"), false);
    assert.equal(preflightJsfl.includes("FLfile.write"), false);
    assert.equal(preflightJsfl.includes("FLfile.exists"), true);
});

test("preflight does not fail an HTML5 Canvas profile without recognized format flags", async () => {
    const info = {
        ...fixture.document,
        profile: "<profile><PublishFormatProperties></PublishFormatProperties></profile>",
    };
    const { deps } = fakeDeps(info, { ...fixture.audit, findings: [] });
    const result = await runPreflightPublish(undefined, deps);
    assert.equal(result.checks.publishFormats.status, "unchecked");
    assert.deepEqual(result.checks.publishFormats.formats, []);
});

test("preflight marks unsaved and unsupported documents without guessing a publish result", async () => {
    const info = { name: "untitled", pathURI: "", type: "Unknown", profile: "" };
    const { deps } = fakeDeps(info);
    const result = await runPreflightPublish(undefined, deps);

    assert.deepEqual(result.checks, {
        saved: { status: "unchecked", detail: "Unsupported type: Unknown." },
        documentType: { status: "unchecked", detail: "Unsupported type: Unknown." },
        publishFormats: { status: "unchecked", detail: "Unsupported type: Unknown.", formats: [] },
        outputFiles: {
            status: "unchecked",
            detail: "Unsupported type: Unknown.",
            candidates: [],
            warnings: [],
        },
        compilation: { status: "unchecked", detail: "Unsupported type: Unknown." },
    });
});

test("preflight fails an all-disabled publish profile and rejects a document switch", async () => {
    const info = {
        ...fixture.document,
        profile: `<PublishFormatProperties><publishFormat id="svg-id">0</publishFormat><publishFormat id="js-id">0</publishFormat></PublishFormatProperties><PublishProperties id="svg-id" name="SVG Image"></PublishProperties><PublishProperties id="js-id" name="JavaScript/HTML"></PublishProperties>`,
    };
    const { deps } = fakeDeps(info, fixture.audit, {
        ...info,
        outputFiles: [{ name: "animation.html", exists: false }],
    });
    const allDisabled = await runPreflightPublish(undefined, deps);
    assert.equal(allDisabled.checks.publishFormats.status, "fail");

    const changed = fakeDeps(info, { ...fixture.audit, document: "another.fla" });
    await assert.rejects(runPreflightPublish(undefined, changed.deps), /Document changed during preflight/);
});

test("preflight leaves traversal-like profile filenames unchecked without probing them", async () => {
    const info = {
        ...fixture.document,
        type: "Flash",
        profile: "<PublishProfile><html>1</html><htmlFileName>%2e%2e/secret.html</htmlFileName></PublishProfile>",
    };
    const { deps, calls } = fakeDeps(info, { ...fixture.audit, findings: [] });
    const result = await runPreflightPublish(undefined, deps);

    assert.equal(result.checks.outputFiles.status, "unchecked");
    assert.deepEqual(calls[2].vars.__outputFiles, []);
});

test("preflight probes only enabled format filenames and leaves default or incomplete mappings unchecked", async () => {
    /**
     * Runs preflight against a publish profile fixture.
     * @param profile XML profile content to test.
     * @returns The tool result and captured JSFL calls.
     */
    async function runWithProfile(profile: string) {
        const info = { ...fixture.document, type: "Flash", profile };
        const { deps, calls } = fakeDeps(info, { ...fixture.audit, findings: [] });
        const result = await runPreflightPublish(undefined, deps);
        return { result, calls };
    }

    const enabledOnly = await runWithProfile(
        "<PublishProfile><html>1</html><gif>0</gif><jpeg>0</jpeg><png>0</png><svg>0</svg><projectorWin>0</projectorWin>" +
            "<htmlFileName>animation.html</htmlFileName><jsFileName>animation.js</jsFileName>" +
            "<gifFileName>animation.gif</gifFileName><jpegFileName>animation.jpg</jpegFileName>" +
            "<pngFileName>animation.png</pngFileName><svgFileName>animation.svg</svgFileName>" +
            "<projectorWinFileName>animation.exe</projectorWinFileName></PublishProfile>",
    );
    assert.deepEqual(enabledOnly.result.checks.publishFormats.formats, [
        { name: "html", enabled: true },
        { name: "gif", enabled: false },
        { name: "jpeg", enabled: false },
        { name: "png", enabled: false },
        { name: "svg", enabled: false },
        { name: "projectorWin", enabled: false },
    ]);
    assert.deepEqual(enabledOnly.result.checks.outputFiles.candidates, ["animation.html", "animation.js"]);
    assert.equal(enabledOnly.result.checks.outputFiles.status, "pass");

    const defaultNames = await runWithProfile(
        "<PublishProfile><html>1</html><defaultNames>1</defaultNames>" +
            "<htmlFileName>animation.html</htmlFileName></PublishProfile>",
    );
    assert.equal(defaultNames.result.checks.outputFiles.status, "unchecked");
    assert.deepEqual(defaultNames.result.checks.outputFiles.candidates, []);
    assert.deepEqual(defaultNames.calls[2].vars.__outputFiles, []);

    const ambiguous = await runWithProfile(
        "<PublishProfile><html>1</html><gif>1</gif>" + "<htmlFileName>animation.html</htmlFileName></PublishProfile>",
    );
    assert.equal(ambiguous.result.checks.outputFiles.status, "unchecked");
    assert.deepEqual(ambiguous.result.checks.outputFiles.candidates, ["animation.html"]);
});

test("preflight checks AIR descriptors, icons, and target-specific assets", async () => {
    const directory = new URL("../fixtures/preflight-publish/air/", import.meta.url);
    const cases = [
        ["desktop", "desktop", "pass", "pass"],
        ["mismatched-icon", "desktop", "unchecked", "pass"],
        ["malformed-xml", "android", "unchecked", "unchecked"],
        ["comment-only-fields", "android", "unchecked", "warning"],
        ["wrong-size", "desktop", "fail", "pass"],
        ["missing-icon", "desktop", "fail", "pass"],
        ["escaping-icon", "desktop", "unchecked", "pass"],
        ["missing-descriptor", "desktop", "unchecked", "unchecked"],
        ["ios-missing-assets", "ios", "unchecked", "fail"],
        ["ios-assets", "ios", "unchecked", "pass"],
        ["android-no-resdir", "android", "unchecked", "warning"],
        ["android-missing-resdir", "android", "unchecked", "fail"],
        ["android-present-resdir", "android", "unchecked", "pass"],
        ["android-wrong-name-resdir", "android", "unchecked", "warning"],
    ] as const;

    for (const [name, target, iconStatus, targetStatus] of cases) {
        const nested = ["ios-assets", "android-present-resdir", "android-wrong-name-resdir"].includes(name);
        const path = new URL(`${name}.fla`, nested ? new URL(`${name}/`, directory) : directory);
        const info = {
            name: `${name}.fla`,
            pathURI: path.href,
            platformPath: fileURLToPath(path),
            type: "Flash",
            playerTarget: `AIR 51.3.1.2 for ${target === "ios" ? "iOS" : target[0].toUpperCase() + target.slice(1)}`,
            profile: "",
        };
        const { deps } = fakeDeps(info, { ...fixture.audit, document: info.name, findings: [] });
        const result = await runPreflightPublish(undefined, deps);
        assert.equal(result.checks.air.target.target, target, name);
        assert.equal(result.checks.air.icons.status, iconStatus, name);
        if (target === "ios") {
            assert.equal(result.checks.air.iosAssetsCar.status, targetStatus, name);
        }
        if (target === "android") {
            assert.equal(result.checks.air.androidAdaptiveIcon.status, targetStatus, name);
        }
        if (name === "missing-descriptor") {
            assert.equal(result.checks.air.descriptor.status, "unchecked");
            assert.match(
                result.checks.air.descriptor.detail,
                /AIR descriptor not found at .*missing-descriptor-app\.xml/,
            );
            assert.match(result.checks.air.descriptor.detail, /may create it during Publish \(unverified\)/);
            assert.equal(result.checks.air.identity.status, "unchecked");
            assert.equal(result.checks.air.signing.status, "unchecked");
        }
        if (name === "mismatched-icon" || name === "malformed-xml") {
            assert.equal(result.checks.air.descriptor.status, "fail");
            assert.equal(result.checks.air.identity.status, "unchecked");
            assert.equal(result.checks.air.icons.status, "unchecked");
        }
        if (name === "comment-only-fields") {
            assert.equal(result.checks.air.descriptor.status, "pass");
            assert.equal(result.checks.air.identity.status, "fail");
            assert.equal(result.checks.air.icons.status, "unchecked");
            assert.equal(result.checks.air.androidAdaptiveIcon.status, "warning");
        }
        if (name === "desktop") {
            assert.equal(result.checks.air.descriptor.status, "pass");
            assert.equal(result.checks.air.identity.status, "pass");
            assert.equal(result.checks.air.icons.items[0].status, "pass");
            assert.equal(result.checks.air.signing.status, "unchecked");
        }
    }
});

test("non-AIR Flash preflight does not add AIR checks", async () => {
    const info = { ...fixture.document, type: "Flash" };
    const { deps } = fakeDeps(info, { ...fixture.audit, findings: [] });
    const result = await runPreflightPublish(undefined, deps);
    assert.equal("air" in result.checks, false);
});
