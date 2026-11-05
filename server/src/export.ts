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

type RenderedScript = { path: string; layerIndex: number; frameStart: number; script: string };

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
function uniqueName(used: Set<string>, name: string): string {
    // macOS / Windows are case-insensitive, so compare in lowercase
    let candidate = name;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++) {
        candidate = `${name}_${suffix}`;
    }
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

/** Adds an element's frame range, extending a consecutive range on the same layer. */
function addElementFrameRanges(
    elementRangesByName: Map<string, string[]>,
    elementNames: string[],
    layerName: string,
    start: number,
    end: number,
    frameStart: number,
) {
    for (const elementName of elementNames) {
        const ranges = elementRangesByName.get(elementName) ?? [];
        const layerPrefix = `${layerName}: `;
        const lastRange = ranges.at(-1);
        if (lastRange?.startsWith(layerPrefix) && lastRange.endsWith(`-${frameStart}`)) {
            ranges[ranges.length - 1] = `${lastRange.slice(0, lastRange.lastIndexOf("-"))}-${end}`;
        } else {
            ranges.push(`${layerPrefix}${start}-${end}`);
        }
        elementRangesByName.set(elementName, ranges);
    }
}

/** Renders one keyframe's Markdown row and its optional script-file path. */
function renderKeyframeMarkdown(keyframe: ExportFrame, scriptFile: string) {
    const start = keyframe.start + 1;
    const end = keyframe.start + keyframe.duration;
    const elementNames = keyframe.elements.map((element) => element.name || element.item || `(${element.type})`);
    const cells = [
        `${start}-${end}`,
        keyframe.duration,
        keyframe.tween,
        keyframe.elements
            .map((element) => `${element.name || "(unnamed)"} / ${element.item || "-"} / ${element.type}`)
            .join("<br>"),
        keyframe.label,
        scriptFile,
    ].map((cell) => String(cell).replaceAll("|", "\\|"));

    return {
        markdownLine: `| ${cells.join(" | ")} |`,
        elementNames,
        start,
        end,
    };
}

/** Renders one layer's Markdown table and writes its scripts during traversal. */
async function renderLayerMarkdown(
    layer: { index: number; name: string; frames: ExportFrame[] },
    timelineDirectory: string,
    layerDirectory: string,
    scriptExtension: string,
    elementRangesByName: Map<string, string[]>,
    writeScriptFile: (scriptFile: RenderedScript) => Promise<void>,
): Promise<string[]> {
    const markdownLines = [
        `## Layer: ${layer.name}`,
        "",
        "| Frames | Length | Tween | Elements | Label | Script |",
        "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const keyframe of layer.frames) {
        const start = keyframe.start + 1;
        const hasScript = keyframe.script.trim() !== "";
        const scriptFile = hasScript ? `${timelineDirectory}/${layerDirectory}/${start}.${scriptExtension}` : "";
        if (hasScript) {
            await writeScriptFile({
                path: scriptFile,
                layerIndex: layer.index,
                frameStart: keyframe.start,
                script: keyframe.script,
            });
        }
        const renderedKeyframe = renderKeyframeMarkdown(keyframe, scriptFile);
        markdownLines.push(renderedKeyframe.markdownLine);
        addElementFrameRanges(
            elementRangesByName,
            renderedKeyframe.elementNames,
            layer.name,
            renderedKeyframe.start,
            renderedKeyframe.end,
            keyframe.start,
        );
    }

    markdownLines.push("");
    return markdownLines;
}

