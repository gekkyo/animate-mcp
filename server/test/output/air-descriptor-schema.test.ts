import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const fixtureRoot = "server/test/fixtures/preflight-publish/air";
const invalidFixtures = [
    join(fixtureRoot, "comment-only-fields-app.xml"),
    join(fixtureRoot, "malformed-xml-app.xml"),
    join(fixtureRoot, "mismatched-icon-app.xml"),
].sort();

/**
 * Lists AIR descriptor fixtures recursively so new descriptors join the schema gate.
 * @param directory Fixture directory to inspect.
 * @returns Paths of descriptor fixtures under the directory.
 */
async function descriptorFixtures(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.filter((entry) => entry.isDirectory()).map((entry) => descriptorFixtures(join(directory, entry.name))),
    );
    return [
        ...entries
            .filter((entry) => entry.isFile() && entry.name.endsWith("-app.xml"))
            .map((entry) => join(directory, entry.name)),
        ...nested.flat(),
    ].sort();
}

/**
 * Finds the installed AIR 51.3 descriptor schema from an override or Animate's SDK registry.
 * @returns The schema path, or undefined when no matching SDK is installed.
 */
async function descriptorSchema(): Promise<string | undefined> {
    const sdkRoots = [process.env.AIR_SDK_PATH, process.env.AIRSDK_HOME].filter((root): root is string =>
        Boolean(root),
    );
    for (const root of sdkRoots) {
        const schema = `${root}/templates/air/Descriptor.51.3.xsd`;
        try {
            await access(schema);
            return schema;
        } catch {
            // Check the SDK registry below.
        }
    }
    const adobeDirectory = `${process.env.HOME}/Library/Application Support/Adobe`;
    let animateDirectories: string[] = [];
    try {
        animateDirectories = (await readdir(adobeDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name.startsWith("Animate "))
            .map((entry) => `${adobeDirectory}/${entry.name}`);
    } catch {
        // SDK discovery is optional on CI.
    }
    const lists = sdkRoots.map((root) => `${root}/AirSdkList.xml`);
    for (const directory of animateDirectories) {
        try {
            const locales = await readdir(directory, { withFileTypes: true });
            lists.push(
                ...locales
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => `${directory}/${entry.name}/Configuration/AIRSDK/AirSdkList.xml`),
            );
        } catch {
            // Continue through installed Animate versions.
        }
    }
    for (const list of lists) {
        try {
            const content = await readFile(list, "utf8");
            const roots = [...content.matchAll(/<sdk\b[^>]*\bpath="([^"]+)"/g)].map(([, path]) => path);
            for (const root of [...sdkRoots, ...roots].filter(Boolean)) {
                const schema = `${root}/templates/air/Descriptor.51.3.xsd`;
                try {
                    await access(schema);
                    return schema;
                } catch {
                    // Continue through configured SDKs.
                }
            }
        } catch {
            // SDK discovery is optional on CI.
        }
    }
    return undefined;
}

const schema = await descriptorSchema();

test("AIR descriptor fixtures validate against the installed 51.3 schema", { skip: !schema }, () => {
    if (!schema) {
        return;
    }
    return descriptorFixtures(fixtureRoot).then((fixtures) => {
        assert.deepEqual(
            fixtures.filter((fixture) => invalidFixtures.includes(fixture)),
            invalidFixtures,
        );
        for (const fixture of fixtures.filter((candidate) => !invalidFixtures.includes(candidate))) {
            execFileSync("xmllint", ["--noout", "--schema", schema, fixture], { stdio: "pipe" });
        }
        for (const fixture of invalidFixtures) {
            assert.throws(() => execFileSync("xmllint", ["--noout", "--schema", schema, fixture], { stdio: "ignore" }));
        }
    });
});
