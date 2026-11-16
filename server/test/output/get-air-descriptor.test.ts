import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGetAirDescriptor } from "../../src/tools/output/get-air-descriptor.js";
import type { ToolDeps } from "../../src/tools/shared.js";

const deps: ToolDeps = {
    bundle: (...names) => names.join(" "),
    runner: {
        execute: async () => {
            throw new Error("Animate should not run");
        },
    },
};
const expectedIds = { desktop: "test-desktop", android: "android", ios: "jp.papipop.sample" };

test("reads the whitelisted AIR descriptor fields without Animate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        for (const platform of ["desktop", "android", "ios"]) {
            const path = join(dir, `${platform}-app.xml`);
            await writeFile(path, await readFile(`air-sample/${platform}-app.xml`));
            const result = await runGetAirDescriptor({ descriptorPath: path }, deps);
            assert.equal(result.id, expectedIds[platform as keyof typeof expectedIds]);
            assert.equal(result.versionNumber, "1.0");
            assert.equal(result.renderMode, "auto");
            assert.equal(Object.keys(result.icon as object).length, 1);
            assert.match(Object.values(result.icon as Record<string, string>)[0], /^icon\/icon\d+\.png$/);
            assert.deepEqual(result.extensions, []);
            assert.equal("description" in result, false);
            assert.equal("playerTarget" in result, false);
            if (platform === "android" || platform === "ios") {
                assert.equal(result.manifestAdditions, "<manifest></manifest>");
            }
            if (platform === "ios") {
                assert.equal(typeof result.InfoAdditions, "string");
            }
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("rejects ambiguous, invalid, missing, and malformed descriptor paths", async () => {
    await assert.rejects(
        runGetAirDescriptor({ document: "a.fla", descriptorPath: "/tmp/a-app.xml" }, deps),
        /not both/,
    );
    await assert.rejects(runGetAirDescriptor({ descriptorPath: "relative-app.xml" }, deps), /absolute path/);
    await assert.rejects(runGetAirDescriptor({ descriptorPath: "/tmp/not-a-descriptor.xml" }, deps), /absolute path/);
    await assert.rejects(runGetAirDescriptor({ descriptorPath: "/tmp/missing-app.xml" }, deps), /not present/);

    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        const path = join(dir, "broken-app.xml");
        await writeFile(path, "<application><id>broken</application>");
        await assert.rejects(runGetAirDescriptor({ descriptorPath: path }, deps), /not valid XML/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("document resolution uses Animate and reports playerTarget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "air-descriptor-"));
    try {
        await writeFile(join(dir, "desktop-app.xml"), await readFile("air-sample/desktop-app.xml"));
        const result = await runGetAirDescriptor(
            { document: "desktop.fla" },
            {
                bundle: () => "bundle",
                runner: {
                    execute: async () =>
                        JSON.stringify({
                            name: "desktop.fla",
                            platformPath: join(dir, "desktop.fla"),
                            playerTarget: "AIR 51.3 for Desktop",
                        }),
                },
            },
        );
        assert.equal(result.playerTarget, "AIR 51.3 for Desktop");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
