import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManifestFile } from "./export.js";

export type Edit = ManifestFile & { file: string; expected: string };

/**
 * Export 先の manifest と現在のファイル内容を比べ、Animate に反映する編集を集める。
 * 内容が変わっていないファイルは対象外、読めないファイルは失敗として返す。
 * @param dir Export 先ディレクトリ
 * @returns manifest のドキュメント名、反映する編集（script が新内容、expected が書き出し時の内容）、変更なしの数、読めなかったファイル
 */
export async function collectEdits(dir: string) {
    const manifest = JSON.parse(await readFile(join(dir, ".export.json"), "utf8")) as {
        document: string;
        files: Record<string, ManifestFile>;
    };
    const edits: Edit[] = [];
    const failed: { file: string; error: string }[] = [];
    let unchanged = 0;
    for (const [file, entry] of Object.entries(manifest.files)) {
        // ライブラリのシンボルの反映はチケット 04 で対応するまで対象外
        if (entry.item !== undefined) continue;
        try {
            const script = await readFile(join(dir, file), "utf8");
            if (script === entry.script) unchanged++;
            else edits.push({ ...entry, file, script, expected: entry.script });
        } catch (error) {
            failed.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { document: manifest.document, edits, unchanged, failed };
}
