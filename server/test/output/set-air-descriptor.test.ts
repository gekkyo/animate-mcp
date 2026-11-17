import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SaxesParser } from "saxes";
import { runSetAirDescriptor } from "../../src/tools/output/set-air-descriptor.js";
import type { ToolDeps } from "../../src/tools/core/shared.js";
import { text, withServer } from "../helpers/fake-animate.js";

const deps: ToolDeps = {
    bundle: (...names) => names.join(" "),
    runner: {
        execute: async () => {
            throw new Error("Animate should not run");
        },
    },
};

test("patches fields while preserving comments and creates a backup; dry run writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        const original = await readFile("air-sample/desktop-app.xml", "utf8");
        await writeFile(path, original);
        const preview = await runSetAirDescriptor({ descriptorPath: path, id: "updated&app", dryRun: true }, deps);
        assert.equal(await readFile(path, "utf8"), original);
        await assert.rejects(readFile(`${path}.bak`));
        assert.match(String(preview.diff), /updated&amp;app/);
        assert.match(String(preview.diff), /@@ offset \d+ @@/);
        assert.doesNotMatch(String(preview.diff), /To localize the description/);
        await runSetAirDescriptor({ descriptorPath: path, id: "updated&app", renderMode: "gpu" }, deps);
        const updated = await readFile(path, "utf8");
        assert.equal(await readFile(`${path}.bak`, "utf8"), original);
        assert.match(updated, /<!--/);
        assert.match(updated, /<id>updated&amp;app<\/id>/);
        assert.match(updated, /<renderMode>gpu<\/renderMode>/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("deletes optional fields and rejects invalid values and ambiguous input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        const sample = (await readFile("air-sample/desktop-app.xml", "utf8")).replace(
            "<versionNumber>1.0</versionNumber>",
            "<versionNumber>1.0</versionNumber>\n    <versionLabel/>",
        );
        await writeFile(path, sample);
        await assert.rejects(runSetAirDescriptor({ descriptorPath: path, id: null }, deps), /cannot be deleted/);
        await assert.rejects(
            runSetAirDescriptor(
                { descriptorPath: path, renderMode: "bad" } as unknown as Parameters<typeof runSetAirDescriptor>[0],
                deps,
            ),
            /renderMode must be/,
        );
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, document: "desktop.fla", fullScreen: true }, deps),
            /not both/,
        );
        await runSetAirDescriptor({ descriptorPath: path, versionLabel: "Release" }, deps);
        assert.match(await readFile(path, "utf8"), /<versionLabel>Release<\/versionLabel>/);
        await runSetAirDescriptor({ descriptorPath: path, versionLabel: null }, deps);
        assert.doesNotMatch(await readFile(path, "utf8"), /<versionLabel>/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("updates self-closing target elements and refuses whole-list replacement over comments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        const xml = (await readFile("air-sample/desktop-app.xml", "utf8")).replace(/<icon>[\s\S]*?<\/icon>/, "<icon/>");
        await writeFile(path, xml);
        await runSetAirDescriptor({ descriptorPath: path, icon: { image128x128: "icon/new.png" } }, deps);
        assert.match(await readFile(path, "utf8"), /<icon>\s*<image128x128>icon\/new\.png<\/image128x128>\s*<\/icon>/);

        const commented = (await readFile(path, "utf8")).replace("<icon>", "<icon><!-- keep this note -->");
        await writeFile(path, commented);
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, icon: { image128x128: "icon/other.png" } }, deps),
            /contains comments or CDATA/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("rejects deletion of icon/extensions containing comments or CDATA", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        const xml = (await readFile("air-sample/desktop-app.xml", "utf8")).replace(
            "<icon>",
            "<icon><!-- retain this comment -->",
        );
        await writeFile(path, xml);
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, icon: null }, deps),
            /contains comments or CDATA/,
        );
        await writeFile(
            path,
            xml.replace("</application>", "<extensions><![CDATA[retain]]></extensions></application>"),
        );
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, extensions: null }, deps),
            /contains comments or CDATA/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("registered set_air_descriptor rejects unknown and read-only fields before writing", async () => {
    await withServer({}, async (client, tempDir) => {
        const path = join(tempDir, "strict-app.xml");
        const original = await readFile("air-sample/desktop-app.xml", "utf8");
        await writeFile(path, original);
        for (const field of ["unexpected", "filename"]) {
            const result = await client.callTool({
                name: "set_air_descriptor",
                arguments: { descriptorPath: path, id: "should-not-write", [field]: "not-writable" },
            });
            assert.equal(result.isError, true, text(result));
            assert.equal(await readFile(path, "utf8"), original);
            await assert.rejects(readFile(`${path}.bak`));
        }
    });
});

