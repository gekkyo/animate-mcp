import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

/** Maximum time allowed for a status probe, including time waiting in the Run queue. */
const GET_STATUS_TIMEOUT_MS = 5_000;
const DOCUMENT_STATUS = z
    .object({ name: z.string(), path: z.string().nullable(), type: z.string().nullable() })
    .strict();
const STATUS_RESPONSE = z
    .object({
        animate: z.literal("responding"),
        documents: z.array(DOCUMENT_STATUS),
        activeDocument: DOCUMENT_STATUS.nullable(),
    })
    .strict();

export const getStatusTool: ToolDefinition = {
    name: "get_status",
    description:
        "Check whether Animate responds and report open documents plus the active document's name, path, and type. No dirty or unsaved state is inferred.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {},
    run: async (_args: never, { jsfl }: ToolDeps) => {
        try {
            const result = await jsfl.run("document/get-status", {}, STATUS_RESPONSE, GET_STATUS_TIMEOUT_MS);
            return { data: result };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/timed out|Animate not running/i.test(message)) {
                return { data: { animate: "not_responding", documents: [], activeDocument: null } };
            }
            throw error;
        }
    },
};

/**
 * Registers the get_status tool.
 * @param server MCP server to register the tool with
 * @param deps Tool dependencies used by the registered handler
 */
export function registerGetStatus(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, getStatusTool, deps);
}
