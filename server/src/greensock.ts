import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GREEN_SOCK_VERSION = "12.1.5";
export const GREEN_SOCK_LICENSE_URL = "https://gsap.com/standard-license/";
const GREEN_SOCK_URL = "https://codeload.github.com/greensock/GreenSock-AS3/tar.gz/refs/tags/12.1.5";

/** Checks for the installed GreenSock entry point next to a saved document.
 * @param folder Platform path of the document folder, or null when unsaved
 * @returns Whether com/greensock/TweenLite.as exists
 */
export function isGreensockInstalled(folder: string | null): boolean {
    return folder ? existsSync(join(folder, "com", "greensock", "TweenLite.as")) : false;
}

/** Downloads and installs the GreenSock-AS3 sources beside a saved document.
 * @param folder Platform path of the document folder
 * @returns Promise<void> after installation completes
 */
export async function installGreensock(folder: string): Promise<void> {
    const packageDirectory = join(folder, "com");
    const destination = join(packageDirectory, "greensock");
    const tempDirectory = await mkdtemp(join(tmpdir(), "animate-mcp-greensock-"));
    let destinationCreated = false;
    let stage = "Download";
    try {
        // Test seam: override the GitHub archive URL with a local HTTP server in tests.
        // shortcut: no proxy support, upgrade when users need proxy-aware downloads.
        const response = await fetch(process.env.ANIMATE_MCP_GREENSOCK_URL ?? GREEN_SOCK_URL, {
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
        }
        const archive = join(tempDirectory, "greensock.tar.gz");
        await writeFile(archive, Buffer.from(await response.arrayBuffer()));
        stage = "Extract";
        await extractTar(archive, tempDirectory);
        const source = await findGreensockSource(tempDirectory);
        if (!source) {
            throw new Error("Extract failed: GreenSock-AS3 src/com/greensock folder not found");
        }

        stage = "Install";
        await mkdir(packageDirectory, { recursive: true });
        await mkdir(destination);
        destinationCreated = true;
        await cp(source, destination, { recursive: true });
    } catch (error) {
        if (destinationCreated) {
            await rm(destination, { recursive: true, force: true });
        }
        if (error instanceof Error && /^(Download failed:|tar command not found|Extract failed:)/.test(error.message)) {
            throw error;
        }
        throw new Error(`${stage} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        await rm(tempDirectory, { recursive: true, force: true });
    }
}

/** Extracts a gzip tar archive with the system tar command.
 * @param archive Path to the downloaded archive
 * @param destination Directory to extract into
 * @returns Promise<void> after extraction completes
 */
function extractTar(archive: string, destination: string): Promise<void> {
    return new Promise(
        /** Runs tar and resolves when the archive has been extracted.
         * @param resolve Resolves after successful extraction
         * @param reject Rejects when tar fails
         * @returns Nothing
         */
        (resolve, reject) => {
            const child = spawn("tar", ["-xzf", archive, "-C", destination], { stdio: ["ignore", "ignore", "pipe"] });
            let stderr = "";
            child.stderr?.setEncoding("utf8");
            child.stderr?.on(
                "data",
                /** Accumulates tar's error output for a useful failure message.
                 * @param chunk Text from the tar process
                 * @returns Nothing
                 */
                (chunk: string) => {
                    stderr += chunk;
                },
            );
            child.on(
                "error",
                /** Converts process startup errors to a user-facing extraction error.
                 * @param error Process startup error
                 * @returns Nothing
                 */
                (error: NodeJS.ErrnoException) => {
                    reject(
                        error.code === "ENOENT"
                            ? new Error("tar command not found")
                            : new Error(`Extract failed: ${error.message}`),
                    );
                },
            );
            child.on(
                "close",
                /** Resolves the process result or reports tar's stderr.
                 * @param code Process exit code, or null when terminated by a signal
                 * @returns Nothing
                 */
                (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Extract failed: ${stderr.trim() || `tar exited with code ${String(code)}`}`));
                    }
                },
            );
        },
    );
}

/** Finds the expected GreenSock source directory in the extracted archive.
 * @param directory Extraction root
 * @returns Source directory path, or null if it is absent
 */
async function findGreensockSource(directory: string): Promise<string | null> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const candidate = join(directory, entry.name, "src", "com", "greensock");
        try {
            if ((await stat(candidate)).isDirectory()) {
                return candidate;
            }
        } catch {
            // Continue searching the extracted top-level directories.
        }
    }
    return null;
}
