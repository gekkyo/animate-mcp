// Disposable AS3 real-Animate smoke test (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-import-document-properties.mjs`.
// Animate must already be running. Assets and the saved disposable FLA stay under the approved temp directory.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { registerGetDocumentInfo } from "../../dist/tools/document/get-document-info.js";
import { registerSetDocumentProperties } from "../../dist/tools/document/set-document-properties.js";
import { registerImportAssets } from "../../dist/tools/library/import-assets.js";
import { registerRunJsfl } from "../../../dist/tools/core/run-jsfl.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "../lib/smoke-lib.mjs";

const TEMP_ROOT = "/private/var/folders/c2/dmv_gdrs3jzcjpbgsv8t2k4c0000gn/T/opencode";
const runJsfl = toolHandler(registerRunJsfl);
const importAssets = toolHandler(registerImportAssets);
const setDocumentProperties = toolHandler(registerSetDocumentProperties);
const getDocumentInfo = toolHandler(registerGetDocumentInfo);
/** Extracts the first text result from a tool response.
 * @param result Tool response.
 * @returns Text content or an empty string.
 */
const message = (result) => result.content?.find((item) => item.type === "text")?.text ?? "";
/** Asserts a successful tool response and returns its structured payload.
 * @param result Tool response.
 * @param description Operation description for assertion errors.
 * @returns Structured tool response.
 */
const verifyTool = (result, description) => {
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    assert.ok(result.structuredContent, `${description} returned no structured content`);
    return result.structuredContent;
};
/** Asserts that a tool response is a refusal matching the expected message.
 * @param result Tool response.
 * @param description Operation description for assertion errors.
 * @param expectedMessage Expected error-message pattern.
 */
const expectRefusal = (result, description, expectedMessage) => {
    assert.equal(result.isError, true, `${description} was not refused`);
    assert.match(message(result), expectedMessage, `${description} returned an unexpected error`);
};
/** Runs JSFL and returns its result after checking for tool errors.
 * @param code JSFL source to execute.
 * @param description Operation description for assertion errors.
 * @returns JSFL result value.
 */
const runValue = async (code, description) => {
    const result = await runJsfl({ code });
    assert.equal(result.isError, undefined, `${description}: ${message(result)}`);
    return result.structuredContent?.result;
};
/** Reads the open Animate documents as sorted name/path rows.
 * @returns Promise resolving to document rows.
 */
const documentRows = () =>
    runValue(
        'var __docs = fl.documents || [], __rows = []; for (var __i = 0; __i < __docs.length; __i++) __rows.push(__docs[__i].name + "\\t" + (__docs[__i].pathURI || "")); __rows.sort().join("\\n");',
        "read open document list",
    ).then((value) => {
        assert.equal(typeof value, "string", "Animate returned invalid document details");
        return value ? value.split("\n") : [];
    });
/** Removes expected rows from a copy, failing if any expected row is missing.
 * @param rows Original document rows.
 * @param expected Rows that must be present and removed.
 * @returns Remaining sorted rows.
 */
const withoutRows = (rows, expected) => {
    const remaining = [...rows];
    for (const row of expected) {
        const index = remaining.indexOf(row);
        assert.notEqual(index, -1, `An existing document disappeared: ${row}`);
        remaining.splice(index, 1);
    }
    return remaining.sort();
};
/** Builds a minimal valid mono 8-bit WAV fixture.
 * @returns WAV file bytes.
 */
const assetWav = () => {
    const data = Buffer.alloc(45);
    data.write("RIFF", 0);
    data.writeUInt32LE(data.length - 8, 4);
    data.write("WAVEfmt ", 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(8000, 24);
    data.writeUInt32LE(8000, 28);
    data.writeUInt16LE(1, 32);
    data.writeUInt16LE(8, 34);
    data.write("data", 36);
    data.writeUInt32LE(1, 40);
    data[44] = 128;
    return data;
};
/** Computes the CRC-32 checksum for a byte sequence.
 * @param data Bytes to checksum.
 * @returns Unsigned CRC-32 value.
 */
const crc32 = (data) => {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
};
/** Encodes a PNG chunk with its length and CRC.
 * @param type Four-character chunk type.
 * @param data Chunk payload bytes.
 * @returns Encoded PNG chunk bytes.
 */
const pngChunk = (type, data) => {
    const typeBytes = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)), data.length + 8);
    return chunk;
};
/** Builds a valid 1-by-1 RGBA PNG fixture.
 * @returns PNG file bytes.
 */
