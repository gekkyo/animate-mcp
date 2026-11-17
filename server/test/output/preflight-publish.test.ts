import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runPreflightPublish } from "../../src/tools/output/preflight-publish.js";
import type { ToolDeps } from "../../src/tools/shared.js";

const fixture = JSON.parse(await readFile("server/test/fixtures/preflight-publish/active-canvas.json", "utf8")) as {
    document: { name: string; pathURI: string; type: string; profile: string };
    existingOutputs: string[];
    audit: { document: string; findings: unknown[]; warnings: string[] };
};
fixture.document.profile = await readFile("server/test/fixtures/preflight-publish/canvas-profile.xml", "utf8");
const preflightJsfl = await readFile("server/jsfl/output/preflight-publish.jsfl", "utf8");
/**
 * Returns the requested JSFL fixture bundle.
 * @param names Bundle names requested by the tool.
 * @returns The requested JSFL source.
 */
function fakeBundle(...names: string[]) {
    return names.includes("preflight-publish") ? preflightJsfl : names.join(" ");
}

test("preflight reports documented checks and existing audit findings without publishing or writing", async () => {
    const calls: string[] = [];
    const result = await runPreflightPublish(undefined, {
        bundle: (...names) => {
            calls.push(`bundle:${names.join(",")}`);
            return fakeBundle(...names);
        },
        runner: {
            execute: async (script) => {
                calls.push(script);
                if (script.includes("audit-document")) {
                    return JSON.stringify(fixture.audit);
                }
                if (script.includes("__expectedName")) {
                    const requested = JSON.parse(script.match(/var __outputFiles = (.*?);\n/)?.[1] ?? "[]") as {
                        name: string;
                    }[];
                    return JSON.stringify({
                        ...fixture.document,
                        sameDocument: true,
                        outputFiles: requested.map(({ name }) => ({
                            name,
                            exists: fixture.existingOutputs.includes(name),
                        })),
                    });
                }
                return JSON.stringify(fixture.document);
            },
        },
    });

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
    assert.equal(
        calls.some((call) => call.includes("publishDocument")),
        false,
    );
    assert.equal(
        calls.some((call) => call.includes("FLfile.write")),
        false,
    );
    assert.equal(
        calls.some((call) => call.includes("FLfile.exists")),
        true,
    );
    const outputProbe = calls.find((call) => call.includes("var __outputFiles = "));
    assert.ok(outputProbe);
    assert.deepEqual(
        JSON.parse(outputProbe.match(/var __outputFiles = (.*?);\n/)?.[1] ?? "[]").map(
            (candidate: { name: string }) => candidate.name,
        ),
        [],
    );
});

test("preflight does not fail an HTML5 Canvas profile without recognized format flags", async () => {
    const info = {
        ...fixture.document,
        profile: "<profile><PublishFormatProperties></PublishFormatProperties></profile>",
    };
    const result = await runPreflightPublish(undefined, {
        bundle: fakeBundle,
        runner: {
            execute: async (script) => {
                if (script.includes("audit-document")) {
                    return JSON.stringify({ ...fixture.audit, findings: [] });
                }
                if (script.includes("__expectedName")) {
                    return JSON.stringify({ ...info, sameDocument: true, outputFiles: [] });
                }
                return JSON.stringify(info);
            },
        },
    });
    assert.equal(result.checks.publishFormats.status, "unchecked");
    assert.deepEqual(result.checks.publishFormats.formats, []);
});

