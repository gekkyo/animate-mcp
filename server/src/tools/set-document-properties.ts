import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "./shared.js";

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

export const setDocumentPropertiesTool: ToolDefinition<typeof SET_DOCUMENT_PROPERTIES_INPUT> = {
    name: "set_document_properties",
    description:
        "Set one or more document properties: width and height (integer pixels, conservative tool limit 1–3840), frameRate (0.01–120), or backgroundColor (#RRGGBB). Resizing does not scale or move stage content. Specify document when several are open. Changes do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: SET_DOCUMENT_PROPERTIES_INPUT,
    guidance: {},
    run: async (
        {
            width,
            height,
            frameRate,
            backgroundColor,
            document,
        }: Parameters<ToolCallback<typeof SET_DOCUMENT_PROPERTIES_INPUT>>[0],
        deps: ToolDeps,
    ) => {
        const { runner, bundle } = deps;

        const properties = { width, height, frameRate, backgroundColor };
        if (Object.values(properties).every((value) => value === undefined)) {
            throw new Error("Set at least one of width, height, frameRate, or backgroundColor");
        }
        const code = jsflRun(
            "set-document-properties",
            { __docName: document ?? "", __properties: properties },
            bundle,
        );
        const result = JSON.parse(String(await runner.execute(code))) as {
            document: string;
            properties: typeof properties;
        };
        return { data: result };
    },
};

export function registerSetDocumentProperties(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, setDocumentPropertiesTool, deps);
}