const assetPng = () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    // Generate valid chunk CRCs; the previous embedded 1px PNG fixtures had corrupt IDAT CRCs.
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(Buffer.from([0, 64, 128, 192, 255]))),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
};
/** Builds JSFL that snapshots stage elements in a document identified by path.
 * @param pathURI Exact Animate document path URI.
 * @returns JSFL source returning the stage snapshot.
 */
const stageSnapshot = (pathURI) =>
    `(function () { var __path = ${JSON.stringify(pathURI)}, __docs = fl.documents || [], __doc = null, __timeline, __rows = [], __layerIndex, __frameIndex, __layer, __frame, __elements, __elementIndex, __element, __item, __row; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) { if (__doc) throw new Error("Duplicate disposable FLA path"); __doc = __docs[__i]; } if (!__doc) throw new Error("Disposable FLA not open"); __timeline = __doc.getTimeline(); for (__layerIndex = 0; __layerIndex < __timeline.layers.length; __layerIndex++) { __layer = __timeline.layers[__layerIndex]; for (__frameIndex = 0; __frameIndex < __layer.frames.length; __frameIndex++) { __frame = __layer.frames[__frameIndex]; if (!__frame || __frame.startFrame !== __frameIndex) continue; __elements = __frame.elements || []; __row = [String(__layerIndex), String(__frameIndex), String(__layer.name), String(__elements.length)]; for (__elementIndex = 0; __elementIndex < __elements.length; __elementIndex++) { __element = __elements[__elementIndex]; __item = __element.libraryItem; __row.push(String(__element.elementType) + ":" + (__item ? String(__item.name) : "") + ":" + String(__element.x) + ":" + String(__element.y) + ":" + String(__element.scaleX) + ":" + String(__element.scaleY)); } __rows.push(__row.join("\\t")); } } return __rows.join("\\n"); })()`;
/** Builds JSFL that lists sorted Library item names for a document path.
 * @param pathURI Exact Animate document path URI.
 * @returns JSFL source returning the sorted names.
 */
const librarySnapshot = (pathURI) =>
    `(function () { var __path = ${JSON.stringify(pathURI)}, __docs = fl.documents || [], __doc = null, __names = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) __doc = __docs[__i]; if (!__doc) throw new Error("Disposable FLA not open"); for (__i = 0; __i < __doc.library.items.length; __i++) __names.push(String(__doc.library.items[__i].name)); __names.sort(); return __names.join("\\n"); })()`;
/** Builds JSFL that lists selected Library item names for a document path.
 * @param pathURI Exact Animate document path URI.
 * @returns JSFL source returning selected names.
 */
const selectedLibraryItems = (pathURI) =>
    `(function () { var __path = ${JSON.stringify(pathURI)}, __docs = fl.documents || [], __doc = null, __selected = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) __doc = __docs[__i]; if (!__doc) throw new Error("Disposable FLA not open"); var __items = __doc.library.getSelectedItems() || []; for (__i = 0; __i < __items.length; __i++) __selected.push(String(__items[__i].name)); return __selected.join("\\n"); })()`;

const tempDir = await mkdtemp(join(TEMP_ROOT, "import-document-properties-"));
const stem = basename(tempDir).replace(/[^A-Za-z0-9_]/g, "_");
const imageName = `${stem}.png`;
const audioName = `${stem}.wav`;
const imagePath = join(tempDir, imageName);
const audioPath = join(tempDir, audioName);
const flaPath = join(tempDir, `${stem}.fla`);
let initialDocuments;
let disposable;
let failure;
let finalCount = "unknown";

