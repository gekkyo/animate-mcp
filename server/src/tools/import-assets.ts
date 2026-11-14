import { stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../jsfl-bundle.js";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const IMPORT_ASSETS_INPUT = {
    paths: z.array(z.string().min(1)).min(1),
    document: z.string().min(1).optional(),
};
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".wav", ".mp3"]);

/** Registers the import_assets tool. */
export function registerImportAssets(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    const handleImportAssets: ToolCallback<typeof IMPORT_ASSETS_INPUT> = async ({ paths, document }) => {
        try {
            const assets = paths.map((path) => {
                if (!isAbsolute(path)) {
                    throw new Error(`Asset path must be absolute: ${path}`);
                }
                if (!SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) {
                    throw new Error(`Unsupported asset file extension: ${path}`);
                }
                return { name: basename(path), uri: pathToFileURL(path).href, path };
            });
            const names = new Set<string>();
            for (const asset of assets) {
                if (names.has(asset.name)) {
                    throw new Error(`Duplicate Library item name in assets: ${asset.name}`);
                }
                names.add(asset.name);
            }
            await Promise.all(
                assets.map(async (asset) => {
                    const file = await stat(asset.path).catch(() => {
                        throw new Error(`Asset file does not exist: ${asset.path}`);
                    });
                    if (!file.isFile()) {
                        throw new Error(`Asset path is not a file: ${asset.path}`);
                    }
                }),
            );

            const code = jsflRun(
                "import-assets",
                { __docName: document ?? "", __assets: assets.map(({ name, uri }) => ({ name, uri })) },
                bundle,
            );
            const result = JSON.parse(String(await runner.execute(code))) as { document: string; items: string[] };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "import_assets",
        {
            description:
                "Import existing PNG, JPEG, GIF, WAV, or MP3 files into the active document's Library without placing them on stage. All paths must be absolute; every file and Library-name collision is checked before importing. Specify document when several are open. Changes do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            inputSchema: IMPORT_ASSETS_INPUT,
        },
        handleImportAssets,
    );
}
