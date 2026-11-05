import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type ManifestFile, type ManifestTimeline, writeAtomic } from "./export.js";

export type Edit = ManifestFile & { file: string; expected: string };
export type NewScript = ManifestFile & { file: string; layerDir: string; asLayer: boolean };
export type AppliedNewScript = ManifestFile & {
    file: string;
    layerDir: string;
    layerName: string;
    asLayer: boolean;
};

type Manifest = {
    document: string;
    type: string;
    files: Record<string, ManifestFile>;
    timelines?: ManifestTimeline[];
};

export type TimelineFingerprint = { scene: number; item?: string; structureFingerprint: string };

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
    const absolutePath = resolve(root, file);
    if (!absolutePath.startsWith(root + sep)) {
        throw new Error(`Path outside the export directory: ${file}`);
    }
    return absolutePath;
}

/**
 * Compares the manifest with current file contents and collects existing edits and untracked new scripts.
 * Unchanged files are skipped; unreadable files are returned as failures, and unsupported layer folders are warned.
 * @param dir Export directory
 * @returns The manifest's document, existing edits, new scripts, unchanged count, failures, and warnings
 */
export async function collectEdits(dir: string) {
    const manifest = await readManifest(dir);
    const edits: Edit[] = [];
    const failed: { file: string; error: string }[] = [];
    const warnings: string[] = [];
    const newScripts: NewScript[] = [];
    let unchanged = 0;
    for (const [file, manifestFile] of Object.entries(manifest.files)) {
        try {
            const script = await readFile(insideDir(dir, file), "utf8");
            if (script === manifestFile.script) {
                unchanged++;
            } else {
                edits.push({ ...manifestFile, file, script, expected: manifestFile.script });
            }
        } catch (error) {
            failed.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
    }
    for (const timeline of manifest.timelines ?? []) {
        let layerEntries: import("node:fs").Dirent[];
        try {
            layerEntries = await readdir(insideDir(dir, timeline.dir), { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                continue;
            }
            failed.push({ file: timeline.dir, error: error instanceof Error ? error.message : String(error) });
            continue;
        }
        const topAsLayer = timeline.layers
            .filter((layer) => layer.name.toLowerCase() === "as")
            .sort((left, right) => left.index - right.index)[0];
        for (const layerEntry of layerEntries) {
            if (!layerEntry.isDirectory()) {
                continue;
            }
            const mappedLayer = timeline.layers.find((layer) => layer.dir === layerEntry.name);
            const asLayer = mappedLayer?.name.toLowerCase() === "as" || layerEntry.name.toLowerCase() === "as";
            const targetLayer = mappedLayer ?? (asLayer ? topAsLayer : undefined);
            let scriptEntries: import("node:fs").Dirent[];
            try {
                scriptEntries = await readdir(insideDir(dir, `${timeline.dir}/${layerEntry.name}`), {
                    withFileTypes: true,
                });
            } catch (error) {
                failed.push({
                    file: `${timeline.dir}/${layerEntry.name}`,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            for (const scriptEntry of scriptEntries) {
                if (!scriptEntry.isFile()) {
                    continue;
                }
                const match = /^(\d+)\.(as|js)$/i.exec(scriptEntry.name);
                const extension = manifest.type === "htmlcanvas" ? "js" : "as";
                if (!match || match[2].toLowerCase() !== extension) {
                    continue;
                }
                const frameNumber = Number(match[1]);
                if (!Number.isSafeInteger(frameNumber) || frameNumber < 1) {
                    failed.push({
                        file: `${timeline.dir}/${layerEntry.name}/${scriptEntry.name}`,
                        error: "Frame beyond timeline length",
                    });
                    continue;
                }
                const file = `${timeline.dir}/${layerEntry.name}/${scriptEntry.name}`;
                if (manifest.files[file]) {
                    continue;
                }
                if (!asLayer && !targetLayer) {
                    warnings.push(`ignored: ${file}`);
                    continue;
                }
                try {
                    const script = await readFile(insideDir(dir, file), "utf8");
                    newScripts.push({
                        file,
                        scene: timeline.scene,
                        layer: targetLayer?.index ?? -1,
                        start: frameNumber - 1,
                        script,
                        ...(timeline.item ? { item: timeline.item } : {}),
                        layerDir: layerEntry.name,
                        asLayer,
                    });
                } catch (error) {
                    failed.push({ file, error: error instanceof Error ? error.message : String(error) });
                }
            }
        }
    }
    newScripts.sort((left, right) => left.file.localeCompare(right.file));
    warnings.sort();
    const fingerprints = (manifest.timelines ?? [])
        .filter((timeline) => timeline.structureFingerprint)
        .map((timeline) => ({
            scene: timeline.scene,
            ...(timeline.item ? { item: timeline.item } : {}),
            structureFingerprint: timeline.structureFingerprint as string,
        }));
    return { document: manifest.document, edits, newScripts, unchanged, failed, warnings, fingerprints };
}

/**
 * Records applied content in the manifest so the next Apply does not mistake it for a change made in Animate.
 * @param dir Export directory
 * @param edits Edits that were applied to Animate
 * @param newScripts New scripts that were applied to Animate
 */
export async function markApplied(
    dir: string,
    edits: Edit[],
    newScripts: AppliedNewScript[] = [],
    fingerprints: TimelineFingerprint[] = [],
) {
    if (edits.length === 0 && newScripts.length === 0) {
        return;
    }
    const manifest = await readManifest(dir);
    for (const edit of edits) {
        if (manifest.files[edit.file]) {
            manifest.files[edit.file].script = edit.script;
        }
    }
    for (const newScript of newScripts) {
        const timeline = manifest.timelines?.find(
            (entry) => entry.scene === newScript.scene && entry.item === newScript.item,
        );
        if (!timeline) {
            continue;
        }
        if (newScript.asLayer && !timeline.layers.some((layer) => layer.name.toLowerCase() === "as")) {
            for (const layer of timeline.layers) {
                layer.index++;
            }
            for (const file of Object.values(manifest.files)) {
                if (file.scene === newScript.scene && file.item === newScript.item) {
                    file.layer++;
                }
            }
            timeline.layers.push({ index: newScript.layer, dir: newScript.layerDir, name: newScript.layerName });
            timeline.layers.sort((left, right) => left.index - right.index);
        }
        manifest.files[newScript.file] = {
            scene: newScript.scene,
            layer: newScript.layer,
            start: newScript.start,
            script: newScript.script,
            ...(newScript.item ? { item: newScript.item } : {}),
        };
    }
    for (const fingerprint of fingerprints) {
        const timeline = manifest.timelines?.find(
            (entry) => entry.scene === fingerprint.scene && entry.item === fingerprint.item,
        );
        if (timeline) {
            timeline.structureFingerprint = fingerprint.structureFingerprint;
        }
    }
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
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
        }
        throw error;
    }
    if (!force) {
        const { edits } = await collectEdits(dir);
        if (edits.length > 0) {
            throw new Error(
                `Unapplied edits in ${dir}: ${edits.map((edit) => edit.file).join(", ")}. Run apply_scripts first, or pass force: true to overwrite.`,
            );
        }
    }
    for (const file of Object.keys(manifest.files)) {
        await rm(insideDir(dir, file), { force: true });
    }
}
