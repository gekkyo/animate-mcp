import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const SAVE_DOCUMENT_INPUT = {
    document: z.string().min(1).describe("Exact open document name or path"),
    path: z.string().min(1).optional().describe("Optional save-as destination path or file URI"),
    confirm: z.literal(true).optional().describe("Required to overwrite; only pass after asking the user"),
};

export const saveDocumentTool: ToolDefinition<typeof SAVE_DOCUMENT_INPUT> = {
    name: "save_document",
    description:
        "Save an explicitly selected open document by exact name or path; this never defaults to the active document. Optionally provide a save-as path. Saving to the document's current path or any existing file requires confirm: true; ask the user before passing confirm: true. An unsaved document requires a save-as path. Returns Animate's verified saved path.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: SAVE_DOCUMENT_INPUT,
    guidance: {},
    /**
     * Saves the specified open document, optionally to a new path.
     * @param document Exact document name or path.
     * @param path Optional save-as destination.
     * @param confirm Confirmation to overwrite an existing file.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The verified saved path.
     */
    run: async (
        { document, path, confirm }: Parameters<ToolCallback<typeof SAVE_DOCUMENT_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const code = jsflRun(
            "save-document",
            {
                __saveDocumentTarget: document,
                __saveDocumentPath: path ?? "",
                __saveDocumentConfirm: confirm === true,
            },
            bundle,
        );
        const savedPath = await runner.execute(code);
        if (typeof savedPath !== "string" || !savedPath) {
            throw new Error("Animate returned an invalid saved path");
        }
        const result = { path: savedPath };
        return { data: result };
    },
};

/**
 * Registers the save_document tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerSaveDocument(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, saveDocumentTool, deps);
}
