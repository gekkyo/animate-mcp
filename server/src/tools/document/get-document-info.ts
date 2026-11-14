import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isGreensockInstalled } from "../../greensock/greensock.js";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

export const getDocumentInfoTool: ToolDefinition = {
    name: "get_document_info",
    description:
        "Get the active Animate document's name, size, frame rate, background color, timeline names, ActionScript version (null for Canvas/unknown), and whether GreenSock is installed beside the FLA.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        notes: "- When several documents are open, document is required. get_document_info returns the name.\n- AS3 and HTML5 Canvas have different APIs. Check the document type before trying things with run_jsfl.",
    },
    run: async (_args: never, deps: ToolDeps) => {
        const { runner, bundle } = deps;

        const { folder, ...info } = JSON.parse(
            String(await runner.execute(jsflRun("get-document-info", {}, bundle))),
        ) as {
            name: string;
            width: number;
            height: number;
            frameRate: number;
            backgroundColor: string;
            timelines: string[];
            asVersion: "AS3" | "AS2" | null;
            folder: string | null;
        };
        const result = { ...info, greensock: info.asVersion === "AS3" && isGreensockInstalled(folder) };
        return { data: result };
    },
};

export function registerGetDocumentInfo(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, getDocumentInfoTool, deps);
}
