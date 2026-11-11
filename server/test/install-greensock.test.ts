import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

const TAR_AVAILABLE = spawnSync("tar", ["--version"], { stdio: "ignore" }).error === undefined;

/** Starts a local HTTP server serving a minimal GreenSock-AS3 tarball.
 * @param fn Test callback receiving the local archive URL
 * @returns Promise<void> after the callback and cleanup finish
 */
async function withGreensockTarball(fn: (url: string) => Promise<void>): Promise<void> {
    const tempDir = await mkdtemp(join(tmpdir(), "greensock-test-"));
    const packageDir = join(tempDir, "GreenSock-AS3-12.1.5");
    const sourceDir = join(packageDir, "src", "com", "greensock");
    const archive = join(tempDir, "greensock.tar.gz");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "TweenLite.as"), "package com.greensock { public class TweenLite {} }");
    await writeFile(join(sourceDir, "TweenMax.as"), "package com.greensock { public class TweenMax {} }");
    const tar = spawnSync("tar", ["-czf", archive, "-C", tempDir, "GreenSock-AS3-12.1.5"], { encoding: "utf8" });
    assert.equal(tar.status, 0, tar.stderr);

    const server = createServer(
        /** Serves the prepared archive to local test requests.
         * @param request Incoming HTTP request
         * @param response HTTP response
         * @returns Nothing
         */
        (request, response) => {
            if (request.url !== "/greensock.tar.gz") {
                response.writeHead(404).end();
                return;
            }
            response.writeHead(200, { "content-type": "application/gzip" });
            createReadStream(archive).pipe(response);
        },
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    try {
        await fn(`http://127.0.0.1:${address.port}/greensock.tar.gz`);
    } finally {
        await new Promise<void>(
            /** Closes the local test HTTP server.
             * @param resolveClose Resolves after the server closes
             * @param rejectClose Rejects if closing fails
             * @returns Nothing
             */
            (resolveClose, rejectClose) =>
                server.close(
                    /** Reports whether the local server closed successfully.
                     * @param error Server-close error, if any
                     * @returns Nothing
                     */
                    (error) => (error ? rejectClose(error) : resolveClose()),
                ),
        );
        await rm(tempDir, { recursive: true, force: true });
    }
}

