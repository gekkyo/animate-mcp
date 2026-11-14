import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const CLOSE_DOCUMENT_INPUT = {
    document: z.string().min(1).describe("Exact open document name or saved path"),
    discardUnsavedChanges: z
        .boolean()
        .optional()
        .describe("Must be true to discard unsaved changes; otherwise save first"),
};

/** Registers the close_document tool. */
export function registerCloseDocument(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    const handleCloseDocument: ToolCallback<typeof CLOSE_DOCUMENT_INPUT> = async ({
        document,
        discardUnsavedChanges,
    }) => {
        if (discardUnsavedChanges !== true) {
            return failure(
                new Error(
                    "Set discardUnsavedChanges: true only when you intend to discard changes; otherwise call save_document first.",
                ),
            );
        }
        try {
            const code = `var __closeDocumentTarget = ${JSON.stringify(document)};\n${bundle("document-target", "close-document")}`;
            const value = String(await runner.execute(code));
            const separator = value.indexOf("\n");
            if (separator < 1) {
                throw new Error("Animate returned invalid closed-document details");
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
        "close_document",
        {
            description:
                "Close exactly one open document by its exact name or saved path. This never defaults to the active document or saves; all unsaved changes are discarded without a prompt, so require explicit user consent and set discardUnsavedChanges to true only when that loss is intended. Otherwise call save_document first.",
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
            inputSchema: CLOSE_DOCUMENT_INPUT,
        },
        handleCloseDocument,
    );
}
