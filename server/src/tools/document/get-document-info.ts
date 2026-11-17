import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isGreensockInstalled } from "../../greensock/greensock.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

const DOCUMENT_INFO_SCHEMA = z
    .object({
        name: z.string(),
        width: z.number(),
        height: z.number(),
        frameRate: z.number(),
        backgroundColor: z.string(),
        timelines: z.array(z.string()),
        asVersion: z.enum(["AS3", "AS2"]).nullable(),
        folder: z.string().nullable(),
    })
    .strict();

export const getDocumentInfoTool: ToolDefinition = {
    name: "get_document_info",
    description:
        "Get the active Animate document's name, size, frame rate, background color, timeline names, ActionScript version (null for Canvas/unknown), and whether GreenSock is installed beside the FLA.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        notes: "- When several documents are open, document is required. get_document_info returns the name.\n- AS3 and HTML5 Canvas have different APIs. Check the document type before trying things with run_jsfl.",
    },
    /**
     * Reads metadata for the active Animate document.
     * @param _args No input arguments.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Document metadata and GreenSock installation status.
     */
    run: async (_args: never, deps: ToolDeps) => {
        const { folder, ...info } = await deps.jsfl.run("document/get-document-info", {}, DOCUMENT_INFO_SCHEMA);
        const result = { ...info, greensock: info.asVersion === "AS3" && isGreensockInstalled(folder) };
        return { data: result };
    },
};

/**
 * Registers the get_document_info tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerGetDocumentInfo(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, getDocumentInfoTool, deps);
}
