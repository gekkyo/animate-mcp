import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Launcher = (runFile: string) => Promise<void>;

/**
 * code を eval し、結果かエラーを Result file に JSON で書く Run file の中身を生成する。
 * @param code 実行する JSFL ソース
 * @param resultPath Result file の絶対パス
 * @returns Run file に書き出す JSFL ソース文字列
 */
// shortcut: JSFL に JSON が無いためプリミティブのみ直列化（オブジェクトは文字列になる）。必要になったら対応する。
function runFileSource(code: string, resultPath: string): string {
    return String.raw`var __path = FLfile.platformPathToURI(${JSON.stringify(resultPath)});
function __q(s) {
  s = String(s);
  var o = '"';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i), n = s.charCodeAt(i);
    if (c === '"') o += '\\"';
    else if (c === '\\') o += '\\\\';
    else if (n < 32) o += '\\u' + ('0000' + n.toString(16)).slice(-4);
    else o += c;
  }
  return o + '"';
}
function __ser(v) {
  if (typeof JSON !== 'undefined') return JSON.stringify(v);
  if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
  return (v === null || typeof v === 'boolean') ? String(v) : __q(v);
}
var __out;
try {
  var __r = eval(${JSON.stringify(code)});
  __out = '{"result":' + (__r === undefined ? 'null' : __ser(__r)) + '}';
} catch (e) {
  __out = '{"error":' + __q(e && e.message ? e.message : e) + '}';
}
FLfile.write(__path, __out);
`;
}

/**
 * JSFL を Animate で実行する Runner を作る。Run は直列化され、タイムアウトと後始末を持つ。
 * @param options.dir Run file / Result file の置き場（mode 0700 にする）
 * @param options.launch Run file を Animate で開く Launcher
 * @param options.isRunning Animate が起動中かを返す関数
 * @param options.timeoutMs 1 回の Run のタイムアウト（ミリ秒。起動時間も含む）
 * @param options.pollMs Result file のポーリング間隔（ミリ秒。省略時 100）
 * @returns execute メソッドを持つ Runner
 */
export function createRunner(options: {
    dir: string;
    launch: Launcher;
    isRunning: () => Promise<boolean>;
    timeoutMs: number;
    pollMs?: number;
}) {
    let queue: Promise<unknown> = Promise.resolve();

    /**
     * 1 回の Run: Run file を書いて起動し、Result file をポーリングして結果を返す（終了時に両ファイルを削除）。
     * @param code 実行する JSFL ソース
     * @returns code の評価結果（Promise<unknown>）。Animate 未起動・JSFL の例外・タイムアウトは reject
     */
    async function run(code: string): Promise<unknown> {
        if (!(await options.isRunning())) throw new Error("Animate not running: start Adobe Animate and try again");
        await mkdir(options.dir, { recursive: true, mode: 0o700 });
        // 既存ディレクトリでは mkdir の mode が効かないため
        await chmod(options.dir, 0o700);
        const id = randomUUID();
        const runFile = join(options.dir, `${id}.jsfl`);
        const resultFile = join(options.dir, `${id}.result.json`);
        const deadline = Date.now() + options.timeoutMs;
        const timedOut = () => new Error(`Run timed out after ${options.timeoutMs} ms`);
        try {
            await writeFile(runFile, runFileSource(code, resultFile), { mode: 0o600 });
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([
                    options.launch(runFile),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(timedOut()), options.timeoutMs);
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
            while (Date.now() < deadline) {
                try {
                    const parsed = JSON.parse(await readFile(resultFile, "utf8")) as {
                        result?: unknown;
                        error?: string;
                    };
                    if (typeof parsed.error === "string") throw new Error(parsed.error);
                    return parsed.result;
                } catch (error) {
                    // Result file が未作成または書き込み途中ならポーリング続行
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError))
                        throw error;
                }
                await new Promise((r) => setTimeout(r, options.pollMs ?? 100));
            }
            throw timedOut();
        } finally {
            await rm(runFile, { force: true });
            await rm(resultFile, { force: true });
        }
    }

    return {
        /**
         * code を実行して結果を返す。Animate は起動したファイルを 1 つずつ処理するため Run は直列化する。
         * @param code 実行する JSFL ソース
         * @returns run と同じ結果の Promise<unknown>（前の Run が失敗しても次は実行される）
         */
        execute(code: string): Promise<unknown> {
            const next = queue.then(() => run(code));
            queue = next.catch(() => undefined);
            return next;
        },
    };
}