test(
    "install_greensock requires confirmation and names the destination and license",
    { timeout: 20_000 },
    /** Checks the confirmation guard and its actionable destination message.
     * @returns Promise<void> after the assertion completes
     */
    async () =>
        withServer(
            {},
            /** Calls the tool without confirmation and checks its license prompt.
             * @param client MCP client connected to the fake server
             * @param tempDir Temporary document directory
             * @returns Promise<void> after the assertions complete
             */
            async (client, tempDir) => {
                const result = await client.callTool({ name: "install_greensock", arguments: {} });
                assert.equal(result.isError, true);
                assert.ok(text(result).includes(join(tempDir, "document", "com", "greensock")));
                assert.match(text(result), /https:\/\/gsap\.com\/standard-license\//);
                assert.match(text(result), /confirm: true/);
            },
        ),
);

test("install_greensock refuses unsaved, AS2, and Canvas documents", {
    timeout: 30_000,
} /** Checks document-type guards.
 * @returns Promise<void> after all assertions complete
 */, async () => {
    await withServer(
        { FAKE_UNSAVED: "1" },
        /** Verifies an unsaved document is refused.
         * @param client MCP client connected to the fake server
         * @returns Promise<void> after the assertion completes
         */
        async (client) => {
            const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
            assert.equal(result.isError, true);
            assert.match(text(result), /Save the document first/);
        },
    );
    await withServer(
        { FAKE_AS_VERSION: "AS2" },
        /** Verifies an AS2 document is refused.
         * @param client MCP client connected to the fake server
         * @returns Promise<void> after the assertion completes
         */
        async (client) => {
            const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
            assert.equal(result.isError, true);
            assert.match(text(result), /AS2/);
        },
    );
    await withServer(
        { FAKE_TYPE: "htmlcanvas" },
        /** Verifies HTML5 Canvas instructions.
         * @param client MCP client connected to the fake server
         * @returns Promise<void> after the assertions complete
         */
        async (client) => {
            const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
            assert.equal(result.isError, true);
            assert.match(text(result), /createjs\.Tween/);
            assert.match(text(result), /GSAP is not supported for Canvas/);
        },
    );
});

test(
    "install_greensock downloads and installs GreenSock next to the FLA",
    { skip: !TAR_AVAILABLE, timeout: 30_000 },
    /** Verifies installation from a local tarball.
     * @returns Promise<void> after installation and assertions complete
     */
    async () =>
        withGreensockTarball(
            /** Uses the local fixture server to test the install path.
             * @param url Local tarball URL
             * @returns Promise<void> after the install assertions complete
             */
            (url) =>
                withServer(
                    { ANIMATE_MCP_GREENSOCK_URL: url },
                    /** Verifies the downloaded fixture is installed beside the FLA.
                     * @param client MCP client connected to the fake server
                     * @param tempDir Temporary document directory
                     * @returns Promise<void> after the assertions complete
                     */
                    async (client, tempDir) => {
                        const result = await client.callTool({
                            name: "install_greensock",
                            arguments: { confirm: true },
                        });
                        const destination = join(tempDir, "document", "com", "greensock");
                        assert.equal(result.isError, undefined, text(result));
                        assert.ok(existsSync(join(destination, "TweenLite.as")));
                        assert.ok(existsSync(join(destination, "TweenMax.as")));
                        assert.match(text(result), /12\.1\.5/);
                        assert.match(text(result), /https:\/\/gsap\.com\/standard-license\//);
                        assert.match(text(result), /not modified or saved/i);
                        assert.match(text(result), /default classpath/i);
                    },
                ),
        ),
);

test("install_greensock is a no-op when installed and rejects an incomplete folder", {
    timeout: 30_000,
} /** Verifies existing installation handling.
 * @returns Promise<void> after all assertions complete
 */, async () => {
    await withServer(
        {},
        /** Checks an existing valid installation is left untouched.
         * @param client MCP client connected to the fake server
         * @param tempDir Temporary document directory
         * @returns Promise<void> after the assertions complete
         */
        async (client, tempDir) => {
            const destination = join(tempDir, "document", "com", "greensock");
            await mkdir(destination, { recursive: true });
            await writeFile(join(destination, "TweenLite.as"), "already installed");
            const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
            assert.equal(result.isError, undefined, text(result));
            assert.match(text(result), /GreenSock already installed/);
            assert.match(text(result), /TweenLite\.as/);
        },
    );
    await withServer(
        {},
        /** Checks an incomplete installation is refused.
         * @param client MCP client connected to the fake server
         * @param tempDir Temporary document directory
         * @returns Promise<void> after the assertions complete
         */
        async (client, tempDir) => {
            const destination = join(tempDir, "document", "com", "greensock");
            await mkdir(destination, { recursive: true });
            await writeFile(join(destination, "TweenMax.as"), "incomplete");
            const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
            assert.equal(result.isError, true);
            assert.match(text(result), /Folder com\/greensock exists but is incomplete/);
        },
    );
});

test("install_greensock cleans up after a failed download", {
    timeout: 30_000,
} /** Verifies download errors leave no installation directory.
 * @returns Promise<void> after the assertion completes
 */, async () => {
    const server = createServer(
        /** Returns 404 to test the failed-download path.
         * @param request Incoming HTTP request, unused by this handler
         * @param response HTTP response
         * @returns Nothing
         */
        (_request, response) => response.writeHead(404).end(),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    try {
        await withServer(
            { ANIMATE_MCP_GREENSOCK_URL: `http://127.0.0.1:${address.port}/missing.tar.gz` },
            /** Verifies a 404 leaves no partial installation.
             * @param client MCP client connected to the fake server
             * @param tempDir Temporary document directory
             * @returns Promise<void> after the assertions complete
             */
            async (client, tempDir) => {
                const result = await client.callTool({ name: "install_greensock", arguments: { confirm: true } });
                assert.equal(result.isError, true);
                assert.match(text(result), /Download failed:.*404/);
                assert.equal(existsSync(join(tempDir, "document", "com", "greensock")), false);
            },
        );
    } finally {
        await new Promise<void>(
            /** Closes the local 404 server.
             * @param resolveClose Resolves after the server closes
             * @param rejectClose Rejects if closing fails
             * @returns Nothing
             */
            (resolveClose, rejectClose) =>
                server.close(
                    /** Reports whether the local server closed successfully.
                     * @param error Server-close error, if any
                     * @returns Nothing
                     */
                    (error) => (error ? rejectClose(error) : resolveClose()),
                ),
        );
    }
});

test(
    "get_document_info reports ActionScript version and GreenSock installation status",
    { timeout: 30_000 },
    /** Verifies get_document_info metadata before and after installation.
     * @returns Promise<void> after both assertions complete
     */
    async () =>
        withServer(
            {},
            /** Checks GreenSock status before and after adding its entry file.
             * @param client MCP client connected to the fake server
             * @param tempDir Temporary document directory
             * @returns Promise<void> after the assertions complete
             */
            async (client, tempDir) => {
                const result = await client.callTool({ name: "get_document_info", arguments: {} });
                assert.equal(result.isError, undefined, text(result));
                assert.equal((result.structuredContent as { asVersion: string }).asVersion, "AS3");
                assert.equal((result.structuredContent as { greensock: boolean }).greensock, false);
                const destination = join(tempDir, "document", "com", "greensock");
                await mkdir(destination, { recursive: true });
                await writeFile(join(destination, "TweenLite.as"), "installed");
                const installed = await client.callTool({ name: "get_document_info", arguments: {} });
                assert.equal((installed.structuredContent as { greensock: boolean }).greensock, true);
            },
        ),
);
