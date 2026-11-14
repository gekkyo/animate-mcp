// Disposable real-Animate smoke test (not in CI): `npm run build && node server/scripts/smoke-test-movie.mjs`.
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerTestMovie } from "../dist/tools/test-movie.js";
import { registerRunJsfl } from "../dist/tools/run-jsfl.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "./smoke-lib.mjs";

const runJsfl = toolHandler(registerRunJsfl);
const testMovie = toolHandler(registerTestMovie);
const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-test-movie-"));
const flaPath = join(outDir, `${basename(outDir)}.fla`);
const flaUri = pathToFileURL(flaPath).href;
const actionScript = "trace('TEST_MOVIE_SMOKE_OK'); var smokeNull:Object = null; trace(smokeNull.value);";
let savedPathURI;
let failure;

try {
    const document = await createSavedAs3Document(runJsfl, flaUri, actionScript);
    savedPathURI = document.pathURI;
    const file = await stat(flaPath);
    assert.ok(file.isFile() && file.size > 0, "saved disposable FLA is empty");

    const result = await testMovie({ document: document.name });
    assert.equal(result.isError, undefined, result.content?.[0]?.text ?? "test_movie failed");
    assert.ok(result.structuredContent, "test_movie returned no structured content");
    assert.match(result.structuredContent.runtimeOutput, /TEST_MOVIE_SMOKE_OK/, "runtime output is missing the trace marker");
    assert.match(result.structuredContent.runtimeOutput, /Error #1009/, "runtime output is missing Error #1009");
} catch (error) {
    failure = error;
} finally {
    if (savedPathURI) {
        try {
            await closeDocumentByPath(runJsfl, savedPathURI);
        } catch (error) {
            if (failure) console.error("Disposable document cleanup also failed:", error);
            else failure = error;
        }
    }
    console.log("The Test Movie Player is not automatically closed; close it manually with its window button if open.");
}

if (failure) throw failure;
console.log(`test_movie smoke passed (disposable FLA: ${flaPath})`);
