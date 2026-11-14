import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const SET_DOCUMENT_PROPERTIES_INPUT = {
    width: z.number().int().min(1).max(3840).optional(),
    height: z.number().int().min(1).max(3840).optional(),
    frameRate: z.number().min(0.01).max(120).optional(),
    backgroundColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    document: z.string().min(1).optional(),
};

/** Registers the set_document_properties tool. */
export function registerSetDocumentProperties(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    const handleSetDocumentProperties: ToolCallback<typeof SET_DOCUMENT_PROPERTIES_INPUT> = async ({
        width,
        height,
        frameRate,
        backgroundColor,
        document,
    }) => {
        try {
            const properties = { width, height, frameRate, backgroundColor };
            if (Object.values(properties).every((value) => value === undefined)) {
                throw new Error("Set at least one of width, height, frameRate, or backgroundColor");
            }
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __properties = ${JSON.stringify(properties)};\n${bundle("select-document", "export-common", "set-document-properties")}`;
            const result = JSON.parse(String(await runner.execute(code))) as {
                document: string;
                properties: typeof properties;
            };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "set_document_properties",
        {
            description:
                "Set one or more document properties: width and height (integer pixels, conservative tool limit 1–3840), frameRate (0.01–120), or backgroundColor (#RRGGBB). Resizing does not scale or move stage content. Specify document when several are open. Changes do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
            inputSchema: SET_DOCUMENT_PROPERTIES_INPUT,
        },
        handleSetDocumentProperties,
    );
}
