import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import type { Launcher } from "./runner.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * Returns the newest "Adobe Animate <year>" in /Applications (2024 if none is found).
 * @returns App name to pass to `open -a`
 */
const installedMacApp = () => {
    try {
        const apps = readdirSync("/Applications")
            .filter(
                /** Keeps application directory names for Adobe Animate releases.
                 * @param name Application directory entry
                 * @returns Whether the entry names an Adobe Animate release
                 */
                (name) => /^Adobe Animate \d{4}$/.test(name),
            )
            .sort();
        return apps.at(-1) ?? "Adobe Animate 2024";
    } catch {
        return "Adobe Animate 2024";
    }
};

/**
 * Creates a Launcher that opens a Run file in Animate. Success means exit code 0.
 * @returns Launcher that opens runFile (absolute path of the Run file); the returned Promise<void> resolves when the launch command exits normally and rejects on failure or abnormal exit
 */
export function launcher(): Launcher {
    // For tests: a fake Animate
    const custom = process.env.ANIMATE_MCP_LAUNCH_COMMAND;
    // Windows opens via the .jsfl association (Animate); macOS names the app explicitly
    let command: string;
    let args: string[];
    if (custom) {
        [command, args] = [custom, []];
    } else if (IS_WINDOWS) {
        [command, args] = ["cmd", ["/c", "start", ""]];
    } else {
        [command, args] = ["open", ["-a", installedMacApp()]];
    }
    return (
        /** Opens the Run file with the selected launch command.
         * @param runFile Absolute path of the Run file
         * @returns Resolves when the launch command exits normally; rejects on launch failure or abnormal exit
         */
        (runFile) =>
            new Promise(
                /** Settles according to the launch command's exit status.
                 * @param resolve Resolves after a successful launch
                 * @param reject Rejects when spawning fails or the command exits abnormally
                 * @returns Nothing
                 */
                (resolve, reject) => {
                    const child = spawn(command, [...args, runFile], { stdio: "ignore" });
                    child.once("error", reject);
                    child.once(
                        "exit",
                        /** Resolves or rejects based on the child process exit code.
                         * @param code Child process exit code, or null when terminated by a signal
                         * @returns Nothing
                         */
                        (code) => (code === 0 ? resolve() : reject(new Error(`Launcher exited with code ${code}`))),
                    );
                },
            )
    );
}

/**
 * Tells whether Animate is running. pgrep -f matches the whole command line, and the pattern can be overridden for tests.
 * @returns Promise<boolean>, true when running (rejects when pgrep cannot be run)
 */
function isAnimateRunning(): Promise<boolean> {
    if (IS_WINDOWS) {
        // tasklist exits 0 even with no match, so check whether the output contains the process name (the image name can be overridden by an env var)
        const image = process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Animate.exe";
        return new Promise(
            /** Resolves whether the matching process is listed.
             * @param resolve Resolves with the process-presence result
             * @param reject Rejects if tasklist cannot be started
             * @returns Nothing
             */
            (resolve, reject) => {
                let output = "";
                const child = spawn("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
                    stdio: ["ignore", "pipe", "ignore"],
                });
                child.stdout.on(
                    "data",
                    /** Appends a tasklist output chunk for the process check.
                     * @param chunk Output bytes to append
                     * @returns Nothing
                     */
                    (chunk) => {
                        output += chunk;
                    },
                );
                child.once("error", reject);
                // "close" (not "exit") fires after stdout is fully read
                child.once(
                    "close",
                    /**
                     * Resolves whether tasklist output contains the process image.
                     * @returns Whether the process image appears in tasklist output
                     */
                    () => resolve(output.toLowerCase().includes(image.toLowerCase())),
                );
            },
        );
    }
    const pattern =
        process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Adobe Animate [0-9]{4}\\.app/Contents/MacOS/Adobe Animate";
    return new Promise(
        /** Resolves whether pgrep found a matching process.
         * @param resolve Resolves with the process-presence result
         * @param reject Rejects if pgrep cannot be started
         * @returns Nothing
         */
        (resolve, reject) => {
            const child = spawn("pgrep", ["-f", pattern], { stdio: "ignore" });
            child.once("error", reject);
            child.once(
                "exit",
                /** Resolves based on pgrep's exit status.
                 * @param code pgrep exit code
                 * @returns Whether pgrep found a matching process
                 */
                (code) => resolve(code === 0),
            );
        },
    );
}

export { installedMacApp, isAnimateRunning };
