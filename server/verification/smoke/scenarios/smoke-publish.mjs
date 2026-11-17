// Disposable real-Animate smoke test; explicit <name.fla> arguments still publish those open documents.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { registerPublish } from "../../../dist/tools/output/publish.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "../lib/smoke-lib.mjs";

/** Publishes explicitly selected documents or one owned disposable AS3 FLA.
 * @param documents Explicit names of already-open documents.
 * @param deps Injectable tool handlers and file operations.
 * @param deps.publish Publish tool handler.
 * @param deps.runJsfl JSFL tool handler.
 * @param deps.createDocument Creates a disposable saved AS3 document.
 * @param deps.closeDocument Closes the exact owned document.
 * @param deps.makeDirectory Creates a disposable directory.
 * @param deps.removeDirectory Removes a closed disposable directory.
 * @param deps.listFiles Lists output files.
 * @param deps.fileStat Reads output file metadata.
 * @returns Resolves only after a confirmed Publish and owned cleanup.
 */
export async function runPublishSmoke(
    documents = [],
    {
        publish = toolHandler(registerPublish),
        runJsfl = toolHandler(registerRunJsfl),
        createDocument = createSavedAs3Document,
        closeDocument = closeDocumentByPath,
        makeDirectory = () => mkdtemp(join(tmpdir(), "animate-mcp-smoke-publish-")),
        removeDirectory = (directory) => rm(directory, { recursive: true, force: true }),
        listFiles = readdir,
        fileStat = stat,
    } = {},
) {
    let directory;
    let owned;
    let failure;
    let ownedCompilerOutput;
    try {
        if (!documents.length) {
            directory = await makeDirectory();
            owned = await createDocument(
                runJsfl,
                pathToFileURL(join(directory, `${basename(directory)}.fla`)).href,
                "",
            );
            assert.ok(owned?.name && owned.pathURI, "Disposable AS3 fixture returned no exact document identity");
            documents = [owned.name];
        }
        for (const document of documents) {
            const result = await publish({ document });
            assert.notEqual(result.isError, true, `Publish tool failed for ${document}: ${result.content?.[0]?.text}`);
            assert.equal(result.structuredContent?.ok, true, `Publish reported failure for ${document}`);
            assert.ok(
                ["verified", "unavailable", "not_checked"].includes(result.structuredContent?.compilerOutput),
                `Publish returned no recognized compilerOutput for ${document}`,
            );
            assert.deepEqual(result.structuredContent?.errors, [], `Publish compiler errors for ${document}`);
            if (owned) {
                ownedCompilerOutput = result.structuredContent.compilerOutput;
            } else {
                console.log(`Publish passed: ${document}; compilerOutput=${result.structuredContent.compilerOutput}`);
            }
        }
        if (owned) {
            // unverified: the default AS3 Publish profile emits a SWF beside this disposable FLA; confirm on a real smoke run.
            const output = (await listFiles(directory)).find(
                (file) => file.toLowerCase() === `${basename(directory).toLowerCase()}.swf`,
            );
            assert.ok(output, "Disposable AS3 Publish produced no expected SWF output");
            const outputStat = await fileStat(join(directory, output));
            assert.ok(
                outputStat.isFile() && outputStat.size > 0,
                "Disposable AS3 Publish produced no nonempty SWF file",
            );
            console.log(`Publish passed: ${owned.name}; compilerOutput=${ownedCompilerOutput}; SWF=${output}`);
        }
    } catch (error) {
        failure = error;
    } finally {
        if (owned) {
            try {
                await closeDocument(runJsfl, owned.pathURI);
            } catch (error) {
                failure = failure ? new AggregateError([failure, error], "Publish and owned cleanup failed") : error;
            }
        }
        if (directory && owned && !failure) {
            try {
                await removeDirectory(directory);
            } catch (error) {
                failure = error;
            }
        }
    }
    if (failure) {
        throw failure;
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    await runPublishSmoke(process.argv.slice(2));
}
