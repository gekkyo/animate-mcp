import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bundle, JSFL_FILES, jsflRun, loadJsfl, resolveBundleNames } from "../src/jsfl-bundle.js";

const JSFL_ROOT = fileURLToPath(new URL("../jsfl/", import.meta.url));
const BUNDLE_SOURCE = fileURLToPath(new URL("../src/jsfl-bundle.ts", import.meta.url));

/** Lists all JSFL files under a directory as paths relative to the bundle root.
 * @param directory Directory to inspect
 * @returns Relative JSFL file paths using forward slashes
 */
async function listJsflFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(
            /** Lists JSFL descendants for one directory entry.
             * @param entry Directory entry to inspect
             * @returns Its JSFL paths, if any
             */
            async (entry) => {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) {
                    return listJsflFiles(path);
                }
                if (entry.isFile() && entry.name.endsWith(".jsfl")) {
                    return [relative(JSFL_ROOT, path).split(sep).join("/")];
                }
                return [];
            },
        ),
    );
    return files.flat();
}

test("every mapped JSFL file exists and every JSFL file is mapped" /** Verifies the explicit bundle map covers the existing JSFL tree.
 * @returns Nothing
 */, async () => {
    const source = await readFile(BUNDLE_SOURCE, "utf8");
    const mappedPaths = [...source.matchAll(/path: "([^"]+\.jsfl)"/g)].map(
        /** Extracts the path from a JSFL string in the bundle map.
         * @param match Regex result for one JSFL path
         * @returns Captured JSFL path
         */
        (match) => match[1],
    );
    assert.ok(mappedPaths.length > 0, "the bundle map contains JSFL paths");

    for (const mappedPath of mappedPaths) {
        const file = await stat(join(JSFL_ROOT, mappedPath));
        assert.ok(file.isFile(), `${mappedPath} is a file`);
    }

    const actualPaths = await listJsflFiles(JSFL_ROOT);
    assert.deepEqual(mappedPaths.sort(), actualPaths.sort(), "the bundle map covers exactly the JSFL files");
});

test("JSFL dependencies exist and the complete bundle graph is acyclic" /** Verifies every dependency and resolves every entry.
 * @returns Nothing
 */, () => {
    const names = Object.keys(JSFL_FILES);
    for (const [name, entry] of Object.entries(JSFL_FILES)) {
        for (const dependency of entry.deps) {
            assert.ok(dependency in JSFL_FILES, `${name} depends on known entry ${dependency}`);
        }
    }
    assert.equal(resolveBundleNames(names).length, names.length);
    assert.throws(() => resolveBundleNames(["missing-entry"]), /Unknown JSFL bundle/);
    assert.throws(
        () =>
            resolveBundleNames(["first"], {
                first: { path: "first.jsfl", deps: ["second"] },
                second: { path: "second.jsfl", deps: ["first"] },
            }),
        /Cyclic JSFL bundle dependencies/,
    );
});

test("bundle expands transitive dependencies in stable topological order" /** Verifies dependency closure and order.
 * @returns Nothing
 */, () => {
    const expected = [
        "select-document",
        "edit-state",
        "export-common",
        "library-helpers",
        "library-ops",
        "library-index",
    ];
    assert.deepEqual(resolveBundleNames(["library-index"]), expected);
    const allNames = resolveBundleNames(Object.keys(JSFL_FILES));
    for (const [name, entry] of Object.entries(JSFL_FILES)) {
        for (const dependency of entry.deps) {
            assert.ok(allNames.indexOf(dependency) < allNames.indexOf(name), `${dependency} precedes ${name}`);
        }
    }
    assert.equal(bundle("library-index"), expected.map(loadJsfl).join("\n"));
});

test("jsflRun serializes variables before the requested bundle" /** Verifies declaration order and injected bundler use.
 * @returns Nothing
 */, () => {
    let receivedNames: string[] = [];
    const code = jsflRun("save-document", { __target: "project.fla", __confirm: false, __path: null }, (...names) => {
        receivedNames = names;
        return "/* bundle */";
    });
    assert.deepEqual(receivedNames, ["document-target", "save-document"]);
    assert.equal(code, 'var __target = "project.fla";\nvar __confirm = false;\nvar __path = null;\n/* bundle */');
});
