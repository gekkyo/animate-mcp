import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const CLOSE_DOCUMENT_INPUT = {
    document: z.string().min(1).describe("Exact open document name or saved path"),
    discardUnsavedChanges: z
        .boolean()
        .optional()
        .describe("Must be true to discard unsaved changes; otherwise save first"),
};
const CLOSE_DOCUMENT_RESULT = z.object({ name: z.string(), path: z.string().nullable() }).strict();

export const closeDocumentTool: ToolDefinition<typeof CLOSE_DOCUMENT_INPUT> = {
    name: "close_document",
    description:
        "Close exactly one open document by its exact name or saved path. This never defaults to the active document or saves; it selects the Arrow tool in a separate Run before closing and leaves it selected. All unsaved changes are discarded without a prompt, so require explicit user consent and set discardUnsavedChanges to true only when that loss is intended. Otherwise call save_document first.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: CLOSE_DOCUMENT_INPUT,
    guidance: {},
    /**
     * Closes the explicitly selected document after requiring confirmation to discard edits.
     * @param document Exact document name or saved path.
     * @param discardUnsavedChanges Confirmation that unsaved edits may be discarded.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The closed document name and path.
     */
    run: async (
        { document, discardUnsavedChanges }: Parameters<ToolCallback<typeof CLOSE_DOCUMENT_INPUT>>[0],
        { jsfl }: ToolDeps,
    ) => {
        if (discardUnsavedChanges !== true) {
            throw new Error(
                "Set discardUnsavedChanges: true only when you intend to discard changes; otherwise call save_document first.",
            );
        }

        // unverified: A separate Arrow-tool Run avoided a crash once in isolation; the integrated close path has not been real-tested.
        await jsfl.run(
            "document/prepare-close",
            { __closeDocumentTarget: document, __closeDocumentRequireUnsaved: false },
            z.literal(true),
        );
        const result = await jsfl.run(
            "document/close-document",
            { __closeDocumentTarget: document },
            CLOSE_DOCUMENT_RESULT,
        );
        return { data: result };
    },
};

/**
 * Registers the close_document tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerCloseDocument(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, closeDocumentTool, deps);
}
