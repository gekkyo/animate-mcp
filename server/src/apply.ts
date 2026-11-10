import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AppliedNewScript, Edit, NewScript, TimelineFingerprint } from "./apply-contract.js";
import { type ManifestFile, type ManifestTimeline, writeAtomic } from "./export.js";

export type { AppliedNewScript, Edit, NewScript, TimelineFingerprint } from "./apply-contract.js";

type Manifest = {
    document: string;
    type: string;
    files: Record<string, ManifestFile>;
    timelines?: ManifestTimeline[];
};

const MANIFEST = ".export.json";

/**
 * Reads the manifest of an export directory.
 * @param dir Export directory
 * @returns The manifest (rejects when missing)
 */
const readManifest = async (dir: string) => JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as Manifest;

/** Converts a thrown value into the message returned to callers.
 * @param error Thrown value
 * @returns Error message or string representation
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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
            failed.push({ file, error: errorMessage(error) });
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
            failed.push({ file: timeline.dir, error: errorMessage(error) });
            continue;
        }
        const topAsLayer = timeline.layers
            .filter(
                /** Selects layers named AS, case-insensitively.
                 * @param layer Layer to check
                 * @returns Whether the layer is named AS
                 */
                (layer) => layer.name.toLowerCase() === "as",
            )
            .sort(
                /** Orders layers by their timeline index.
                 * @param left First layer to compare
                 * @param right Second layer to compare
                 * @returns Negative, zero, or positive ordering result
                 */
                (left, right) => left.index - right.index,
            )[0];
        for (const layerEntry of layerEntries) {
            if (!layerEntry.isDirectory()) {
                continue;
            }
            const mappedLayer = timeline.layers.find(
                /** Finds the manifest layer mapped to this directory.
                 * @param layer Manifest layer mapping to check
                 * @returns The matching layer, if present
                 */
                (layer) => layer.dir === layerEntry.name,
            );
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
                    error: errorMessage(error),
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
                        error: "Frame number must be 1 or more",
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
                    failed.push({ file, error: errorMessage(error) });
                }
            }
        }
    }
    newScripts.sort(
        /** Orders discovered scripts by relative path.
         * @param left First script to compare
         * @param right Second script to compare
         * @returns Locale ordering result for the script paths
         */
        (left, right) => left.file.localeCompare(right.file),
    );
    warnings.sort();
    const fingerprints = (manifest.timelines ?? [])
        .filter(
            /** Keeps timelines that have a recorded structure fingerprint.
             * @param timeline Timeline manifest entry to check
             * @returns Whether the timeline has a fingerprint
             */
            (timeline) => timeline.structureFingerprint,
        )
        .map(
            /** Extracts a timeline fingerprint for Apply.
             * @param timeline Timeline manifest entry to convert
             * @returns Fingerprint data for the timeline
             */
            (timeline) => ({
                scene: timeline.scene,
                ...(timeline.item ? { item: timeline.item } : {}),
                structureFingerprint: timeline.structureFingerprint as string,
            }),
        );
    return { document: manifest.document, edits, newScripts, unchanged, failed, warnings, fingerprints };
}

/**
 * Records applied content in the manifest so the next Apply does not mistake it for a change made in Animate.
 * @param dir Export directory
 * @param edits Edits that were applied to Animate
 * @param newScripts New scripts that were applied to Animate
 * @param fingerprints Updated timeline fingerprints from Animate
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
    /** Finds the manifest timeline identified by scene and library item.
     * @param scene Scene index
     * @param item Optional library item name
     * @returns Matching timeline, if present
     */
    function findTimeline(scene: number, item: string | undefined): ManifestTimeline | undefined {
        return manifest.timelines?.find((entry) => entry.scene === scene && entry.item === item);
    }
    for (const edit of edits) {
        if (manifest.files[edit.file]) {
            manifest.files[edit.file].script = edit.script;
        }
    }
    for (const newScript of newScripts) {
        const timeline = findTimeline(newScript.scene, newScript.item);
        if (!timeline) {
            continue;
        }
        if (
            newScript.asLayer &&
            !timeline.layers.some(
                /** Checks whether the timeline already contains an AS layer.
                 * @param layer Manifest layer mapping to check
                 * @returns Whether the layer is named AS
                 */
                (layer) => layer.name.toLowerCase() === "as",
            )
        ) {
            for (const layer of timeline.layers) {
                layer.index++;
            }
            for (const file of Object.values(manifest.files)) {
                if (file.scene === newScript.scene && file.item === newScript.item) {
                    file.layer++;
                }
            }
            timeline.layers.push({ index: newScript.layer, dir: newScript.layerDir, name: newScript.layerName });
            timeline.layers.sort(
                /** Orders layer mappings by their timeline index.
                 * @param left First layer mapping to compare
                 * @param right Second layer mapping to compare
                 * @returns Negative, zero, or positive ordering result
                 */
                (left, right) => left.index - right.index,
            );
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
        const timeline = findTimeline(fingerprint.scene, fingerprint.item);
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
        const { edits, newScripts } = await collectEdits(dir);
        const unapplied = [...edits, ...newScripts];
        if (unapplied.length > 0) {
            throw new Error(
                `Unapplied edits in ${dir}: ${unapplied
                    .map(
                        /** Gets the path of an unapplied edit for the error message.
                         * @param edit Unapplied script edit
                         * @returns Relative path of the edited file
                         */
                        (edit) => edit.file,
                    )
                    .join(", ")}. Run apply_scripts first, or pass force: true to overwrite.`,
            );
        }
    }
    for (const file of Object.keys(manifest.files)) {
        await rm(insideDir(dir, file), { force: true });
    }
}
