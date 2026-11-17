import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const OPEN_DOCUMENT_INPUT = {
    path: z.string().min(1).optional().describe("Path or file URI of an existing .fla file to open"),
    type: z.enum(["timeline", "htmlcanvas"]).optional().describe("Create a new AS3 timeline or HTML5 Canvas document"),
};
const OPEN_DOCUMENT_RESULT = z.object({ name: z.string(), path: z.string().nullable() }).strict();

export const openDocumentTool: ToolDefinition<typeof OPEN_DOCUMENT_INPUT> = {
    name: "open_document",
    description:
        "Open an existing .fla by path, or create a new AS3 timeline or HTML5 Canvas document with Animate's defaults. Specify exactly one of path or type; this never chooses an active document. Returns the document name and Animate-reported path (null for a new unsaved document).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: OPEN_DOCUMENT_INPUT,
    guidance: {},
    /**
     * Opens an existing document or creates a new one.
     * @param path Existing document path, when opening a file.
     * @param type New document type, when creating a document.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The opened or created document name and path.
     */
    run: async ({ path, type }: Parameters<ToolCallback<typeof OPEN_DOCUMENT_INPUT>>[0], deps: ToolDeps) => {
        if (Boolean(path) === Boolean(type)) {
            throw new Error("Specify exactly one of path or type");
        }
        const result = await deps.jsfl.run(
            "document/open-document",
            { __openDocumentPath: path ?? "", __openDocumentType: type ?? "" },
            OPEN_DOCUMENT_RESULT,
        );
        return { data: result };
    },
};

/**
 * Registers the open_document tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerOpenDocument(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, openDocumentTool, deps);
}
