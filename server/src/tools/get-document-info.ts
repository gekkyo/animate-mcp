import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isGreensockInstalled } from "../greensock/greensock.js";
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
            const { folder, ...info } = JSON.parse(
                String(await runner.execute(bundle("export-common", "document-runtime-info", "get-document-info"))),
            ) as {
                name: string;
                width: number;
                height: number;
                frameRate: number;
                timelines: string[];
                asVersion: "AS3" | "AS2" | null;
                folder: string | null;
            };
            const result = { ...info, greensock: info.asVersion === "AS3" && isGreensockInstalled(folder) };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "get_document_info",
        {
            description:
                "Get the active Animate document's name, size, frame rate, timeline names, ActionScript version (null for Canvas/unknown), and whether GreenSock is installed beside the FLA.",
        },
        handleGetDocumentInfo,
    );
}
