import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Launcher = (runFile: string) => Promise<void>;

// shortcut: JSFL has no JSON, so only primitives are serialized (objects become strings); extend when needed.
/**
 * Builds the Run file: it evals code and writes the result or error to the Result file as JSON.
 * @param code JSFL source to run
 * @param resultPath Absolute path of the Result file
 * @returns JSFL source to write into the Run file
 */
function runFileSource(code: string, resultPath: string): string {
    return String.raw`// Resolve the Result file path.
var __path = FLfile.platformPathToURI(${JSON.stringify(resultPath)});

/** Escapes a string for inclusion in the JSON result file.
 * @param text Value to escape
 * @returns Quoted and escaped string
 */
function __quote(text) {
  text = String(text);
  var output = '"';
  for (var index = 0; index < text.length; index++) {
    var character = text.charAt(index), charCode = text.charCodeAt(index);
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (charCode < 32) output += '\\u' + ('0000' + charCode.toString(16)).slice(-4);
    else output += character;
  }
  return output + '"';
}

/** Serializes an evaluated value, with a fallback for older Animate versions.
 * @param value Value to serialize
 * @returns JSON-compatible text representation
 */
function __serialize(value) {
  if (typeof JSON !== 'undefined') return JSON.stringify(value);
  if (typeof value === 'number') return isFinite(value) ? String(value) : 'null';
  return (value === null || typeof value === 'boolean') ? String(value) : __quote(value);
}

// Evaluate the requested JSFL and capture either its result or its error.
var __out;
try {
  var __r = eval(${JSON.stringify(code)});
  __out = '{"result":' + (__r === undefined ? 'null' : __serialize(__r)) + '}';
} catch (e) {
  __out = '{"error":' + __quote(e && e.message ? e.message : e) + '}';
}

// Write the captured result for the Runner to read.
FLfile.write(__path, __out);
`;
}

/** Only files older than this count as leftovers, so files of a running Run are kept */
const STALE_MS = 60 * 60 * 1000;
/** Default delay between Result file polls */
const DEFAULT_POLL_MS = 100;

/**
 * Removes Run leftovers, such as a Result file Animate wrote after a timeout.
 * @param dir Directory holding Run files / Result files
 */
async function removeStaleFiles(dir: string) {
    for (const name of await readdir(dir)) {
        const path = join(dir, name);
        try {
            if (Date.now() - (await stat(path)).mtimeMs > STALE_MS) {
                await rm(path, { force: true });
            }
        } catch (error) {
            // Ignore files another process's Run removed at the same time
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }
}

/**
 * Creates a Runner that runs JSFL in Animate. Runs are serialized, with a timeout and cleanup.
 * @param options.dir Directory for Run files / Result files (set to mode 0700)
 * @param options.launch Launcher that opens a Run file in Animate
 * @param options.isRunning Function that tells whether Animate is running
 * @param options.timeoutMs Timeout of one Run in milliseconds (includes launch time)
 * @param options.pollMs Polling interval for the Result file in milliseconds (default 100)
 * @returns Runner with an execute method
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
     * One Run: writes and launches the Run file, polls the Result file and returns the result (both files are deleted at the end).
     * @param code JSFL source to run
     * @returns Promise<unknown> with the evaluation result of code; rejects when Animate is not running, JSFL throws, or the Run times out
     */
    async function run(code: string): Promise<unknown> {
        if (!(await options.isRunning())) {
            throw new Error("Animate not running: start Adobe Animate and try again");
        }
        await mkdir(options.dir, { recursive: true, mode: 0o700 });
        // mkdir's mode has no effect on an existing directory
        await chmod(options.dir, 0o700);
        await removeStaleFiles(options.dir);
        const runId = randomUUID();
        const runFile = join(options.dir, `${runId}.jsfl`);
        const resultFile = join(options.dir, `${runId}.result.json`);
        const deadline = Date.now() + options.timeoutMs;
        /** Creates the timeout error for a Run that Animate did not finish in time.
         * @returns Timeout error
         */
        const timedOut = () =>
            new Error(
                `Run timed out after ${options.timeoutMs} ms (Animate did not run the .jsfl; on Windows check that .jsfl files are associated with Animate, or set ANIMATE_MCP_LAUNCH_COMMAND)`,
            );
        try {
            await writeFile(runFile, runFileSource(code, resultFile), { mode: 0o600 });
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([
                    options.launch(runFile),
                    new Promise<never>(
                        /** Rejects the launch race when the Run timeout expires.
                         * @param _ Unused resolve callback
                         * @param reject Rejects the launch race
                         */
                        (_, reject) => {
                            timer = setTimeout(
                                /** Rejects the pending launch with the timeout error.
                                 * @returns Timer handle
                                 */
                                () => reject(timedOut()),
                                options.timeoutMs,
                            );
                        },
                    ),
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
                    if (typeof parsed.error === "string") {
                        throw new Error(parsed.error);
                    }
                    return parsed.result;
                } catch (error) {
                    // Keep polling while the Result file is missing or still being written
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
                        throw error;
                    }
                }
                await new Promise(
                    /** Waits for the next Result file poll interval.
                     * @param resolve Resolves when the polling delay ends
                     */
                    (resolve) => setTimeout(resolve, options.pollMs ?? DEFAULT_POLL_MS),
                );
            }
            throw timedOut();
        } finally {
            await rm(runFile, { force: true });
            await rm(resultFile, { force: true });
        }
    }

    return {
        /**
         * Runs code and returns the result. Animate handles launched files one at a time, so Runs are serialized.
         * @param code JSFL source to run
         * @returns Promise<unknown> with the same result as run (the next Run still executes if the previous one failed)
         */
        execute(code: string): Promise<unknown> {
            const next = queue.then(
                /** Runs this request after the previous queued Run settles.
                 * @returns Result of this Run
                 */
                () => run(code),
            );
            queue = next.catch(
                /** Keeps the queue usable after a failed Run.
                 * @returns Undefined to settle the queue
                 */
                () => undefined,
            );
            return next;
        },
    };
}
