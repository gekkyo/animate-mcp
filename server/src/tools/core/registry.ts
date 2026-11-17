import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEntrances } from "./entrance.js";
import { registerRunJsfl, runJsflTool } from "./run-jsfl.js";
import {
    registerToolDefinition,
    TOOL_DESCRIPTION_PREVIEW_LENGTH,
    type ToolDefinition,
    type ToolDeps,
} from "./shared.js";

const INSTRUCTIONS_HEADER = `Read and write Adobe Animate timeline scripts as files.

Basic flow:
1. Run export_scripts to export the active document. Read index.md, then each structure.md, then the scripts.
2. Edit the exported .as / .js files (an empty file deletes that frame's script).
3. Run apply_scripts to apply them. The .fla is not saved; use save_document after asking the user before overwriting, or save in Animate.`;

/** Creates the MCP instruction text and tool registration function.
 * @param tools Tool definitions to expose
 * @param options Registry mode options
 * @param options.entrances Whether to register the compact Entrance set
 * @returns Instructions and a function that registers the tools
 */
export function createToolRegistry(tools: readonly ToolDefinition[], options: { entrances?: boolean } = {}) {
    const entrances = options.entrances ?? false;
    const listedTools = entrances ? tools.filter((tool) => tool.name !== runJsflTool.name) : tools;
    return {
        instructions: entrances
            ? `${INSTRUCTIONS_HEADER}\n\nUse search_tools to find tool details, then execute_readonly or execute_write with the tool name and arguments. ${runJsflTool.name} remains a direct tool.\n${listedTools.map((tool) => `${tool.name}: ${tool.description.slice(0, TOOL_DESCRIPTION_PREVIEW_LENGTH)}`).join("\n")}\n\n${runJsflTool.guidance.notes}`
            : `${INSTRUCTIONS_HEADER}\n${tools
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
            if (entrances) {
                registerEntrances(server, listedTools, deps);
                registerRunJsfl(server, deps);
                return;
            }
            for (const tool of tools) {
                registerToolDefinition(server, tool, deps);
            }
        },
    };
}
