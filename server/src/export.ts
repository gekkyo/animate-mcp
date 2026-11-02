import { mkdir, writeFile } from "node:fs/promises";
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
export type ExportScene = { name: string; layers?: { name: string; frames: ExportFrame[] }[]; error?: string };
export type ExportData = { document: string; type: string; scenes: ExportScene[] };

/**
 * ファイル名に使えない文字だけ "_" に置換する（名前はそのまま使う）。
 * @param name 元の名前
 * @returns パスの 1 要素として安全な文字列
 */
export const safeName = (name: string) =>
    [...name]
        .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char))
        .join("")
        .replace(/^\.+$/, "_") || "_";

/**
 * 同じ親の下で名前が衝突したら `_2` `_3` を付けて一意にする。
 * @param used 使用済みの名前の集合（更新される）
 * @param name 希望の名前
 * @returns 一意な名前
 */
function uniq(used: Set<string>, name: string): string {
    let candidate = name;
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${name}_${suffix}`;
    used.add(candidate);
    return candidate;
}

/**
 * Animate が返したデータを Export 形式（スクリプト・structure.md・index.md・衝突検知用 manifest）でディスクへ書き出す。
 * フレーム番号は Animate の UI に合わせて 1 始まり。
 * @param data export-scenes.jsfl の結果
 * @param dir 出力先ディレクトリ
 * @returns 成功したシーンと失敗したシーン（Linked class はライブラリ対応までは空）
 */
export async function writeExport(data: ExportData, dir: string) {
    const ext = data.type === "htmlcanvas" ? "js" : "as";
    const files: Record<string, string> = {};
    const writeToExportDir = async (rel: string, content: string) => {
        const path = join(dir, rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    };
    const exported: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const index: string[] = [`# ${data.document}`, "", "| タイムライン | structure |", "| --- | --- |"];
    const sceneDirs = new Set<string>();

    for (const scene of data.scenes) {
        if (!scene.layers) {
            failed.push({ name: scene.name, error: scene.error ?? "unknown error" });
            continue;
        }
        const base = `scenes/${uniq(sceneDirs, safeName(scene.name))}`;
        const layerDirs = new Set<string>();
        const md: string[] = [`# シーン: ${scene.name}`, ""];
        const names = new Map<string, string[]>();
        for (const layer of scene.layers) {
            const layerDir = uniq(layerDirs, safeName(layer.name));
            md.push(
                `## レイヤー: ${layer.name}`,
                "",
                "| フレーム | 長さ | Tween | 要素 | ラベル | スクリプト |",
                "| --- | --- | --- | --- | --- | --- |",
            );
            for (const keyframe of layer.frames) {
                const start = keyframe.start + 1;
                const end = keyframe.start + keyframe.duration;
                let file = "";
                if (keyframe.script.trim() !== "") {
                    file = `${base}/${layerDir}/${start}.${ext}`;
                    files[file] = keyframe.script;
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
                        .map((element) => `${element.name || "(無名)"} / ${element.item || "-"} / ${element.type}`)
                        .join("<br>"),
                    keyframe.label,
                    file,
                ].map((cell) => String(cell).replaceAll("|", "\\|"));
                md.push(`| ${cells.join(" | ")} |`);
                for (const elementName of elementNames) {
                    const list = names.get(elementName) ?? [];
                    const key = `${layer.name}: `;
                    const last = list.at(-1);
                    // 同じレイヤーで直前の区間と連続していれば範囲を延長する
                    if (last?.startsWith(key) && last.endsWith(`-${keyframe.start}`)) {
                        list[list.length - 1] = `${last.slice(0, last.lastIndexOf("-"))}-${end}`;
                    } else list.push(`${key}${start}-${end}`);
                    names.set(elementName, list);
                }
            }
            md.push("");
        }
        md.push("## 名前逆引き", "", "| 名前 | 存在するフレーム |", "| --- | --- |");
        for (const [elementName, ranges] of names)
            md.push(`| ${elementName.replaceAll("|", "\\|")} | ${ranges.join("<br>").replaceAll("|", "\\|")} |`);
        await writeToExportDir(`${base}/structure.md`, `${md.join("\n")}\n`);
        index.push(`| ${scene.name} | [${base}/structure.md](${base}/structure.md) |`);
        exported.push(scene.name);
    }
    await writeToExportDir("index.md", `${index.join("\n")}\n`);
    // Apply の衝突検知用: 書き出し時の内容を控える
    await writeToExportDir(".export.json", JSON.stringify({ document: data.document, type: data.type, files }));
    return { dir, exported, failed, linkedClasses: [] as string[] };
}
