import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { preflightPublishTool } from "../../src/tools/output/preflight-publish.js";

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
    const result = await preflightPublishTool.run(
        { document: undefined } as never,
        {
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
        },
        {} as never,
    );

    assert.deepEqual(result.data, {
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
    const result = await preflightPublishTool.run(
        { document: undefined } as never,
        {
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
        },
        {} as never,
    );
    assert.equal(result.data.checks.publishFormats.status, "unchecked");
    assert.deepEqual(result.data.checks.publishFormats.formats, []);
});

test("preflight marks unsaved and unsupported documents without guessing a publish result", async () => {
    const info = { name: "untitled", pathURI: "", type: "Unknown", profile: "" };
    const result = await preflightPublishTool.run(
        { document: undefined } as never,
        {
            bundle: fakeBundle,
            runner: {
                execute: async (script) =>
                    script.includes("audit-document") ? JSON.stringify(fixture.audit) : JSON.stringify(info),
            },
        },
        {} as never,
    );

    assert.deepEqual(result.data.checks, {
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
    const allDisabled = await preflightPublishTool.run(
        { document: undefined } as never,
        {
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
        },
        {} as never,
    );
    assert.equal(allDisabled.data.checks.publishFormats.status, "fail");

    await assert.rejects(
        preflightPublishTool.run(
            { document: undefined } as never,
            {
                bundle: fakeBundle,
                runner: {
                    execute: async (script) =>
                        script.includes("audit-document")
                            ? JSON.stringify({ ...fixture.audit, document: "another.fla" })
                            : JSON.stringify(info),
                },
            },
            {} as never,
        ),
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
    const result = await preflightPublishTool.run(
        { document: undefined } as never,
        {
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
        },
        {} as never,
    );

    assert.equal(result.data.checks.outputFiles.status, "unchecked");
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
        const result = await preflightPublishTool.run(
            { document: undefined } as never,
            {
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
            },
            {} as never,
        );
        return { result: result.data, scripts };
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
