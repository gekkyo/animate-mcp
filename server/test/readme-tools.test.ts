import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { TOOLS } from "../src/index.js";

test("every registered tool is documented in both READMEs", () => {
    for (const file of ["README.md", "README.ja.md"]) {
        const readme = readFileSync(resolve(process.cwd(), file), "utf8");
        for (const { name } of TOOLS) {
            assert.ok(readme.includes(name), `Missing tool "${name}" in ${file}`);
        }
    }
});
