import { readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type ManifestFile, writeAtomic } from "./export.js";

export type Edit = ManifestFile & { file: string; expected: string };

type Manifest = { document: string; type: string; files: Record<string, ManifestFile> };

const MANIFEST = ".export.json";

/**
 * Reads the manifest of an export directory.
 * @param dir Export directory
 * @returns The manifest (rejects when missing)
 */
const readManifest = async (dir: string) => JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as Manifest;

/**
 * Turns a manifest file name into an absolute path inside the export directory (rejects a manifest that points outside via `../`).
 * @param dir Export directory
 * @param file Manifest key (path relative to dir)
 * @returns Absolute path (throws when outside dir)
 */
function insideDir(dir: string, file: string): string {
    const root = resolve(dir);
    const path = resolve(root, file);
    if (!path.startsWith(root + sep)) throw new Error(`Path outside the export directory: ${file}`);
    return path;
}

/**
 * Compares the manifest with the current file contents and collects the edits to apply to Animate.
 * Unchanged files are skipped; unreadable files are returned as failures.
 * @param dir Export directory
 * @returns The manifest's document name, the edits to apply (script is the new content, expected is the content at Export), the unchanged count, and the unreadable files
 */
export async function collectEdits(dir: string) {
    const manifest = await readManifest(dir);
    const edits: Edit[] = [];
    const failed: { file: string; error: string }[] = [];
    let unchanged = 0;
    for (const [file, entry] of Object.entries(manifest.files)) {
        try {
            const script = await readFile(insideDir(dir, file), "utf8");
            if (script === entry.script) unchanged++;
            else edits.push({ ...entry, file, script, expected: entry.script });
        } catch (error) {
            failed.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { document: manifest.document, edits, unchanged, failed };
}

/**
 * Records applied content in the manifest (so the next Apply does not mistake it for a change made in Animate).
 * @param dir Export directory
 * @param edits Edits that were applied to Animate
 */
export async function markApplied(dir: string, edits: Edit[]) {
    if (edits.length === 0) return;
    const manifest = await readManifest(dir);
    for (const edit of edits) manifest.files[edit.file].script = edit.script;
    await writeAtomic(join(dir, MANIFEST), JSON.stringify(manifest));
}

/**
 * Pre-step of a re-Export: rejects unapplied edits and removes only the files the previous Export wrote (leaves no stale files).
 * @param dir Export directory
 * @param force When true, overwrites even if there are unapplied edits
 */
export async function clearPreviousExport(dir: string, force: boolean) {
    let manifest: Manifest;
    try {
        manifest = await readManifest(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    if (!force) {
        const { edits } = await collectEdits(dir);
        if (edits.length > 0)
            throw new Error(
                `Unapplied edits in ${dir}: ${edits.map((edit) => edit.file).join(", ")}. Run apply_scripts first, or pass force: true to overwrite.`,
            );
    }
    for (const file of Object.keys(manifest.files)) await rm(insideDir(dir, file), { force: true });
}
