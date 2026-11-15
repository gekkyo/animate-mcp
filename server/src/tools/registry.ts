import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "./shared.js";

const INSTRUCTIONS_HEADER = `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; use save_document after asking the user before overwriting, or save in Animate.`;

/** Creates the MCP instruction text and tool registration function.
 * @param tools Tool definitions to expose
 * @returns Instructions and a function that registers the tools
 */
export function createToolRegistry(tools: readonly ToolDefinition[]) {
    return {
        instructions: `${INSTRUCTIONS_HEADER}\n${tools
            .map((tool) => tool.guidance.basic)
            .filter((line): line is string => line !== undefined)
            .join("\n")}\n\nNotes:\n${tools
            .map((tool) => tool.guidance.notes)
            .filter((line): line is string => line !== undefined)
            .join("\n")}`,
        /** Registers each configured tool with its shared dependencies.
         * @param server MCP server to register against
         * @param deps Runtime dependencies passed to each tool
         * @returns Nothing.
         */
        register(server: McpServer, deps: ToolDeps) {
            for (const tool of tools) {
                registerToolDefinition(server, tool, deps);
            }
        },
    };
}
