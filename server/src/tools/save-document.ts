import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const SAVE_DOCUMENT_INPUT = {
    document: z.string().min(1).describe("Exact open document name or path"),
    path: z.string().min(1).optional().describe("Optional save-as destination path or file URI"),
    confirm: z.literal(true).optional().describe("Required to overwrite; only pass after asking the user"),
};

/** Registers the save_document tool. */
export function registerSaveDocument(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    const handleSaveDocument: ToolCallback<typeof SAVE_DOCUMENT_INPUT> = async ({ document, path, confirm }) => {
        try {
            const code = `var __saveDocumentTarget = ${JSON.stringify(document)};\nvar __saveDocumentPath = ${JSON.stringify(path ?? "")};\nvar __saveDocumentConfirm = ${confirm === true};\n${bundle("document-target", "save-document")}`;
            const savedPath = await runner.execute(code);
            if (typeof savedPath !== "string" || !savedPath) {
                throw new Error("Animate returned an invalid saved path");
            }
            const result = { path: savedPath };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "save_document",
        {
            description:
                "Save an explicitly selected open document by exact name or path; this never defaults to the active document. Optionally provide a save-as path. Saving to the document's current path or any existing file requires confirm: true; ask the user before passing confirm: true. An unsaved document requires a save-as path. Returns Animate's verified saved path.",
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
            inputSchema: SAVE_DOCUMENT_INPUT,
        },
        handleSaveDocument,
    );
}
