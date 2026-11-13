import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const RUN_JSFL_INPUT = {
    code: z
        .string()
        .describe(
            "Arbitrary JSFL source to execute in Adobe Animate; use only when dedicated tools cannot accomplish the task.",
        ),
};

/**
 * Registers the run_jsfl tool.
 * @param server MCP server to register the tool with
 * @param deps Dependencies used to execute JSFL
 * @returns Nothing
 */
export function registerRunJsfl(server: McpServer, deps: { runner: Runner }): void {
    const { runner } = deps;
    /** Executes arbitrary JSFL and returns its result.
     * @param code JSFL source to execute
     * @returns Tool result containing the JSFL value, or an MCP error result
     */
    const handleRunJsfl: ToolCallback<typeof RUN_JSFL_INPUT> = async ({ code }) => {
        try {
            const result = await runner.execute(code);
            return {
                content: [{ type: "text", text: JSON.stringify(result) ?? "null" }],
                structuredContent: { result },
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "run_jsfl",
        {
            description:
                "Execute arbitrary code as JSFL inside Adobe Animate; it may modify documents or files. Prefer dedicated tools for document, timeline, tween, library, and script operations, and use run_jsfl only as a last resort when they cannot accomplish the task.",
            inputSchema: RUN_JSFL_INPUT,
            annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        },
        handleRunJsfl,
    );
}
