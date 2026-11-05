import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeExport } from "../src/export.js";

test("layer names differing only in case get separate folders", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "export-"));
    const frame = (script: string) => [{ start: 0, duration: 1, label: "", tween: "none", script, elements: [] }];
    await writeExport(
        {
            document: "a.fla",
            type: "Flash",
            scenes: [
                {
                    name: "s",
                    layers: [
                        { index: 0, name: "Layer", frames: frame("one();") },
                        { index: 1, name: "layer", frames: frame("two();") },
                    ],
                },
            ],
        },
        tempDir,
    );
    const files = Object.keys(JSON.parse(await readFile(join(tempDir, ".export.json"), "utf8")).files);
    assert.equal(new Set(files.map((file) => file.toLowerCase())).size, 2);
    assert.equal(await readFile(join(tempDir, "scenes/s/Layer/1.as"), "utf8"), "one();");
});