test("preflight marks unsaved and unsupported documents without guessing a publish result", async () => {
    const info = { name: "untitled", pathURI: "", type: "Unknown", profile: "" };
    const result = await runPreflightPublish(undefined, {
        bundle: fakeBundle,
        runner: {
            execute: async (script) =>
                script.includes("audit-document") ? JSON.stringify(fixture.audit) : JSON.stringify(info),
        },
    });

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
    const allDisabled = await runPreflightPublish(undefined, {
        bundle: (...names) => names.join(" "),
        runner: {
            execute: async (script) => {
                if (script.includes("audit-document")) {
                    return JSON.stringify(fixture.audit);
                }
                if (script.includes("__expectedName")) {
                    return JSON.stringify({
                        ...info,
                        sameDocument: true,
                        outputFiles: [{ name: "animation.html", exists: false }],
                    });
                }
                return JSON.stringify(info);
            },
        },
    });
    assert.equal(allDisabled.checks.publishFormats.status, "fail");

    await assert.rejects(
        runPreflightPublish(undefined, {
            bundle: fakeBundle,
            runner: {
                execute: async (script) =>
                    script.includes("audit-document")
                        ? JSON.stringify({ ...fixture.audit, document: "another.fla" })
                        : JSON.stringify(info),
            },
        }),
        /Document changed during preflight/,
    );
});

test("preflight leaves traversal-like profile filenames unchecked without probing them", async () => {
    const info = {
        ...fixture.document,
        type: "Flash",
        profile: "<PublishProfile><html>1</html><htmlFileName>%2e%2e/secret.html</htmlFileName></PublishProfile>",
    };
    const scripts: string[] = [];
    const result = await runPreflightPublish(undefined, {
        bundle: fakeBundle,
        runner: {
            execute: async (script) => {
                scripts.push(script);
                if (script.includes("audit-document")) {
                    return JSON.stringify({ ...fixture.audit, findings: [] });
                }
                if (script.includes("__expectedName")) {
                    return JSON.stringify({ ...info, sameDocument: true, outputFiles: [] });
                }
                return JSON.stringify(info);
            },
        },
    });

    assert.equal(result.checks.outputFiles.status, "unchecked");
    const probeScript = scripts.find((script) => script.includes("__outputFiles ="));
    assert.ok(probeScript);
    assert.match(probeScript, /__outputFiles = \[\]/);
    assert.equal(probeScript.includes("FLfile.exists"), true);
});

test("preflight probes only enabled format filenames and leaves default or incomplete mappings unchecked", async () => {
    /**
     * Runs preflight against a publish profile fixture.
     * @param profile XML profile content to test.
     * @returns The tool result and captured scripts.
     */
    async function runWithProfile(profile: string) {
        const scripts: string[] = [];
        const info = { ...fixture.document, type: "Flash", profile };
        const result = await runPreflightPublish(undefined, {
            bundle: fakeBundle,
            runner: {
                execute: async (script) => {
                    scripts.push(script);
                    if (script.includes("audit-document")) {
                        return JSON.stringify({ ...fixture.audit, findings: [] });
                    }
                    if (script.includes("__expectedName")) {
                        const requested = JSON.parse(script.match(/var __outputFiles = (.*?);\n/)?.[1] ?? "[]") as {
                            name: string;
                        }[];
                        return JSON.stringify({
                            ...info,
                            sameDocument: true,
                            outputFiles: requested.map(({ name }) => ({ name, exists: false })),
                        });
                    }
                    return JSON.stringify(info);
                },
            },
        });
        return { result, scripts };
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
    assert.equal(
        defaultNames.scripts.some((script) => script.includes("__outputFiles = []")),
        true,
    );

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
        const deps: ToolDeps = {
            bundle: fakeBundle,
            runner: {
                execute: async (script) => {
                    if (script.includes("audit-document")) {
                        return JSON.stringify({ ...fixture.audit, document: info.name, findings: [] });
                    }
                    if (script.includes("__expectedName")) {
                        return JSON.stringify({ ...info, sameDocument: true, outputFiles: [] });
                    }
                    return JSON.stringify(info);
                },
            },
        };
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
    const deps: ToolDeps = {
        bundle: fakeBundle,
        runner: {
            execute: async (script) => {
                if (script.includes("audit-document")) {
                    return JSON.stringify({ ...fixture.audit, findings: [] });
                }
                if (script.includes("__expectedName")) {
                    return JSON.stringify({ ...info, sameDocument: true, outputFiles: [] });
                }
                return JSON.stringify(info);
            },
        },
    };
    const result = await runPreflightPublish(undefined, deps);
    assert.equal("air" in result.checks, false);
});