try {
    await writeFile(imagePath, assetPng());
    await writeFile(audioPath, assetWav());
    await assert.rejects(stat(flaPath), { code: "ENOENT" }, "disposable FLA path must not already exist");

    initialDocuments = await documentRows();
    disposable = await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, "");
    assert.ok(disposable.name && disposable.pathURI, "created AS3 document has no identity");
    assert.ok(
        !initialDocuments.some((row) => row.startsWith(`${disposable.name}\t`)),
        "disposable document name conflicts with an already-open document; refusing name-targeted tools",
    );
    const afterCreate = await documentRows();
    assert.deepEqual(withoutRows(afterCreate, initialDocuments), [`${disposable.name}\t${disposable.pathURI}`]);

    const folderName = `${stem}_ImportFolder`;
    const stageSentinel = `${stem}_StageSentinel`;
    const stageSetup = await runValue(
        `(function () { var __path = ${JSON.stringify(disposable.pathURI)}, __docs = fl.documents || [], __doc = null, __library, __selection, __actualName = "", __afterAdd = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) __doc = __docs[__i]; if (!__doc) throw new Error("Disposable FLA not open"); __library = __doc.library; if (__library.itemExists(${JSON.stringify(folderName)})) throw new Error("Smoke Library folder name already exists"); __library.newFolder(${JSON.stringify(folderName)}); if (!__library.itemExists(${JSON.stringify(folderName)})) throw new Error("Could not create Library folder"); __library.selectNone(); __library.selectItem(${JSON.stringify(folderName)}); __selection = __library.getSelectedItems() || []; if (__selection.length !== 1 || __selection[0].name !== ${JSON.stringify(folderName)}) throw new Error("Could not select the Library folder"); if (!__library.addNewItem("graphic", ${JSON.stringify(stageSentinel)})) throw new Error("Could not create stage sentinel symbol"); for (var __itemIndex = 0; __itemIndex < __library.items.length; __itemIndex++) { var __name = String(__library.items[__itemIndex].name); if (__name === ${JSON.stringify(stageSentinel)} || __name === ${JSON.stringify(`${folderName}/${stageSentinel}`)}) { if (__actualName) throw new Error("Multiple stage sentinel Library items were created"); __actualName = __name; } } if (!__actualName) throw new Error("Could not find stage sentinel Library item"); __selection = __library.getSelectedItems() || []; for (__i = 0; __i < __selection.length; __i++) __afterAdd.push(String(__selection[__i].name)); __library.selectNone(); __library.selectItem(${JSON.stringify(folderName)}); if (!__library.addItemToDocument({ x: 50, y: 60 }, __actualName)) throw new Error("Could not place stage sentinel"); __library.selectNone(); __library.selectItem(${JSON.stringify(folderName)}); return [__doc.name, __actualName, __afterAdd.join(",")].join("\\t"); })()`,
        "create stage sentinel on disposable document",
    );
    const [stageSetupName, stageItemName, selectedAfterAddNewItem] = String(stageSetup).split("\t");
    assert.equal(stageSetupName, disposable.name);
    assert.ok(stageItemName, "addNewItem did not produce a Library item name");
    console.log(
        `OBSERVE addNewItem with selected folder: item=${stageItemName}; post-call selected Library items=${selectedAfterAddNewItem || "(none)"}.`,
    );
    assert.equal(
        await runValue(selectedLibraryItems(disposable.pathURI), "verify selected Library folder before import"),
        folderName,
    );
    const stageBeforeImport = await runValue(stageSnapshot(disposable.pathURI), "record stage before import");
    assert.match(stageBeforeImport, new RegExp(`instance:${stageItemName}:50:60:`));

    const imported = verifyTool(
        await importAssets({ paths: [imagePath, audioPath], document: disposable.name }),
        "import generated PNG and WAV",
    );
    assert.deepEqual(imported, { document: disposable.name, items: [imageName, audioName] });
    const stageAfterImport = await runValue(
        stageSnapshot(disposable.pathURI),
        "verify import did not place assets on stage",
    );
    assert.equal(stageAfterImport, stageBeforeImport, "import changed stage elements");
    const libraryAfterImport = await runValue(librarySnapshot(disposable.pathURI), "verify imported Library items");
    assert.ok(libraryAfterImport.split("\n").includes(imageName), "imported PNG missing from Library");
    assert.ok(libraryAfterImport.split("\n").includes(audioName), "imported WAV missing from Library");
    assert.ok(
        !libraryAfterImport.split("\n").includes(`${folderName}/${imageName}`),
        "PNG was imported into the selected folder",
    );
    assert.ok(
        !libraryAfterImport.split("\n").includes(`${folderName}/${audioName}`),
        "WAV was imported into the selected folder",
    );
    assert.equal(
        await runValue(selectedLibraryItems(disposable.pathURI), "verify Library folder selection was restored"),
        folderName,
    );
    console.log("PASS PNG/WAV import: both items are in the Library; stage snapshot is unchanged.");

    expectRefusal(
        await importAssets({ paths: [imagePath], document: disposable.name }),
        "refuse duplicate Library name before import",
        /already exists/i,
    );
    assert.equal(
        await runValue(librarySnapshot(disposable.pathURI), "verify duplicate refusal changed no Library items"),
        libraryAfterImport,
        "duplicate refusal added or renamed a Library item",
    );
    assert.equal(
        await runValue(selectedLibraryItems(disposable.pathURI), "verify duplicate refusal preserved folder selection"),
        folderName,
    );
    console.log("PASS duplicate-name import refusal returned without an Animate collision modal.");

    const changedProperties = verifyTool(
        await setDocumentProperties({
            document: disposable.name,
            width: 640,
            height: 360,
            frameRate: 30,
            backgroundColor: "#123456",
        }),
        "change disposable document properties",
    );
    assert.deepEqual(changedProperties, {
        document: disposable.name,
        properties: { width: 640, height: 360, frameRate: 30, backgroundColor: "#123456" },
    });
    const stageAfterResize = await runValue(
        stageSnapshot(disposable.pathURI),
        "verify resize left stage content unchanged",
    );
    assert.equal(stageAfterResize, stageBeforeImport, "document resize moved or scaled stage content");

    const activated = await runValue(
        `(function () { var __path = ${JSON.stringify(disposable.pathURI)}, __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one disposable document by pathURI"); fl.setActiveWindow(__matches[0]); return __matches[0].name; })()`,
        "activate disposable document before get_document_info",
    );
    assert.equal(activated, disposable.name);
    const info = verifyTool(await getDocumentInfo(), "read modified document info");
    assert.equal(info.name, disposable.name);
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(info.frameRate, 30);
    assert.equal(info.backgroundColor, "#123456");
    console.log("PASS property updates/read-back: size, frame rate, color, and unchanged stage instance verified.");

    const fourK = verifyTool(
        await setDocumentProperties({ document: disposable.name, width: 3840, height: 2160 }),
        "set verified 4K stage dimensions",
    );
    assert.deepEqual(fourK, { document: disposable.name, properties: { width: 3840, height: 2160 } });
    assert.equal(
        await runValue(stageSnapshot(disposable.pathURI), "verify 4K resize left stage content unchanged"),
        stageBeforeImport,
        "4K resize moved or scaled stage content",
    );
    const activateFor4K = await runValue(
        `(function () { var __path = ${JSON.stringify(disposable.pathURI)}, __docs = fl.documents || [], __matches = []; for (var __i = 0; __i < __docs.length; __i++) if (__docs[__i].pathURI === __path) __matches.push(__docs[__i]); if (__matches.length !== 1) throw new Error("Expected exactly one disposable document by pathURI"); fl.setActiveWindow(__matches[0]); return __matches[0].name; })()`,
        "activate disposable document before 4K read-back",
    );
    assert.equal(activateFor4K, disposable.name);
    const fourKInfo = verifyTool(await getDocumentInfo(), "read back 4K document dimensions");
    assert.equal(fourKInfo.width, 3840);
    assert.equal(fourKInfo.height, 2160);
    console.log("PASS 4K dimensions: set_document_properties accepted 3840×2160 and get_document_info read it back.");
} catch (error) {
    failure = error;
} finally {
    if (disposable?.pathURI) {
        try {
            await closeDocumentByPath(runJsfl, disposable.pathURI);
        } catch (error) {
            console.error("Disposable FLA cleanup failed:", error);
            failure = failure
                ? new AggregateError([failure, error], "Smoke test and document cleanup both failed")
                : error;
        }
    }

    if (initialDocuments) {
        try {
            const finalDocuments = await documentRows();
            finalCount = finalDocuments.length;
            assert.deepEqual(
                finalDocuments,
                initialDocuments,
                "existing documents changed or a disposable FLA remains open",
            );
        } catch (error) {
            console.error("Final document-state verification failed:", error);
            failure = failure
                ? new AggregateError([failure, error], "Smoke test and final-state verification failed")
                : error;
        }
    }

    try {
        await rm(tempDir, { recursive: true, force: true });
        await assert.rejects(stat(tempDir), { code: "ENOENT" });
    } catch (error) {
        console.error("Temporary asset/FLA cleanup failed:", error);
        failure = failure
            ? new AggregateError([failure, error], "Smoke test and temporary cleanup both failed")
            : error;
    }
    console.log(
        `Cleanup state: initial documents ${initialDocuments?.length ?? "unknown"}, final ${finalCount}; temp directory removed; disposable FLA ${disposable?.pathURI ? "closed by exact pathURI" : "not created"}.`,
    );
}

if (failure) {
    throw failure;
}
console.log(`Import/document-properties smoke passed (disposable AS3 FLA: ${disposable?.pathURI}).`);
