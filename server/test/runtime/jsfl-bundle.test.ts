import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { bundle, jsflRun, loadJsfl, resolveBundleNames } from "../../src/runtime/jsfl-bundle.js";

const JSFL_ROOT = fileURLToPath(new URL("../../jsfl/", import.meta.url));

/**
 * Lists JSFL files recursively, using entry names relative to the JSFL root.
 * @param directory Directory to inspect
 * @returns Relative JSFL entry names
 */
async function listJsflEntries(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const descendants = await Promise.all(
        entries.map(async (entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                return listJsflEntries(path);
            }
            return entry.isFile() && entry.name.endsWith(".jsfl")
                ? [
                      relative(JSFL_ROOT, path)
                          .split(sep)
                          .join("/")
                          .replace(/\.jsfl$/, ""),
                  ]
                : [];
        }),
    );
    return descendants.flat().sort();
}

/**
 * Reads dependencies declared at the start of a JSFL entry.
 * @param source JSFL source text
 * @returns Required entry names
 */
function parseRequires(source: string): string[] {
    const header = source.match(/^\/\/ @requires ([^\r\n]+)(?:\r?\n|$)/)?.[1];
    return header ? header.split(/,\s*/) : [];
}

/**
 * Collects global function declarations and function-valued variables.
 * @param sourceFile Parsed JSFL source
 * @returns Declared function names
 */
function declaredFunctions(sourceFile: ts.SourceFile): Set<string> {
    const declarations = new Set<string>();
    /** Visits declarations in the parsed JSFL source.
     * @param node AST node to inspect
     * @returns Nothing
     */
    const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name) {
            declarations.add(node.name.text);
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
        ) {
            declarations.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return declarations;
}

/**
 * Collects direct identifier calls from a parsed JSFL file.
 * @param sourceFile Parsed JSFL source
 * @returns Called identifier names
 */
function calledFunctions(sourceFile: ts.SourceFile): Set<string> {
    const calls = new Set<string>();
    /** Visits calls in the parsed JSFL source.
     * @param node AST node to inspect
     * @returns Nothing
     */
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            calls.add(node.expression.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return calls;
}

const JSFL_GLOBAL_CALLS = new Set([
    // JSFL host functions and ECMAScript globals are provided by Animate/the JS runtime.
    "alert",
    "Array",
    "Boolean",
    "confirm",
    "Date",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "Error",
    "eval",
    "Function",
    "getDocumentDOM",
    "isFinite",
    "isNaN",
    "Number",
    "Object",
    "parseFloat",
    "parseInt",
    "prompt",
    "RegExp",
    "String",
    "trace",
]);

const JSFL_CALL_EXCEPTIONS: Record<string, Set<string>> = {
    "library/index": new Set(["restore"]), // Returned by withEditUnlockedLayers from the edit-state dependency.
    "library/ops": new Set(["callback"]), // Higher-order parameter of withSelectedLibraryItem.
    "scripts/apply-scenes": new Set(["restore"]), // Returned by withTimelineEdit from the edit-state dependency.
    "scripts/export-library": new Set(["restore"]), // Returned by withTimelineEdit from the edit-state dependency.
    "shared/edit-state": new Set(["callback", "fn", "restore"]), // Callbacks are parameters; restore is returned by saveEditState.
};

test("every JSFL @requires target exists and the complete dependency graph is acyclic", async () => {
    const entries = await listJsflEntries(JSFL_ROOT);
    const sources = new Map(
        await Promise.all(
            entries.map(async (entry) => [entry, await readFile(join(JSFL_ROOT, `${entry}.jsfl`), "utf8")]),
        ),
    );
    const graph = new Map([...sources].map(([entry, source]) => [entry, parseRequires(source)]));

    for (const [entry, dependencies] of graph) {
        for (const dependency of dependencies) {
            assert.ok(graph.has(dependency), `${entry} requires existing entry ${dependency}`);
        }
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    /** Visits dependency edges and rejects a back-edge.
     * @param entry Entry to visit
     * @returns Nothing
     */
    const visit = (entry: string): void => {
        assert.ok(!visiting.has(entry), `dependency cycle includes ${entry}`);
        if (visited.has(entry)) {
            return;
        }
        visiting.add(entry);
        for (const dependency of graph.get(entry) ?? []) {
            visit(dependency);
        }
        visiting.delete(entry);
        visited.add(entry);
    };
    for (const entry of entries) {
        visit(entry);
    }
    assert.throws(() => resolveBundleNames(["missing/entry"]), /Unknown JSFL bundle/);
});

test("each JSFL entry calls only functions defined in its dependency closure or known globals", async () => {
    const entries = await listJsflEntries(JSFL_ROOT);
    const sources = new Map(
        await Promise.all(
            entries.map(async (entry) => [entry, await readFile(join(JSFL_ROOT, `${entry}.jsfl`), "utf8")]),
        ),
    );

    for (const entry of entries) {
        const closure = resolveBundleNames([entry]);
        const available = new Set(
            closure.flatMap((name) => {
                const sourceFile = ts.createSourceFile(
                    `${name}.jsfl`,
                    sources.get(name) ?? "",
                    ts.ScriptTarget.Latest,
                    true,
                );
                return [...declaredFunctions(sourceFile)];
            }),
        );
        const sourceFile = ts.createSourceFile(`${entry}.jsfl`, sources.get(entry) ?? "", ts.ScriptTarget.Latest, true);
        for (const call of calledFunctions(sourceFile)) {
            assert.ok(
                available.has(call) || JSFL_GLOBAL_CALLS.has(call) || JSFL_CALL_EXCEPTIONS[entry]?.has(call),
                `${entry} calls ${call}, which is not declared in its dependency closure or the JSFL global allowlist`,
            );
        }
    }
});

test("bundle expands transitive dependencies in stable topological order", async () => {
    const expected = [
        "shared/select-document",
        "shared/edit-state",
        "shared/export-common",
        "library/helpers",
        "library/ops",
        "library/index",
    ];
    const entries = await listJsflEntries(JSFL_ROOT);
    const allNames = resolveBundleNames(entries);
    const sourceByName = new Map(
        await Promise.all(
            entries.map(async (entry) => [entry, await readFile(join(JSFL_ROOT, `${entry}.jsfl`), "utf8")]),
        ),
    );

    assert.deepEqual(resolveBundleNames(["library/index"]), expected);
    for (const [name, source] of sourceByName) {
        for (const dependency of parseRequires(source)) {
            assert.ok(allNames.indexOf(dependency) < allNames.indexOf(name), `${dependency} precedes ${name}`);
        }
    }
    assert.equal(bundle("library/index"), expected.map(loadJsfl).join("\n"));
});

test("jsflRun serializes variables before the requested bundle", () => {
    let receivedNames: string[] = [];
    const code = jsflRun(
        "document/save-document",
        { __target: "project.fla", __confirm: false, __path: null },
        (...names) => {
            receivedNames = names;
            return "/* bundle */";
        },
    );
    assert.deepEqual(receivedNames, ["document/document-target", "shared/export-common", "document/save-document"]);
    assert.equal(code, 'var __target = "project.fla";\nvar __confirm = false;\nvar __path = null;\n/* bundle */');
});
