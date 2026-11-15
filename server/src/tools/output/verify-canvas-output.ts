import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Browser } from "playwright-core";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";
import { runPublish } from "./publish.js";

const INPUT = {
    document: z.string().optional().describe("Saved HTML5 Canvas document; defaults to the only open document"),
    publish: z.boolean().default(true).describe("Publish before checking the browser output"),
    htmlPath: z.string().optional().describe("Absolute path to the published HTML file; defaults to <FLA stem>.html"),
    observeMs: z
        .number()
        .int()
        .min(0)
        .max(30_000)
        .default(3000)
        .describe("Additional browser observation window in milliseconds"),
};

const MIME: Record<string, string> = {
    ".css": "text/css",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

/**
 * Checks whether a resolved path is the root or one of its descendants.
 * @param root Canonical directory boundary.
 * @param path Path to check.
 * @returns Whether the path stays within the root.
 */
function isInside(root: string, path: string): boolean {
    const rel = relative(root, path);
    return (
        rel === "" ||
        (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel))
    );
}

/**
 * Serves allowlisted files from a directory over an ephemeral loopback-only HTTP server.
 * @param root Canonical directory exposed by the server.
 * @returns The started server and its local URL.
 */
async function serveDirectory(root: string) {
    const server = createServer(async (request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD" }).end();
            return;
        }
        try {
            const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
            // Reject dot-prefixed path segments before resolving to prevent hidden-file access.
            if (pathname.split("/").some((segment) => segment.startsWith("."))) {
                throw new Error("dot path segments are not served");
            }
            const target = resolve(root, `.${pathname}`);
            if (!isInside(root, target)) {
                throw new Error("outside root");
            }
            const actual = await realpath(target);
            const contentType = MIME[extname(actual).toLowerCase()];
            // Recheck the canonical path so a symlink cannot escape the served directory.
            if (!isInside(root, actual) || !(await stat(actual)).isFile() || !contentType) {
                throw new Error("not a file");
            }
            response.writeHead(200, {
                "Content-Type": contentType,
                "X-Content-Type-Options": "nosniff",
            });
            if (request.method === "HEAD") {
                response.end();
            } else {
                createReadStream(actual).pipe(response);
            }
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        // Bind only to loopback so the temporary file server is not reachable on the LAN.
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Could not start the local HTML server");
    }
    return { server, url: `http://127.0.0.1:${address.port}` };
}

export const verifyCanvasOutputTool: ToolDefinition<typeof INPUT> = {
    name: "verify_canvas_output",
    description:
        "Optionally Publish a saved HTML5 Canvas document, load its HTML output in installed Chrome through a temporary loopback-only server, and return Browser output plus a screenshot. A clean result is not proof of visual correctness; authored page scripts run and remote assets may require network access.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: INPUT,
    guidance: {
        basic: "- Use verify_canvas_output to check a published HTML5 Canvas page in Chrome. By default Publish overwrites the document's configured outputs; use publish: false to avoid publishing or htmlPath to specify custom output. Page scripts run in Chrome.",
    },
    /**
     * Optionally publishes a Canvas document and inspects its browser output.
     * @param document Optional document selector.
     * @param publish Whether to publish before browser inspection.
     * @param htmlPath Optional absolute path to the published HTML file.
     * @param observeMs Additional time to observe browser events after page load.
     * @param deps Tool dependencies for Animate execution and JSFL bundles.
     * @returns Build details, browser diagnostics, and a screenshot.
     */
    run: async (
        { document, publish = true, htmlPath, observeMs = 3000 }: Parameters<ToolCallback<typeof INPUT>>[0],
        deps: ToolDeps,
    ) => {
        if (htmlPath && !isAbsolute(htmlPath)) {
            throw new Error("htmlPath must be an absolute path");
        }
        const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n${deps.bundle("select-document")}`;
        const info = await deps.runner.execute(
            `${prelude}\n(function () { var document = selectDocument(); if (!document.pathURI) throw new Error("Document is not saved; save first"); if (document.type !== "htmlcanvas") throw new Error("verify_canvas_output supports HTML5 Canvas documents only"); fl.setActiveWindow(document); return document.pathURI; })()`,
        );
        const flaPath = fileURLToPath(String(info));
        let buildResult: Record<string, unknown> | null = null;
        if (publish) {
            buildResult = await runPublish(document, deps);
        }

        const html = resolve(htmlPath ?? flaPath.replace(/\.[^.\\/]+$/, ".html"));
        let htmlReal: string;
        try {
            htmlReal = await realpath(html);
        } catch {
            throw new Error(
                `HTML output not found at ${html}; supply htmlPath if Publish uses a custom output location`,
            );
        }
        if (!(await stat(htmlReal)).isFile()) {
            throw new Error(`HTML output is not a file: ${htmlReal}`);
        }
        const root = await realpath(resolve(htmlReal, ".."));
        const { server, url } = await serveDirectory(root);
        let browser: Browser | undefined;
        try {
            const { chromium } = await import("playwright-core");
            try {
                browser = await chromium.launch({ channel: "chrome" });
            } catch (error) {
                throw new Error(
                    `Could not launch installed Chrome; install Chrome to use verify_canvas_output. ${String(error)}`,
                );
            }
            const page = await browser.newPage();
            const consoleErrors: string[] = [];
            const pageErrors: string[] = [];
            const failedRequests: { url: string; error: string; networkDependent: boolean }[] = [];
            const localOrigin = new URL(url).origin;
            page.on("console", (message) => {
                if (message.type() === "error") {
                    consoleErrors.push(message.text());
                }
            });
            page.on("pageerror", (error) => pageErrors.push(error.message));
            page.on("response", (response) => {
                if (response.status() >= 400) {
                    failedRequests.push({
                        url: response.url(),
                        error: `HTTP ${response.status()}`,
                        networkDependent: new URL(response.url()).origin !== localOrigin,
                    });
                }
            });
            page.on("requestfailed", (request) =>
                failedRequests.push({
                    url: request.url(),
                    error: request.failure()?.errorText ?? "request failed",
                    networkDependent: new URL(request.url()).origin !== localOrigin,
                }),
            );
            const response = await page.goto(`${url}/${encodeURIComponent(basename(htmlReal))}`, {
                waitUntil: "domcontentloaded",
            });
            if (!response?.ok()) {
                throw new Error(
                    `Could not load HTML output (HTTP ${response?.status() ?? "no response"}): ${htmlReal}`,
                );
            }
            await page.waitForTimeout(observeMs);
            const screenshot = await page.screenshot({ type: "png", fullPage: true });
            const networkDependencyNote = failedRequests.some((request) => request.networkDependent)
                ? "Failed remote request(s) may be network-dependent."
                : undefined;
            const browserOutput = {
                ok: consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
                consoleErrors,
                pageErrors,
                failedRequests,
                observationWindowMs: observeMs,
                observationComplete: true,
                note: [
                    networkDependencyNote,
                    "Browser output does not establish visual correctness or exclude later errors.",
                ]
                    .filter(Boolean)
                    .join(" "),
            };
            return {
                data: { buildResult, htmlPath: htmlReal, browserOutput },
                content: [
                    { type: "text", text: JSON.stringify({ buildResult, htmlPath: htmlReal, browserOutput }) },
                    { type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
                ],
            };
        } finally {
            try {
                await browser?.close();
            } finally {
                await new Promise<void>((done) => server.close(() => done()));
            }
        }
    },
};

/**
 * Registers the verify_canvas_output tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerVerifyCanvasOutput(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, verifyCanvasOutputTool, deps);
}
