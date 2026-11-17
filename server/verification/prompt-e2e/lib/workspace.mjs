import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_SCRIPT_BYTES } from "../scenarios/scenarios.mjs";

/** Reads approved export metadata or the existing scene-one frame-one AS3 script.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Text content.
 */
export async function readExportFile(outDir, file) {
    const { target } = await exportFileContext(outDir, file);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SCRIPT_BYTES) {
        throw new Error("Export file must be a regular file no larger than 64 KB.");
    }
    const content = await readFile(target);
    if (content.byteLength > MAX_SCRIPT_BYTES) {
        throw new Error("Export file must be a regular file no larger than 64 KB.");
    }
    return { data: { content: content.toString("utf8") } };
}

/** Writes only the manifested scene-one frame-one AS3 script in the disposable export.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @param content Replacement source.
 * @returns Write confirmation.
 */
export async function writeExportScript(outDir, file, content) {
    const target = await exportScriptTarget(outDir, file);
    if (Buffer.byteLength(content, "utf8") > MAX_SCRIPT_BYTES) {
        throw new Error("Export script content exceeds 64 KB.");
    }
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Export script must be an existing regular file.");
    }
    const handle = await open(target, "r+");
    try {
        await handle.writeFile(content, "utf8");
        await handle.truncate(Buffer.byteLength(content, "utf8"));
    } finally {
        await handle.close();
    }
    return { data: { written: true } };
}

/** Resolves a safe manifest-authorized export path and rejects symlink parents.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Export root, manifest, target, and file kind.
 */
export async function exportFileContext(outDir, file) {
    if (
        typeof file !== "string" ||
        !file ||
        file.includes("\0") ||
        file.includes("\\") ||
        isAbsolute(file) ||
        file.split("/").some((part) => !part || part === "." || part === "..")
    ) {
        throw new Error("Only the scene 1 frame 1 AS3 export script is allowed.");
    }
    const root = await realpath(outDir);
    const target = resolve(root, file);
    const parent = dirname(target);
    const parentInfo = await lstat(parent);
    if (parentInfo.isSymbolicLink() || (await realpath(parent)) !== parent) {
        throw new Error("Export script directory must not contain symlinks.");
    }
    const rel = relative(root, target);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
        throw new Error("Export script path escapes the export directory.");
    }
    const manifest = JSON.parse(await readFile(join(root, ".export.json"), "utf8"));
    const entry = manifest.files?.[file];
    const timeline = manifest.timelines?.find(({ scene, item }) => scene === 0 && item === undefined);
    const scriptAllowed =
        manifest.type === "Flash" &&
        entry?.scene === 0 &&
        entry.layer === 0 &&
        entry.start === 0 &&
        entry.item === undefined &&
        /^scenes\/[^/]+\/[^/]+\/1\.as$/.test(file);
    const metadataAllowed = file === "index.md" || (timeline && file === `${timeline.dir}/structure.md`);
    if (!metadataAllowed && !scriptAllowed) {
        throw new Error("Export manifest does not contain the allowed scene frame script.");
    }
    return { root, manifest, target, kind: metadataAllowed ? "metadata" : "script" };
}

/** Resolves a safe manifested script path under the disposable export.
 * @param outDir Disposable export directory.
 * @param file Relative manifest path.
 * @returns Absolute target path.
 */
export async function exportScriptTarget(outDir, file) {
    const context = await exportFileContext(outDir, file);
    if (context.kind !== "script") {
        throw new Error("Only the manifested scene frame script may be written.");
    }
    const info = await lstat(context.target);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Export script must be an existing regular file.");
    }
    return context.target;
}