/** Renders a scene or symbol's structure Markdown, writing its scripts during traversal. */
async function renderSceneMarkdown(
    scene: ExportScene,
    timelineDirectory: string,
    scriptExtension: string,
    libraryItemPath: string | undefined,
    writeScriptFile: (scriptFile: RenderedScript) => Promise<void>,
): Promise<string> {
    const markdownLines = [`# ${libraryItemPath ? "Symbol" : "Scene"}: ${scene.name}`, ""];
    const layerDirectories = new Set<string>();
    const elementRangesByName = new Map<string, string[]>();

    for (const layer of scene.layers ?? []) {
        const layerDirectory = uniqueName(layerDirectories, safeName(layer.name));
        const layerMarkdownLines = await renderLayerMarkdown(
            layer,
            timelineDirectory,
            layerDirectory,
            scriptExtension,
            elementRangesByName,
            writeScriptFile,
        );
        markdownLines.push(...layerMarkdownLines);
    }

    markdownLines.push("## Name lookup", "", "| Name | Frames |", "| --- | --- |");
    for (const [elementName, ranges] of elementRangesByName) {
        markdownLines.push(`| ${elementName.replaceAll("|", "\\|")} | ${ranges.join("<br>").replaceAll("|", "\\|")} |`);
    }
    return `${markdownLines.join("\n")}\n`;
}

/**
 * Writes the data Animate returned in the Export format (scripts, structure.md, index.md, and a manifest for conflict detection).
 * Frame numbers are 1-based to match the Animate UI.
 * @param data Result of export-scenes.jsfl
 * @param dir Output directory
 * @returns Names of exported / failed timelines and Linked classes (AS3 only; empty for Canvas)
 */
export async function writeExport(data: ExportData, dir: string) {
    const scriptExtension = data.type === "htmlcanvas" ? "js" : "as";
    const files: Record<string, ManifestFile> = {};
    /** Writes an export artifact, creating its parent directories first. */
    const writeToExportDir = async (relativePath: string, content: string) => {
        const path = join(dir, relativePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    };
    const exported: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const indexMarkdownLines: string[] = [`# ${data.document}`, "", "| Timeline | structure |", "| --- | --- |"];
    const sceneDirectories = new Set<string>();
    const libraryDirectories = new Set<string>();

    const timelines = [
        ...data.scenes.map((scene, sceneIndex) => ({
            scene,
            sceneIndex,
            libraryItemPath: undefined,
            linkedClassName: "",
        })),
        ...(data.symbols ?? []).map((symbol) => ({
            scene: symbol,
            sceneIndex: 0,
            libraryItemPath: symbol.name,
            linkedClassName: symbol.linked ?? "",
        })),
    ];
    const linkedClasses: { symbol: string; className: string; path: string }[] = [];
    for (const { scene, sceneIndex, libraryItemPath, linkedClassName } of timelines) {
        if (!scene.layers) {
            failed.push({ name: scene.name, error: scene.error ?? "unknown error" });
            continue;
        }
        const timelineDirectory = libraryItemPath
            ? uniqueName(libraryDirectories, `library/${libraryItemPath.split("/").map(safeName).join("/")}`)
            : `scenes/${uniqueName(sceneDirectories, safeName(scene.name))}`;
        if (linkedClassName) {
            linkedClasses.push({
                symbol: scene.name,
                className: linkedClassName,
                path: `${linkedClassName.replaceAll(".", "/")}.as`,
            });
        }
        const structureMarkdown = await renderSceneMarkdown(
            scene,
            timelineDirectory,
            scriptExtension,
            libraryItemPath,
            async (scriptFile) => {
                files[scriptFile.path] = {
                    scene: sceneIndex,
                    layer: scriptFile.layerIndex,
                    start: scriptFile.frameStart,
                    script: scriptFile.script,
                    ...(libraryItemPath ? { item: libraryItemPath } : {}),
                };
                await writeToExportDir(scriptFile.path, scriptFile.script);
            },
        );
        await writeToExportDir(`${timelineDirectory}/structure.md`, structureMarkdown);
        indexMarkdownLines.push(
            `| ${scene.name} | [${timelineDirectory}/structure.md](${timelineDirectory}/structure.md) |`,
        );
        exported.push(scene.name);
    }
    await writeToExportDir("index.md", `${indexMarkdownLines.join("\n")}\n`);
    // For Apply's conflict detection: record the content at Export
    await writeAtomic(join(dir, ".export.json"), JSON.stringify({ document: data.document, type: data.type, files }));
    return { dir, exported, failed, linkedClasses };
}
