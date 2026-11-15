import assert from "node:assert/strict";
import { test } from "node:test";
import { stateLog, text, withServer } from "../helpers/fake-animate.js";

test("audit_document reports review-only hygiene suggestions and restores document state", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_AUDIT_FIXTURES: "1",
            FAKE_NO_BROKEN: "1",
            FAKE_INITIAL_CURRENT_LAYER: "1",
            FAKE_INITIAL_CURRENT_FRAME: "2",
            FAKE_INITIAL_SELECTED_FRAMES: "[1,0,2]",
        },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "audit_document", arguments: {} });
            assert.equal(result.isError, undefined, text(result));
            const audit = result.structuredContent as {
                findings: {
                    unusedLibraryItems: {
                        category: string;
                        severity: string;
                        location: string;
                        message: string;
                        item?: string;
                        linkage?: boolean;
                    }[];
                    emptyKeyframes: {
                        category: string;
                        severity: string;
                        location: string;
                        message: string;
                        item?: string;
                        linkage?: boolean;
                    }[];
                    defaultNames: {
                        category: string;
                        severity: string;
                        location: string;
                        message: string;
                        item?: string;
                        linkage?: boolean;
                    }[];
                };
                warnings: string[];
            };
            assert.deepEqual(audit.warnings, []);
            const empty = audit.findings.emptyKeyframes[0];
            assert.equal(empty?.location, 'scene "Scene 1" / layer "Layer 1" / keyframe 1 (span 1-5)');
            assert.equal(
                audit.findings.emptyKeyframes.some(
                    (finding) => finding.location === 'scene "Scene 1" / layer "Layer 1" / keyframe 2 (span 1-5)',
                ),
                false,
            );
            assert.ok(audit.findings.defaultNames.some((finding) => finding.location === 'Library item "Symbol 1"'));
            assert.ok(
                audit.findings.defaultNames.some((finding) => finding.location === 'scene "Scene 1" / layer "Layer 1"'),
            );
            assert.ok(
                audit.findings.defaultNames.some(
                    (finding) => finding.location === 'scene "Scene 1" / layer "レイヤー 2"',
                ),
            );
            assert.ok(audit.findings.defaultNames.some((finding) => finding.location === 'Library item "シンボル 2"'));
            assert.equal(
                audit.findings.emptyKeyframes.some((finding) => finding.location.includes('layer "レイヤー 2"')),
                false,
            );
            assert.equal(
                audit.findings.emptyKeyframes.some((finding) => finding.location.includes('layer "Audio only"')),
                false,
            );
            const linked = audit.findings.unusedLibraryItems.find((finding) => finding.item === "Linked");
            assert.equal(linked?.linkage, true);
            assert.match(linked?.message ?? "", /must not be treated as safe to delete/);
            for (const item of ["Font", "Bitmap"]) {
                const finding = audit.findings.unusedLibraryItems.find((entry) => entry.item === item);
                assert.equal(finding?.severity, "info");
                assert.match(finding?.message ?? "", /may be referenced by text or fills/);
                assert.match(finding?.message ?? "", /must not be treated as safe to delete/);
            }
            assert.equal(
                audit.findings.unusedLibraryItems.find((finding) => finding.item === "Folder/Unused")?.severity,
                "warning",
            );
            assert.equal(
                audit.findings.unusedLibraryItems.some((finding) => finding.item === "Sound"),
                false,
            );
            assert.ok(audit.findings.unusedLibraryItems.some((finding) => finding.item === "constructor"));
            assert.ok(audit.findings.unusedLibraryItems.some((finding) => finding.item === "toString"));
            assert.equal(
                audit.findings.unusedLibraryItems.some((finding) => finding.item === "Folder"),
                false,
            );
            assert.equal(
                audit.findings.unusedLibraryItems.some((finding) => finding.item === "Folder/Symbol 3"),
                false,
            );
            assert.ok(audit.findings.unusedLibraryItems.some((finding) => finding.item === "Folder/Unused"));
            assert.ok(
                Object.values(audit.findings)
                    .flat()
                    .every((finding) => finding.severity === "info" || finding.severity === "warning"),
            );
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 1,
                currentFrame: 2,
                selectedFrames: [1, 0, 2],
                selectedElements: 0,
            });
        },
    );
});

test("audit_document warns and suppresses unused findings when selection restoration fails", {
    timeout: 30_000,
}, async () => {
    await withServer(
        {
            FAKE_AUDIT_FIXTURES: "1",
            FAKE_AUDIT_RESTORE_FAIL: "1",
            FAKE_INITIAL_SELECTED_FRAMES: "[0,0,1]",
        },
        async (client, tempDir) => {
            const result = await client.callTool({ name: "audit_document", arguments: {} });
            assert.equal(result.isError, undefined, text(result));
            const audit = result.structuredContent as {
                findings: { unusedLibraryItems: unknown[] };
                warnings: string[];
            };
            assert.ok(audit.warnings.some((warning) => warning.includes("fake audit selection restore failure")));
            assert.deepEqual(audit.findings.unusedLibraryItems, []);
            assert.deepEqual((await stateLog(tempDir)).at(-1), {
                currentLayer: 0,
                currentFrame: 0,
                selectedFrames: [0, 0, 1],
                selectedElements: 0,
            });
        },
    );
});
