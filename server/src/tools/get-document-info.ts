import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

/**
 * Registers the get_document_info tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerGetDocumentInfo(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Returns information about the active Animate document.
     * @returns Tool result containing the parsed document information, or an MCP error result
     */
    const handleGetDocumentInfo: ToolCallback = async () => {
        try {
            const info = JSON.parse(
                String(await runner.execute(bundle("export-common", "get-document-info"))),
            ) as unknown;
            return {
                content: [{ type: "text", text: JSON.stringify(info) }],
                structuredContent: info as Record<string, unknown>,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "get_document_info",
        { description: "Get the active Animate document's name, size, frame rate and timeline names." },
        handleGetDocumentInfo,
    );
}
