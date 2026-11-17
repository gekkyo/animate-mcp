import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "./shared.js";

const RUN_JSFL_INPUT = {
    code: z
        .string()
        .describe(
            "Arbitrary JSFL source to execute in Adobe Animate; use only when dedicated tools cannot accomplish the task.",
        ),
};

export const runJsflTool: ToolDefinition<typeof RUN_JSFL_INPUT, Pick<ToolDeps, "runner">> = {
    name: "run_jsfl",
    description:
        "Execute arbitrary code as JSFL inside Adobe Animate; it may modify documents or files. Prefer dedicated tools for document, timeline, tween, library, and script operations, and use run_jsfl only as a last resort when they cannot accomplish the task.",
    inputSchema: RUN_JSFL_INPUT,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    guidance: {
        notes: "- When a script fails with a null error, first check the layer's frame length and instance names with run_jsfl.\n- If you add debug traces, always remove them after checking and Apply again.\n- run_jsfl runs arbitrary code. Ask the user before any operation that modifies the document.",
    },
    /** Executes arbitrary JSFL and returns Animate's result.
     * @param args Validated JSFL input
     * @param deps Tool runtime dependencies
     * @returns Structured result and its text representation
     */
    run: async ({ code }: Parameters<ToolCallback<typeof RUN_JSFL_INPUT>>[0], deps: Pick<ToolDeps, "runner">) => {
        const { runner } = deps;

        const result = await runner.execute(code);
        return { data: { result }, text: JSON.stringify(result) ?? "null" };
    },
};

/** Registers the run_jsfl tool without requiring the validated JSFL seam.
 * @param server MCP server to register against
 * @param deps Runner dependency
 * @returns Nothing.
 */
export function registerRunJsfl(server: McpServer, deps: Pick<ToolDeps, "runner">): void {
    registerToolDefinition(server, runJsflTool, deps);
}
