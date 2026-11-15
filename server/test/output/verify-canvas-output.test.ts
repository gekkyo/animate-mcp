import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { text, withServer } from "../helpers/fake-animate.js";

/** Narrows an MCP result before accessing its content blocks.
 * @param result Value returned by the MCP client
 * @returns Whether the value is a call-tool result
 */
function isCallToolResult(result: unknown): result is CallToolResult {
    return typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content);
}

/** Skips browser-dependent checks only when Chrome is unavailable on this host.
 * @param result Result returned by the verification tool
 * @param context Node test context used to mark the test skipped
 * @returns Nothing
 */
function skipIfChromeUnavailable(result: unknown, context: TestContext): void {
    const message = text(result);
    if (
        isCallToolResult(result) &&
        result.isError &&
        message.includes("Could not launch installed Chrome; install Chrome to use verify_canvas_output.") &&
        /(?:Chrome.*(?:not found|doesn't exist|not installed)|executable.*(?:not found|doesn't exist))/i.test(message)
    ) {
        // Missing host Chrome is an environment limitation, not a product failure.
        context.skip("Installed Chrome is unavailable");
    }
}

test("verify_canvas_output opens an explicit HTML fixture, reports browser errors, and does not Publish when opted out", {
    timeout: 30_000,
}, async (context) => {
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const fixtureDir = join(tempDir, "site");
        await mkdir(fixtureDir);
        const htmlPath = join(fixtureDir, "index.html");
        await writeFile(
            htmlPath,
            "<!doctype html><script>console.error('fixture console error'); fetch('http://127.0.0.1:1/remote.js').catch(() => {}); setTimeout(() => { throw new Error('fixture page error'); }, 0)</script>",
        );
        const result = await client.callTool({
            name: "verify_canvas_output",
            arguments: { publish: false, htmlPath, observeMs: 100 },
        });
        skipIfChromeUnavailable(result, context);
        assert.ok(isCallToolResult(result));
        assert.equal(result.isError, undefined, text(result));
        const output = result.structuredContent?.browserOutput as {
            ok: boolean;
            consoleErrors: string[];
            pageErrors: string[];
            failedRequests: { url: string; networkDependent: boolean }[];
            observationWindowMs: number;
            observationComplete: boolean;
            note: string;
        };
        assert.equal(output.ok, false);
        assert.ok(output.consoleErrors.some((error) => error.includes("fixture console error")));
        assert.ok(output.pageErrors.some((error) => error.includes("fixture page error")));
        assert.ok(
            output.failedRequests.some((request) => request.networkDependent && request.url.includes("/remote.js")),
        );
        assert.match(output.note, /may be network-dependent/);
        assert.equal(output.observationWindowMs, 100);
        assert.equal(output.observationComplete, true);
        assert.ok(result.content.some((item) => item.type === "image" && item.mimeType === "image/png"));
        const publishLog = await readFile(join(tempDir, "log.publish"), "utf8").catch(() => "");
        assert.ok(!publishLog.split("\n").includes("publish"), "publish:false invoked Publish");
    });
});

