import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/** Manifest entry for Apply: frame position (0-based) and the script at Export. A library symbol uses item instead of scene. */
export type ManifestFile = { scene: number; layer: number; start: number; script: string; item?: string };
export type ManifestTimeline = {
    dir: string;
    scene: number;
    item?: string;
    structureFingerprint?: string;
    layers: { index: number; dir: string; name: string }[];
};
export type ExportManifest = {
    document: string;
    type: string;
    files: Record<string, ManifestFile>;
    timelines?: ManifestTimeline[];
    libraryFingerprint?: string;
};

type SuccessfulApply = {
    edits: (ManifestFile & { file: string; script: string })[];
    newScripts: (ManifestFile & {
        file: string;
        layerDir: string;
        layerName: string;
        asLayer: boolean;
    })[];
    fingerprints: { scene: number; item?: string; structureFingerprint: string }[];
};

const MANIFEST = ".export.json";

/** Reads the manifest of an export directory. */
const readManifest = async (dir: string) => JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as ExportManifest;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Resolves a manifest path only when it stays inside the export directory. */
function insideDir(dir: string, file: string): string {
    const root = resolve(dir);
    const absolutePath = resolve(root, file);
    if (!absolutePath.startsWith(root + sep)) {
        throw new Error(`Path outside the export directory: ${file}`);
    }
    return absolutePath;
}

/** Writes the manifest atomically in its existing on-disk format. */
export async function writeManifest(dir: string, manifest: ExportManifest): Promise<void> {
    const path = join(dir, MANIFEST);
    await writeFile(`${path}.tmp`, JSON.stringify(manifest));
    await rename(`${path}.tmp`, path);
}

/** Reads the previous workspace, refuses unapplied changes unless forced, and removes only its tracked scripts. */
export async function prepareExport(dir: string, force: boolean): Promise<void> {
    let manifest: ExportManifest;
    try {
        manifest = await readManifest(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
        }
        throw error;
    }
    if (!force) {
        const { edits, newScripts } = await collectChanges(dir);
        const unapplied = [...edits, ...newScripts];
        if (unapplied.length > 0) {
            throw new Error(
                `Unapplied edits in ${dir}: ${unapplied.map((edit) => edit.file).join(", ")}. Run apply_scripts first, or pass force: true to overwrite.`,
            );
        }
    }
    for (const file of Object.keys(manifest.files)) {
        await rm(insideDir(dir, file), { force: true });
    }
}

/** Collects existing edits and new scripts found in files belonging to manifested timelines. */
export async function collectChanges(dir: string) {
    const manifest = await readManifest(dir);
    const edits: (ManifestFile & { file: string; expected: string })[] = [];
    const failed: { file: string; error: string }[] = [];
    const warnings: string[] = [];
    const newScripts: (ManifestFile & { file: string; layerDir: string; asLayer: boolean })[] = [];
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
            .filter((layer) => layer.name.toLowerCase() === "as")
            .sort((left, right) => left.index - right.index)[0];
        for (const layerEntry of layerEntries) {
            if (!layerEntry.isDirectory()) {
                continue;
            }
            const mappedLayer = timeline.layers.find((layer) => layer.dir === layerEntry.name);
            const asLayer = mappedLayer?.name.toLowerCase() === "as" || layerEntry.name.toLowerCase() === "as";
            // An unregistered `as` directory uses the top mapped AS layer, or -1 so Apply can create one.
            const targetLayer = mappedLayer ?? (asLayer ? topAsLayer : undefined);
            let scriptEntries: import("node:fs").Dirent[];
            try {
                scriptEntries = await readdir(insideDir(dir, `${timeline.dir}/${layerEntry.name}`), {
                    withFileTypes: true,
                });
            } catch (error) {
                failed.push({ file: `${timeline.dir}/${layerEntry.name}`, error: errorMessage(error) });
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
    newScripts.sort((left, right) => left.file.localeCompare(right.file));
    warnings.sort();
    const fingerprints = (manifest.timelines ?? [])
        .filter((timeline) => timeline.structureFingerprint)
        .map((timeline) => ({
            scene: timeline.scene,
            ...(timeline.item ? { item: timeline.item } : {}),
            structureFingerprint: timeline.structureFingerprint as string,
        }));
    return {
        document: manifest.document,
        libraryFingerprint: manifest.libraryFingerprint,
        edits,
        newScripts,
        unchanged,
        failed,
        warnings,
        fingerprints,
    };
}

/** Records only successful Apply results so later collection sees the new manifest state. */
export async function recordApplied(dir: string, successful: SuccessfulApply): Promise<void> {
    const { edits, newScripts, fingerprints } = successful;
    if (edits.length === 0 && newScripts.length === 0) {
        return;
    }
    const manifest = await readManifest(dir);
    // Scene numbers can repeat for library symbols, so pair scene with item to identify a timeline.
    const findTimeline = (scene: number, item: string | undefined) =>
        manifest.timelines?.find((entry) => entry.scene === scene && entry.item === item);
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
        if (newScript.asLayer && !timeline.layers.some((layer) => layer.name.toLowerCase() === "as")) {
            for (const layer of timeline.layers) {
                layer.index++;
            }
            // Keep this shift within the timeline; another symbol may use the same scene index.
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
    // Advance the baseline only with Apply-confirmed fingerprints so the next collection checks Animate's updated structure.
    for (const fingerprint of fingerprints) {
        const timeline = findTimeline(fingerprint.scene, fingerprint.item);
        if (timeline) {
            timeline.structureFingerprint = fingerprint.structureFingerprint;
        }
    }
    await writeManifest(dir, manifest);
}
