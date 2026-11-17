import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { TOOLS } from "../../src/index.js";
import { withServer } from "../helpers/fake-animate.js";

/**
 * Extracts backtick-delimited tool names from the first table in a section.
 * @param markdown Markdown to inspect.
 * @param heading Section heading to locate.
 * @param column Zero-based table column containing names.
 * @returns Tool names in table order.
 */
function tableNames(markdown: string, heading: string, column: number): string[] {
    const lines = markdown.split("\n");
    const headingIndex = lines.findIndex((line) => line.trim() === heading);
    assert.notEqual(headingIndex, -1, `Missing section "${heading}"`);
    const table: string[] = [];
    for (const line of lines.slice(headingIndex + 1)) {
        if (!line.trim().startsWith("|")) {
            if (table.length) {
                break;
            }
            continue;
        }
        table.push(line);
    }
    return table
        .filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()))
        .map((line) => line.split("|")[column]?.match(/`([a-z][a-z0-9_]*)`/)?.[1])
        .filter((name): name is string => name !== undefined);
}

/**
 * Reads a repository file as UTF-8.
 * @param file Repository-relative path.
 * @returns File contents.
 */
function read(file: string): string {
    return readFileSync(resolve(process.cwd(), file), "utf8");
}

test("public MCP tool tables match the registered public tools", async () => {
    await withServer(
        {},
        async (client) => {
            const { tools } = await client.listTools();
            const expected = tools.map(({ name }) => name).sort();
            for (const [file, heading] of [
                ["README.md", "### Public MCP tools"],
                ["README.ja.md", "### 公開している MCP ツール"],
                ["TOOLS.md", "## Public MCP tools"],
                ["TOOLS.ja.md", "## 公開している MCP ツール"],
            ]) {
                assert.deepEqual(tableNames(read(file), heading, 1).sort(), expected, file);
            }
        },
        { entrances: true },
    );
});

test("operation tables match across READMEs and tool references", () => {
    const docs = [
        ["README.md", "### Operations", 2],
        ["README.ja.md", "### 操作一覧", 2],
        ["TOOLS.md", "## Operations", 1],
        ["TOOLS.ja.md", "## 操作一覧", 1],
    ] as const;
    const names = docs.map(([file, heading, column]) => tableNames(read(file), heading, column));
    const operations = TOOLS.map(({ name }) => name)
        .filter((name) => name !== "run_jsfl")
        .sort();
    assert.deepEqual([...names[0]].sort(), operations, docs[0][0]);
    assert.deepEqual([...names[1]].sort(), operations, docs[1][0]);
    assert.deepEqual([...names[2]].filter((name) => name !== "run_jsfl").sort(), operations, docs[2][0]);
    assert.deepEqual([...names[3]].filter((name) => name !== "run_jsfl").sort(), operations, docs[3][0]);
    for (const [index, file] of docs.entries()) {
        if (index < 2) {
            assert.ok(!names[index].includes("run_jsfl"), `${file[0]} lists run_jsfl as an operation`);
        } else {
            assert.ok(names[index].includes("run_jsfl"), `${file[0]} should document the direct-tool exception`);
        }
    }
});

test("architecture diagrams do not contain hardcoded multiplication counts", () => {
    for (const file of ["assets/architecture-light.mmd", "assets/architecture-dark.mmd"]) {
        assert.doesNotMatch(read(file), /×\s*\d+/, file);
    }
});