test("verify_canvas_output serves local assets but blocks traversal and symlink escapes without exposing file contents", {
    timeout: 30_000,
}, async (context) => {
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const fixtureDir = join(tempDir, "site");
        await mkdir(fixtureDir);
        const secret = "SENSITIVE_FIXTURE_SENTINEL";
        await writeFile(join(tempDir, "secret.json"), JSON.stringify(secret));
        await writeFile(join(fixtureDir, "asset.json"), JSON.stringify("LOCAL_ASSET_OK"));
        const assetTypes = {
            "font.ttf": "font/ttf",
            "font.otf": "font/otf",
            "sound.ogg": "audio/ogg",
            "icon.ico": "image/x-icon",
        };
        await Promise.all(Object.keys(assetTypes).map((asset) => writeFile(join(fixtureDir, asset), "LOCAL_ASSET_OK")));
        await writeFile(join(fixtureDir, ".env"), secret);
        await writeFile(join(fixtureDir, "secret.fla"), secret);
        await symlink(join(tempDir, "secret.json"), join(fixtureDir, "escape.json"));
        const htmlPath = join(fixtureDir, "index.html");
        await writeFile(
            htmlPath,
            `<!doctype html><script>
Promise.all([
  fetch('/asset.json').then(r => r.json()),
  Promise.all(${JSON.stringify(Object.entries(assetTypes))}.map(([asset, type]) =>
    fetch('/' + asset).then(async r => ({ ok: r.status === 200 && r.headers.get('content-type') === type &&
      (await r.text()) === 'LOCAL_ASSET_OK' })))),
  fetch('/%2e%2e%2fsecret.json').then(r => ({ status: r.status })),
  fetch('/escape.json').then(r => ({ status: r.status })),
  fetch('/.env').then(r => ({ status: r.status })),
  fetch('/secret.fla').then(r => ({ status: r.status })),
]).then(([asset, mappedAssets, traversal, symlink, dotfile, unlisted]) => {
  if (asset !== 'LOCAL_ASSET_OK' || mappedAssets.some(asset => !asset.ok) ||
      traversal.status !== 404 || symlink.status !== 404 ||
      dotfile.status !== 404 || unlisted.status !== 404) {
    throw new Error('loopback server isolation failed: ' + JSON.stringify(mappedAssets));
  }
});
</script>`,
        );
        const result = await client.callTool({
            name: "verify_canvas_output",
            arguments: { publish: false, htmlPath, observeMs: 100 },
        });
        skipIfChromeUnavailable(result, context);
        assert.ok(isCallToolResult(result));
        assert.equal(result.isError, undefined, text(result));
        const browserOutput = result.structuredContent?.browserOutput as {
            ok: boolean;
            consoleErrors: string[];
            pageErrors: string[];
            failedRequests: { url: string; error: string }[];
        };
        assert.equal(browserOutput.ok, false);
        assert.ok(browserOutput.consoleErrors.length >= 4, JSON.stringify(browserOutput));
        assert.ok(browserOutput.consoleErrors.every((error) => error.includes("404")));
        assert.deepEqual(browserOutput.pageErrors, [], JSON.stringify(browserOutput));
        assert.equal(
            browserOutput.failedRequests.filter(
                (request) => request.url.endsWith("/secret.fla") && request.error === "HTTP 404",
            ).length,
            1,
            "HTTP 404 must be reported exactly once",
        );
        assert.ok(!JSON.stringify(result).includes(secret), "sensitive file content leaked into the tool result");
    });
});

test("verify_canvas_output rejects non-Canvas and non-absolute paths before browsing", {
    timeout: 20_000,
}, async () => {
    await withServer({}, async (client) => {
        const nonCanvas = await client.callTool({
            name: "verify_canvas_output",
            arguments: { publish: false, htmlPath: "/tmp/output.html" },
        });
        assert.equal(nonCanvas.isError, true);
        assert.match(text(nonCanvas), /HTML5 Canvas/);
        const relativePath = await client.callTool({
            name: "verify_canvas_output",
            arguments: { publish: false, htmlPath: "output.html" },
        });
        assert.equal(relativePath.isError, true);
        assert.match(text(relativePath), /absolute path/);
    });
});

test("verify_canvas_output Publishes by default and reports the separate Build result", {
    timeout: 30_000,
}, async (context) => {
    await withServer({ FAKE_TYPE: "htmlcanvas" }, async (client, tempDir) => {
        const outputDir = join(tempDir, "document");
        await mkdir(outputDir);
        await writeFile(join(outputDir, "a.html"), "<!doctype html><title>fixture</title>");
        const result = await client.callTool({
            name: "verify_canvas_output",
            arguments: { observeMs: 0 },
        });
        skipIfChromeUnavailable(result, context);
        assert.ok(isCallToolResult(result));
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent?.buildResult, {
            ok: true,
            compilerOutput: "not_checked",
            errors: [],
            warnings: [],
            note: "HTML5 Canvas: compile errors are unverified; ok only means Publish ran",
        });
        const publishLog = await readFile(join(tempDir, "log.publish"), "utf8");
        assert.ok(publishLog.split("\n").includes("publish"));
    });
});
