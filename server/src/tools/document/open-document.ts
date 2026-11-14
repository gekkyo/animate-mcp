import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const OPEN_DOCUMENT_INPUT = {
    path: z.string().min(1).optional().describe("Path or file URI of an existing .fla file to open"),
    type: z.enum(["timeline", "htmlcanvas"]).optional().describe("Create a new AS3 timeline or HTML5 Canvas document"),
};

export const openDocumentTool: ToolDefinition<typeof OPEN_DOCUMENT_INPUT> = {
    name: "open_document",
    description:
        "Open an existing .fla by path, or create a new AS3 timeline or HTML5 Canvas document with Animate's defaults. Specify exactly one of path or type; this never chooses an active document. Returns the document name and Animate-reported path (null for a new unsaved document).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: OPEN_DOCUMENT_INPUT,
    guidance: {},
    run: async ({ path, type }: Parameters<ToolCallback<typeof OPEN_DOCUMENT_INPUT>>[0], deps: ToolDeps) => {
        const { runner, bundle } = deps;

        if (Boolean(path) === Boolean(type)) {
            throw new Error("Specify exactly one of path or type");
        }
        const code = jsflRun(
            "open-document",
            { __openDocumentPath: path ?? "", __openDocumentType: type ?? "" },
            bundle,
        );
        const value = String(await runner.execute(code));
        const separator = value.indexOf("\n");
        if (separator < 1) {
            throw new Error("Animate returned invalid document details");
        }
        const result = { name: value.slice(0, separator), path: value.slice(separator + 1) || null };
        return { data: result };
    },
};

export function registerOpenDocument(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, openDocumentTool, deps);
}
