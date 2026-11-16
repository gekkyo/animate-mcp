import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Merges recorded result shapes while retaining reviewed fixture arguments.
 * @param directory Directory containing smoke JSONL files
 * @param outputDir Fixture output directory
 * @returns Promise resolving after all fixtures are written
 */
export async function mergeSmokeShapes(directory, outputDir = resolve("server/test/fixtures/real-shapes")) {
    await mkdir(outputDir, { recursive: true });
    for (const filename of (await readdir(directory)).filter((name) => name.endsWith(".jsonl"))) {
        const entries = (await readFile(join(directory, filename), "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        if (!entries.length) {
            continue;
        }
        const outputPath = join(outputDir, `${basename(filename, ".jsonl")}.json`);
        let reviewedFixture;
        try {
            reviewedFixture = JSON.parse(await readFile(outputPath, "utf8"));
        } catch {
            throw new Error(
                `No reviewed fixture exists for ${basename(filename, ".jsonl")}; add safe replay arguments before merging`,
            );
        }
        if (basename(filename, ".jsonl") === "run_jsfl") {
            continue;
        }
        const keys = new Set(entries.flatMap(({ shape }) => Object.keys(shape)));
        const optionalKeys = [...keys].filter((key) => entries.some(({ shape }) => !(key in shape)));
        const shape = Object.fromEntries(
            [...keys].map((key) => {
                const variants = [
                    ...new Set(
                        entries.filter(({ shape }) => key in shape).map(({ shape }) => JSON.stringify(shape[key])),
                    ),
                ];
                const values = variants.map((variant) => JSON.parse(variant));
                return [
                    key,
                    values.length > 1 && values.every((value) => typeof value === "string")
                        ? values.join("|")
                        : values[0],
                ];
            }),
        );
        const serialized = `${JSON.stringify({ shape, optionalKeys, arguments: reviewedFixture.arguments }, null, 4)}\n`;
        const formatted = execFileSync(
            resolve("node_modules/.bin/biome"),
            ["format", "--stdin-file-path", `server/test/fixtures/real-shapes/${basename(outputPath)}`],
            {
                input: serialized,
                encoding: "utf8",
            },
        );
        await writeFile(outputPath, formatted);
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const [directory, outputDir] = process.argv.slice(2);
    if (!directory || process.argv.length > 4) {
        throw new Error("Usage: node server/scripts/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR> [OUTPUT_DIR]");
    }
    await mergeSmokeShapes(resolve(directory), outputDir ? resolve(outputDir) : undefined);
}
