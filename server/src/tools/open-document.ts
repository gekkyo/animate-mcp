import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const OPEN_DOCUMENT_INPUT = {
    path: z.string().min(1).optional().describe("Path or file URI of an existing .fla file to open"),
    type: z.enum(["timeline", "htmlcanvas"]).optional().describe("Create a new AS3 timeline or HTML5 Canvas document"),
};

/** Registers the open_document tool. */
export function registerOpenDocument(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    const handleOpenDocument: ToolCallback<typeof OPEN_DOCUMENT_INPUT> = async ({ path, type }) => {
        try {
            if (Boolean(path) === Boolean(type)) {
                throw new Error("Specify exactly one of path or type");
            }
            const code = `var __openDocumentPath = ${JSON.stringify(path ?? "")};\nvar __openDocumentType = ${JSON.stringify(type ?? "")};\n${bundle("document-target", "open-document")}`;
            const value = String(await runner.execute(code));
            const separator = value.indexOf("\n");
            if (separator < 1) {
                throw new Error("Animate returned invalid document details");
            }
            const result = { name: value.slice(0, separator), path: value.slice(separator + 1) || null };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "open_document",
        {
            description:
                "Open an existing .fla by path, or create a new AS3 timeline or HTML5 Canvas document with Animate's defaults. Specify exactly one of path or type; this never chooses an active document. Returns the document name and Animate-reported path (null for a new unsaved document).",
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            inputSchema: OPEN_DOCUMENT_INPUT,
        },
        handleOpenDocument,
    );
}
