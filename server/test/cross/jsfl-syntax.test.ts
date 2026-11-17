import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const JSFL_ROOT = fileURLToPath(new URL("../../jsfl/", import.meta.url));

/**
 * Find syntax constructs unsupported by Animate's ES3-era JSFL engine.
 * @param source JavaScript source text to inspect.
 * @param fileName Label included in reported locations.
 * @returns Human-readable descriptions of unsupported syntax.
 */
function findEs3SyntaxIssues(source: string, fileName: string): string[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const issues: string[] = [];

    /**
     * Record one unsupported construct at its source location.
     * @param node Syntax node to locate.
     * @param syntax Short description of the unsupported syntax.
     */
    function report(node: ts.Node, syntax: string): void {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        issues.push(`${fileName}:${line}: ${syntax}`);
    }

    /**
     * Walk the AST and report unsupported constructs.
     * @param node Current syntax node.
     */
    function visit(node: ts.Node): void {
        if (ts.isFunctionLike(node) && node.parameters.hasTrailingComma) {
            report(node, "trailing comma in function parameters");
        }
        if (ts.isVariableDeclarationList(node)) {
            if (node.flags & ts.NodeFlags.Let) {
                report(node, "let declaration");
            }
            if (node.flags & ts.NodeFlags.Const) {
                report(node, "const declaration");
            }
        } else if (ts.isArrowFunction(node)) {
            report(node, "arrow function");
        } else if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            report(node, "template literal");
        } else if (ts.isCallExpression(node) && node.arguments.hasTrailingComma) {
            report(node, "trailing comma in call");
        } else if (ts.isNewExpression(node) && node.arguments?.hasTrailingComma) {
            report(node, "trailing comma in new expression");
        } else if (ts.isArrayLiteralExpression(node) && node.elements.hasTrailingComma) {
            report(node, "trailing comma in array");
        } else if (ts.isObjectLiteralExpression(node) && node.properties.hasTrailingComma) {
            report(node, "trailing comma in object");
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return issues;
}

/**
 * Recursively collect JSFL files below a directory.
 * @param directory Directory to scan.
 * @returns Absolute paths of discovered JSFL files.
 */
async function listJsflFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const descendants = await Promise.all(
        entries.map(async (entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                return listJsflFiles(path);
            }
            return entry.isFile() && entry.name.endsWith(".jsfl") ? [path] : [];
        }),
    );
    return descendants.flat();
}

test("detects JSFL syntax that Animate's ES3 engine does not support", async () => {
    const unsupported = [
        ["trailing comma in call", "run(value,);"],
        ["trailing comma in new expression", "var value = new Foo(value,);"],
        ["trailing comma in function parameters", "function run(value,) {}"],
        ["trailing comma in array", "var values = [value,];"],
        ["trailing comma in object", "var value = { key: 1, };"],
        ["let", "let value = 1;"],
        ["const", "const value = 1;"],
        ["arrow", "var fn = (value) => value;"],
        ["template literal", "var value = `text`;"],
    ] as const;

    for (const [syntax, snippet] of unsupported) {
        assert.ok(
            findEs3SyntaxIssues(snippet, "fixture.jsfl").some((issue) => issue.includes(syntax)),
            snippet,
        );
    }

    // Syntax-like text inside comments, strings, and regex literals is not executable syntax.
    const ignored = [
        '// let const => `template`, trailing,\nvar text = "let const => `template`,";',
        "var pattern = /[,)]|let|const|=>|`/;",
    ].join("\n");
    assert.deepEqual(findEs3SyntaxIssues(ignored, "fixture.jsfl"), []);

    const files = await listJsflFiles(JSFL_ROOT);
    assert.ok(files.length > 0, "JSFL source files exist");
    const issues = (
        await Promise.all(
            files.map(async (path) => {
                const source = await readFile(path, "utf8");
                const relativePath = relative(JSFL_ROOT, path).split(sep).join("/");
                return findEs3SyntaxIssues(source, relativePath);
            }),
        )
    ).flat();
    assert.deepEqual(issues, [], "JSFL files should avoid ES3-incompatible syntax");
});
