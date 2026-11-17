// Packs the package, installs it like npx does, and checks the .bin symlink answers initialize.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs an npm command and returns trimmed stdout.
 * @param {string[]} args npm arguments
 * @param {string} [cwd] working directory
 * @returns {string} trimmed stdout
 */
const run = (args, cwd) => execFileSync("npm", args, { cwd, encoding: "utf8" }).trim();
const dir = mkdtempSync(join(tmpdir(), "animate-mcp-bin-"));

try {
    const tarball = run(["pack", "--silent", "--pack-destination", dir]).split("\n").pop();
    run(["init", "-y"], dir);
    run(["install", "--omit=dev", "--no-audit", "--no-fund", join(dir, tarball)], dir);

    const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-bin", version: "0" } },
    });
    const bin = join(dir, "node_modules", ".bin", "animate-mcp");
    const result = spawnSync(bin, { input: `${request}\n`, encoding: "utf8", timeout: 15_000 });

    if (!result.stdout.includes('"serverInfo"')) {
        console.error(`bin did not answer initialize (exit ${result.status}): ${result.stderr || "no output"}`);
        process.exitCode = 1;
    } else {
        console.log("smoke:bin ok");
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}