test("creates missing platform additions and validates icon locations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        await writeFile(path, await readFile("air-sample/desktop-app.xml"));
        await runSetAirDescriptor({ descriptorPath: path, manifestAdditions: "<manifest/>" }, deps);
        const updated = await readFile(path, "utf8");
        assert.match(
            updated,
            /<android><manifestAdditions><!\[CDATA\[<manifest\/>\]\]><\/manifestAdditions><\/android>/,
        );
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, icon: { image36x36: "../outside.png" } }, deps),
            /inside the descriptor folder/,
        );
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: join(dir, "missing-app.xml"), id: "test" }, deps),
            /not found at .*missing-app\.xml.*may create it during Publish \(unverified\)/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("rejects icon paths that escape through a symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const descriptorDir = join(dir, "descriptor");
        const iconDir = join(descriptorDir, "icon");
        const path = join(descriptorDir, "desktop-app.xml");
        const outsideIcon = join(dir, "outside.png");
        await mkdir(iconDir, { recursive: true });
        await writeFile(path, await readFile("air-sample/desktop-app.xml"));
        await writeFile(outsideIcon, "outside");
        await symlink(outsideIcon, join(iconDir, "escape.png"));

        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, icon: { image36x36: "icon/escape.png" } }, deps),
            /inside the descriptor folder/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("handles prefixed namespaces and self-closing platform and window elements", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "prefixed-app.xml");
        await writeFile(
            path,
            '<a:application xmlns:a="http://ns.adobe.com/air/application/51.3"><a:initialWindow id="window"/><a:android/><a:iPhone/><a:icon><a:image16x16>old.png</a:image16x16></a:icon><a:extensions/></a:application>',
        );
        await runSetAirDescriptor(
            {
                descriptorPath: path,
                renderMode: "gpu",
                aspectRatio: "portrait",
                manifestAdditions: "<manifest/>",
                InfoAdditions: "<plist/>",
                icon: { image1024x1024: "icon/large.png" },
                extensions: ["com.example.extension"],
            },
            deps,
        );
        const updated = await readFile(path, "utf8");
        assert.match(
            updated,
            /<a:initialWindow id="window"><a:renderMode>gpu<\/a:renderMode><a:aspectRatio>portrait<\/a:aspectRatio><\/a:initialWindow>/,
        );
        assert.match(
            updated,
            /<a:android><a:manifestAdditions><!\[CDATA\[<manifest\/>\]\]><\/a:manifestAdditions><\/a:android>/,
        );
        assert.match(updated, /<a:iPhone><a:InfoAdditions><!\[CDATA\[<plist\/>\]\]><\/a:InfoAdditions><\/a:iPhone>/);
        assert.match(updated, /<a:image1024x1024>icon\/large\.png<\/a:image1024x1024>/);
        assert.match(updated, /<a:extensionID>com\.example\.extension<\/a:extensionID>/);

        const absentPath = join(dir, "absent-containers-app.xml");
        await writeFile(
            absentPath,
            '<a:application xmlns:a="http://ns.adobe.com/air/application/51.3"><a:initialWindow/></a:application>',
        );
        await runSetAirDescriptor(
            {
                descriptorPath: absentPath,
                icon: { image1024x1024: "icon/large.png" },
                extensions: ["com.example.extension"],
            },
            deps,
        );
        const absentUpdated = await readFile(absentPath, "utf8");
        assert.match(absentUpdated, /<a:icon>\s*<a:image1024x1024>icon\/large\.png<\/a:image1024x1024>/);
        assert.match(absentUpdated, /<a:extensions>\s*<a:extensionID>com\.example\.extension<\/a:extensionID>/);
        for (const document of [updated, absentUpdated]) {
            const childUris: string[] = [];
            const parser = new SaxesParser({ xmlns: true });
            parser.on("opentag", (tag) => {
                if (tag.local === "image1024x1024" || tag.local === "extensionID") {
                    childUris.push(tag.uri);
                }
            });
            parser.write(document).close();
            assert.deepEqual(childUris, [
                "http://ns.adobe.com/air/application/51.3",
                "http://ns.adobe.com/air/application/51.3",
            ]);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("serializes concurrent edits and accepts AIR 51.3 icon sizes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "concurrent-app.xml");
        await writeFile(path, await readFile("air-sample/desktop-app.xml"));
        await Promise.all([
            runSetAirDescriptor({ descriptorPath: path, versionLabel: "Concurrent" }, deps),
            runSetAirDescriptor(
                { descriptorPath: path, icon: { image320x320: "icon/medium.png", image1024x1024: "icon/large.png" } },
                deps,
            ),
        ]);
        const updated = await readFile(path, "utf8");
        assert.match(updated, /<versionLabel>Concurrent<\/versionLabel>/);
        assert.match(updated, /<image320x320>icon\/medium\.png<\/image320x320>/);
        assert.match(updated, /<image1024x1024>icon\/large\.png<\/image1024x1024>/);
        assert.notEqual(await readFile(`${path}.bak`, "utf8"), updated);
        await assert.rejects(
            runSetAirDescriptor({ descriptorPath: path, icon: { image64x64: "icon/unsupported.png" } }, deps),
            /Invalid AIR icon size name/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("supports document resolution, cross-platform notes, icons, and extensions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "desktop-app.xml");
        await writeFile(path, await readFile("air-sample/desktop-app.xml"));
        const result = await runSetAirDescriptor(
            {
                document: "desktop.fla",
                InfoAdditions: "<plist/>",
                manifestAdditions: "<manifest/>",
                icon: { image128x128: "icon/app.png" },
                extensions: ["com.example.extension"],
            },
            {
                bundle: () => "bundle",
                runner: {
                    execute: async () =>
                        JSON.stringify({
                            name: "desktop.fla",
                            platformPath: join(dir, "desktop.fla"),
                            playerTarget: "AIR 51.3 for Android",
                        }),
                },
            },
        );
        assert.equal(result.playerTarget, "AIR 51.3 for Android");
        assert.ok(result.notes);
        const updated = await readFile(path, "utf8");
        assert.match(updated, /<iPhone><InfoAdditions><!\[CDATA\[<plist\/>\]\]><\/InfoAdditions><\/iPhone>/);
        assert.match(
            updated,
            /<android><manifestAdditions><!\[CDATA\[<manifest\/>\]\]><\/manifestAdditions><\/android>/,
        );
        assert.match(updated, /<image128x128>icon\/app\.png<\/image128x128>/);
        assert.match(updated, /<extensionID>com\.example\.extension<\/extensionID>/);
        assert.ok(updated.indexOf("<android>") < updated.indexOf("<iPhone>"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
