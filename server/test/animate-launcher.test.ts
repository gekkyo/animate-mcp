import assert from "node:assert/strict";
import { chmod, copyFile, link, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { installedMacApp, isAnimateRunning, launcher } from "../src/animate-launcher.js";

const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";

/** Creates an isolated temporary directory and removes it after the callback finishes.
 * @template T
 * @param prefix Temporary directory name prefix
 * @param callback Work to run inside the temporary directory
 * @returns The callback result
 */
async function withTempDirectory<T>(prefix: string, callback: (directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    try {
        return await callback(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

/** Runs a callback with selected environment variables temporarily set.
 * @template T
 * @param values Environment variable names and replacement values; undefined removes a variable
 * @param callback Work to run with the temporary environment
 * @returns The callback result
 */
async function withEnvironment<T>(values: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
    const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        return await callback();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

/** Creates a fake executable in the temporary directory.
 * @param directory Directory for the executable and its startup script
 * @param name Executable name
 * @param script JavaScript source run by the fake executable
 * @returns The executable path and optional preload script path on Windows
 */
async function createFakeExecutable(
    directory: string,
    name: string,
    script: string,
): Promise<{ command: string; preloadPath: string | undefined }> {
    if (IS_WINDOWS) {
        const command = join(directory, `${name}.exe`);
        try {
            await link(process.execPath, command);
        } catch {
            await copyFile(process.execPath, command);
        }
        const preloadPath = join(directory, `${name}-preload.cjs`);
        await writeFile(preloadPath, script);
        return { command, preloadPath };
    }

    const command = join(directory, name);
    await writeFile(command, `#!${process.execPath}\n${script}`);
    await chmod(command, 0o755);
    return { command, preloadPath: undefined };
}

/** Produces NODE_OPTIONS for a fake Windows executable.
 * @param preloadPath Fake executable startup script, if required
 * @returns NODE_OPTIONS value or undefined on Unix-like systems
 */
function fakeExecutableNodeOptions(preloadPath: string | undefined): string | undefined {
    if (!preloadPath) {
        return undefined;
    }
    return `--require=${JSON.stringify(preloadPath.replaceAll("\\", "/"))}`;
}

/** Returns PATH with the temporary executable directory taking precedence.
 * @param directory Directory containing fake commands
 * @returns PATH value
 */
function pathWithFakeCommands(directory: string): string {
    return [directory, process.env.PATH].filter(Boolean).join(delimiter);
}

test("installedMacApp selects the newest installed app or its fallback", {
    skip: !IS_MACOS,
} /** Compares the selected app with the installed Adobe Animate directories.
 * @returns Nothing
 */, async () => {
    const apps = await readdir("/Applications");
    const expected =
        apps
            .filter((name) => /^Adobe Animate \d{4}$/.test(name))
            .sort()
            .at(-1) ?? "Adobe Animate 2024";
    assert.equal(installedMacApp(), expected);
});

test(
    "isAnimateRunning uses the pgrep path and process-pattern override",
    { skip: IS_WINDOWS },
    /** Checks pgrep's match and no-match exit codes without inspecting real processes.
     * @returns Nothing
     */
    async () =>
        withTempDirectory(
            "animate-pgrep-",
            /** Exercises the pgrep branch with a fake command.
             * @param directory Temporary directory for the fake command
             * @returns Nothing
             */
            async (directory) => {
                await createFakeExecutable(
                    directory,
                    "pgrep",
                    `if (process.argv[2] !== "-f" || process.argv[3] !== process.env.EXPECTED_PATTERN) process.exit(42);\nprocess.exit(Number(process.env.FAKE_PGREP_EXIT_CODE));\n`,
                );
                await withEnvironment(
                    {
                        PATH: pathWithFakeCommands(directory),
                        ANIMATE_MCP_PROCESS_PATTERN: "fake-animate-pattern",
                        EXPECTED_PATTERN: "fake-animate-pattern",
                        FAKE_PGREP_EXIT_CODE: "0",
                    },
                    /** Checks both pgrep exit statuses using the overridden pattern.
                     * @returns Nothing
                     */
                    async () => {
                        assert.equal(await isAnimateRunning(), true);
                        process.env.FAKE_PGREP_EXIT_CODE = "1";
                        assert.equal(await isAnimateRunning(), false);
                    },
                );
            },
        ),
);

test(
    "isAnimateRunning uses the tasklist path and process-image override",
    { skip: !IS_WINDOWS },
    /** Checks tasklist output matching without inspecting real processes.
     * @returns Nothing
     */
    async () =>
        withTempDirectory(
            "animate-tasklist-",
            /** Exercises the tasklist branch with a fake command.
             * @param directory Temporary directory for the fake command
             * @returns Nothing
             */
            async (directory) => {
                const fake = await createFakeExecutable(
                    directory,
                    "tasklist",
                    `if (process.argv[1] !== "/FI" || process.argv[2] !== "IMAGENAME eq " + process.env.ANIMATE_MCP_PROCESS_PATTERN || process.argv[3] !== "/NH") process.exit(42);\nprocess.stdout.write(process.env.FAKE_TASKLIST_OUTPUT ?? "");\nprocess.exit(0);\n`,
                );
                await withEnvironment(
                    {
                        PATH: pathWithFakeCommands(directory),
                        ANIMATE_MCP_PROCESS_PATTERN: "CustomAnimate.exe",
                        FAKE_TASKLIST_OUTPUT: "customanimate.exe 1234 Console 1 10,000 K",
                        NODE_OPTIONS: fakeExecutableNodeOptions(fake.preloadPath),
                    },
                    /** Checks tasklist match and no-match output using the overridden image name.
                     * @returns Nothing
                     */
                    async () => {
                        assert.equal(await isAnimateRunning(), true);
                        process.env.FAKE_TASKLIST_OUTPUT = "INFO: No tasks are running";
                        assert.equal(await isAnimateRunning(), false);
                    },
                );
            },
        ),
);

test("launcher succeeds and rejects a nonzero fake launch" /** Checks success and nonzero exit handling with a fake executable.
 * @returns Nothing
 */, async () =>
    withTempDirectory(
        "animate-launcher-",
        /** Runs success and failure launch cases inside a temporary directory.
         * @param directory Temporary directory for the fake executable
         * @returns Nothing
         */
        async (directory) => {
            const fake = await createFakeExecutable(
                directory,
                "fake-launcher",
                "process.exit(Number(process.env.FAKE_LAUNCH_EXIT_CODE));\n",
            );
            const runFile = join(directory, "run.jsfl");
            await writeFile(runFile, "");
            await withEnvironment(
                {
                    ANIMATE_MCP_LAUNCH_COMMAND: fake.command,
                    FAKE_LAUNCH_EXIT_CODE: "0",
                    NODE_OPTIONS: fakeExecutableNodeOptions(fake.preloadPath),
                },
                /** Invokes the fake executable with successful and failing exit codes.
                 * @returns Nothing
                 */
                async () => {
                    await launcher()(runFile);
                    process.env.FAKE_LAUNCH_EXIT_CODE = "7";
                    await assert.rejects(launcher()(runFile), /Launcher exited with code 7/);
                },
            );
        },
    ));

test("launcher rejects when its custom executable is not found" /** Checks that a missing custom executable rejects with ENOENT.
 * @returns Nothing
 */, async () =>
    withTempDirectory(
        "animate-launcher-missing-",
        /** Runs the not-found launch case in a temporary directory.
         * @param directory Temporary directory for the missing command path
         * @returns Nothing
         */
        async (directory) => {
            const runFile = join(directory, "run.jsfl");
            await writeFile(runFile, "");
            await withEnvironment(
                { ANIMATE_MCP_LAUNCH_COMMAND: join(directory, "missing-launcher") },
                /** Invokes the missing executable and checks the spawn error.
                 * @returns Nothing
                 */
                async () => {
                    await assert.rejects(launcher()(runFile), { code: "ENOENT" });
                },
            );
        },
    ));

test(
    "isAnimateRunning rejects when pgrep cannot be found",
    { skip: IS_WINDOWS },
    /** Confirms a missing pgrep executable is reported as a spawn failure.
     * @returns Nothing
     */
    async () =>
        withTempDirectory(
            "animate-pgrep-missing-",
            /** Runs the missing-pgrep case with an isolated PATH.
             * @param directory Empty temporary directory used as PATH
             * @returns Nothing
             */
            async (directory) => {
                await withEnvironment(
                    { PATH: directory, ANIMATE_MCP_PROCESS_PATTERN: "fake-animate-pattern" },
                    /** Checks that the missing process query command is rejected.
                     * @returns The assertion result
                     */
                    async () => assert.rejects(isAnimateRunning(), { code: "ENOENT" }),
                );
            },
        ),
);
