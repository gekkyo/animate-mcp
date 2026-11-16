import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "animate-mcp-smoke-bin-"));

try {
    // npm <= 11 returns an array; npm 12 returns an object keyed by package name.
    const [packed] = Object.values(
        JSON.parse(
            execFileSync("npm", ["pack", "--json", "--pack-destination", temp], {
                cwd: root,
                encoding: "utf8",
            }),
        ),
    );
    const installDir = join(temp, "install");
    await mkdir(installDir);
    execFileSync("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", join(temp, packed.filename)], {
        stdio: "inherit",
    });

    const response = await initialize(join(installDir, "node_modules", ".bin", "animate-mcp"));
    assert.equal(response.id, 1);
    assert.deepEqual(response.result?.serverInfo, { name: "animate-mcp", version });
    console.log(`Bin startup smoke test passed (${version}).`);
} finally {
    await rm(temp, { recursive: true, force: true });
}

/**
 * Sends an MCP initialize request to the installed executable and returns its response.
 * @param {string} executable Installed package executable path
 * @returns {Promise<object>} Initialize response
 */
async function initialize(executable) {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
        stderr += chunk;
    });

    const response = (async () => {
        for await (const line of lines) {
            if (line.trim()) {
                return JSON.parse(line);
            }
        }
        throw new Error(`Server exited before initialize response: ${stderr}`);
    })();
    const processError = new Promise((_, reject) => child.once("error", reject));
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for initialize response")), 15_000);
        timer.unref();
    });

    try {
        child.stdin.end(
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "smoke-bin", version: "1.0.0" },
                },
            })}\n`,
        );
        return await Promise.race([response, processError, timeout]);
    } finally {
        clearTimeout(timer);
        lines.close();
        child.kill();
    }
}
