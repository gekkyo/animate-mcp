import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ExportElement = { name: string; item: string; type: string };
export type ExportFrame = {
    start: number;
    duration: number;
    label: string;
    tween: string;
    script: string;
    elements: ExportElement[];
};
export type ExportScene = {
    name: string;
    layers?: { index: number; name: string; frames: ExportFrame[] }[];
    error?: string;
};
/** Manifest entry for Apply: frame position (0-based) and the script at Export. A library symbol uses item (path in the library) instead of scene */
export type ManifestFile = { scene: number; layer: number; start: number; script: string; item?: string };
export type ExportData = {
    document: string;
    type: string;
    scenes: ExportScene[];
    /** Library symbols (name is the path in the library). linked is the AS3 Linked class name */
    symbols?: (ExportScene & { linked?: string })[];
};

/**
 * Replaces only characters that are invalid in file names with "_" (the name is otherwise kept).
 * @param name Original name
 * @returns A string that is safe as one path segment
 */
export const safeName = (name: string) =>
    [...name]
        .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char))
        .join("")
        .replace(/^\.+$/, "_") || "_";

/**
 * Makes a name unique under the same parent by appending `_2`, `_3` on collision.
 * @param used Set of names already used (updated)
 * @param name Desired name
 * @returns A unique name
 */
function uniq(used: Set<string>, name: string): string {
    // macOS / Windows are case-insensitive, so compare in lowercase
    let candidate = name;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++) candidate = `${name}_${suffix}`;
    used.add(candidate.toLowerCase());
    return candidate;
}

/**
 * Writes to a temp file, then replaces the target with rename (a crash mid-write cannot corrupt the original).
 * @param path Destination
 * @param content Content
 */
export async function writeAtomic(path: string, content: string) {
    await writeFile(`${path}.tmp`, content);
    await rename(`${path}.tmp`, path);
}

/**
 * Writes the data Animate returned in the Export format (scripts, structure.md, index.md, and a manifest for conflict detection).
 * Frame numbers are 1-based to match the Animate UI.
 * @param data Result of export-scenes.jsfl
 * @param dir Output directory
 * @returns Names of exported / failed timelines and Linked classes (AS3 only; empty for Canvas)
 */
export async function writeExport(data: ExportData, dir: string) {
    const ext = data.type === "htmlcanvas" ? "js" : "as";
    const files: Record<string, ManifestFile> = {};
    const writeToExportDir = async (rel: string, content: string) => {
        const path = join(dir, rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    };
    const exported: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const index: string[] = [`# ${data.document}`, "", "| Timeline | structure |", "| --- | --- |"];
    const sceneDirs = new Set<string>();
    const libraryDirs = new Set<string>();

    const timelines = [
        ...data.scenes.map((scene, sceneIndex) => ({ scene, sceneIndex, item: undefined, linked: "" })),
        ...(data.symbols ?? []).map((scene) => ({
            scene,
            sceneIndex: 0,
            item: scene.name,
            linked: scene.linked ?? "",
        })),
    ];
    const linkedClasses: { symbol: string; className: string; path: string }[] = [];
    for (const { scene, sceneIndex, item, linked } of timelines) {
        if (!scene.layers) {
            failed.push({ name: scene.name, error: scene.error ?? "unknown error" });
            continue;
        }
        const base = item
            ? uniq(libraryDirs, `library/${item.split("/").map(safeName).join("/")}`)
            : `scenes/${uniq(sceneDirs, safeName(scene.name))}`;
        if (linked)
            linkedClasses.push({ symbol: scene.name, className: linked, path: `${linked.replaceAll(".", "/")}.as` });
        const layerDirs = new Set<string>();
        const md: string[] = [`# ${item ? "Symbol" : "Scene"}: ${scene.name}`, ""];
        const names = new Map<string, string[]>();
        for (const layer of scene.layers) {
            const layerDir = uniq(layerDirs, safeName(layer.name));
            md.push(
                `## Layer: ${layer.name}`,
                "",
                "| Frames | Length | Tween | Elements | Label | Script |",
                "| --- | --- | --- | --- | --- | --- |",
            );
            for (const keyframe of layer.frames) {
                const start = keyframe.start + 1;
                const end = keyframe.start + keyframe.duration;
                let file = "";
                if (keyframe.script.trim() !== "") {
                    file = `${base}/${layerDir}/${start}.${ext}`;
                    files[file] = {
                        scene: sceneIndex,
                        layer: layer.index,
                        start: keyframe.start,
                        script: keyframe.script,
                        ...(item ? { item } : {}),
                    };
                    await writeToExportDir(file, keyframe.script);
                }
                const elementNames = keyframe.elements.map(
                    (element) => element.name || element.item || `(${element.type})`,
                );
                const cells = [
                    `${start}-${end}`,
                    keyframe.duration,
                    keyframe.tween,
                    keyframe.elements
                        .map((element) => `${element.name || "(unnamed)"} / ${element.item || "-"} / ${element.type}`)
                        .join("<br>"),
                    keyframe.label,
                    file,
                ].map((cell) => String(cell).replaceAll("|", "\\|"));
                md.push(`| ${cells.join(" | ")} |`);
                for (const elementName of elementNames) {
                    const list = names.get(elementName) ?? [];
                    const key = `${layer.name}: `;
                    const last = list.at(-1);
                    // Extend the range when it continues the previous one on the same layer
                    if (last?.startsWith(key) && last.endsWith(`-${keyframe.start}`)) {
                        list[list.length - 1] = `${last.slice(0, last.lastIndexOf("-"))}-${end}`;
                    } else list.push(`${key}${start}-${end}`);
                    names.set(elementName, list);
                }
            }
            md.push("");
        }
        md.push("## Name lookup", "", "| Name | Frames |", "| --- | --- |");
        for (const [elementName, ranges] of names)
            md.push(`| ${elementName.replaceAll("|", "\\|")} | ${ranges.join("<br>").replaceAll("|", "\\|")} |`);
        await writeToExportDir(`${base}/structure.md`, `${md.join("\n")}\n`);
        index.push(`| ${scene.name} | [${base}/structure.md](${base}/structure.md) |`);
        exported.push(scene.name);
    }
    await writeToExportDir("index.md", `${index.join("\n")}\n`);
    // For Apply's conflict detection: record the content at Export
    await writeAtomic(join(dir, ".export.json"), JSON.stringify({ document: data.document, type: data.type, files }));
    return { dir, exported, failed, linkedClasses };
}
