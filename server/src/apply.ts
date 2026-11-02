import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ManifestFile } from "./export.js";

export type Edit = ManifestFile & { file: string; expected: string };

type Manifest = { document: string; type: string; files: Record<string, ManifestFile> };

const MANIFEST = ".export.json";

/**
 * Export 先の manifest を読む。
 * @param dir Export 先ディレクトリ
 * @returns manifest（無ければ reject）
 */
const readManifest = async (dir: string) => JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as Manifest;

/**
 * manifest のファイル名を Export 先の中に限って絶対パスにする（`../` で外を指す manifest を拒否する）。
 * @param dir Export 先ディレクトリ
 * @param file manifest のキー（dir からの相対パス）
 * @returns 絶対パス（dir の外なら例外）
 */
function insideDir(dir: string, file: string): string {
    const root = resolve(dir);
    const path = resolve(root, file);
    if (!path.startsWith(root + sep)) throw new Error(`Path outside the export directory: ${file}`);
    return path;
}

/**
 * Export 先の manifest と現在のファイル内容を比べ、Animate に反映する編集を集める。
 * 内容が変わっていないファイルは対象外、読めないファイルは失敗として返す。
 * @param dir Export 先ディレクトリ
 * @returns manifest のドキュメント名、反映する編集（script が新内容、expected が書き出し時の内容）、変更なしの数、読めなかったファイル
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
 * 反映できた内容を manifest に控え直す（次の Apply が「Animate 側が変わった」と誤判定しないように）。
 * @param dir Export 先ディレクトリ
 * @param edits Animate に反映できた編集
 */
export async function markApplied(dir: string, edits: Edit[]) {
    if (edits.length === 0) return;
    const manifest = await readManifest(dir);
    for (const edit of edits) manifest.files[edit.file].script = edit.script;
    await writeFile(join(dir, MANIFEST), JSON.stringify(manifest));
}

/**
 * 再 Export の前処理: 未反映の編集があれば拒否し、前回の Export が書いたファイルだけを消す（古いファイルを残さない）。
 * @param dir Export 先ディレクトリ
 * @param force true なら未反映の編集があっても上書きする
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
