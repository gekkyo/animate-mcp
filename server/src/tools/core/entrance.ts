import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJsflTool } from "./run-jsfl.js";
import {
    failure,
    invokeToolDefinition,
    TOOL_DESCRIPTION_PREVIEW_LENGTH,
    type ToolDefinition,
    type ToolDeps,
} from "./shared.js";

const SEARCH_INPUT = { query: z.string().min(1) };
const EXECUTE_INPUT = {
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
};
const MAX_SEARCH_RESULTS = 5; // Keeps fuzzy suggestions within the initial metadata byte budget.
const DIRECT_ONLY = `${runJsflTool.name} must be called directly, not through an execute entrance.`;

/**
 * Registers the search and dispatch Entrances for existing tool definitions.
 * @param server MCP server to register against
 * @param tools Available indirect tools
 * @param deps Runtime dependencies passed to the target tools
 * @returns Nothing.
 */
export function registerEntrances(server: McpServer, tools: readonly ToolDefinition[], deps: ToolDeps): void {
    /** Looks up a tool by its exact name.
     * @param name Tool name
     * @returns Matching tool definition, if present
     */
    const find = (name: string) => tools.find((tool) => tool.name === name);
    /** Builds the Zod validator for a tool's declared input.
     * @param tool Tool definition
     * @returns Input validator
     */
    const schemaFor = (tool: ToolDefinition) =>
        tool.inputSchema instanceof z.ZodType ? tool.inputSchema : z.object(tool.inputSchema ?? {});
    /** Finds the most relevant tools for a free-text search.
     * @param query Search text
     * @returns Up to five compact tool matches
     */
    const matches = (query: string) => {
        const terms = query
            .toLowerCase()
            .trim()
            .split(/[\s_]+/)
            .filter(Boolean);
        const searchable = tools.map((tool) => ({
            tool,
            name: tool.name.toLowerCase(),
            text: `${tool.name} ${tool.description}`.toLowerCase(),
        }));
        const allTerms = searchable.filter(({ text }) => terms.every((term) => text.includes(term)));
        const candidates =
            allTerms.length > 0 ? allTerms : searchable.filter(({ text }) => terms.some((term) => text.includes(term)));
        return candidates
            .sort(
                (a, b) =>
                    Number(!terms.some((term) => a.name.includes(term))) -
                    Number(!terms.some((term) => b.name.includes(term))),
            )
            .slice(0, MAX_SEARCH_RESULTS)
            .map(({ tool }) => ({
                name: tool.name,
                description: tool.description.slice(0, TOOL_DESCRIPTION_PREVIEW_LENGTH),
            }));
    };

    server.registerTool(
        "search_tools",
        {
            description: "Find Animate tools by exact name or free-text query.",
            inputSchema: SEARCH_INPUT,
            annotations: { readOnlyHint: true },
        },
        ({ query }) => {
            const tool = find(query);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            tool
                                ? {
                                      name: tool.name,
                                      description: tool.description,
                                      guidance: tool.guidance,
                                      annotations: tool.annotations,
                                      inputSchema: z.toJSONSchema(schemaFor(tool)),
                                  }
                                : matches(query),
                        ),
                    },
                ],
            };
        },
    );

    /** Registers one execute Entrance.
     * @param name Entrance tool name
     * @param readOnly Whether this Entrance accepts only read-only tools
     * @returns Nothing.
     */
    const registerExecute = (name: "execute_readonly" | "execute_write", readOnly: boolean) => {
        server.registerTool(
            name,
            {
                description: readOnly
                    ? "Run a tool whose readOnlyHint is true."
                    : "Run any tool whose readOnlyHint is not true; may modify documents or files.",
                inputSchema: EXECUTE_INPUT,
                annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly },
            },
            async ({ name: targetName, arguments: args }, extra) => {
                if (targetName === runJsflTool.name) {
                    // The registry omits run_jsfl from the catalog; retain this defense in depth.
                    return failure(DIRECT_ONLY);
                }
                const tool = find(targetName);
                if (!tool) {
                    return failure(`Unknown tool: ${targetName}. Suggestions: ${JSON.stringify(matches(targetName))}`);
                }
                if ((tool.annotations?.readOnlyHint === true) !== readOnly) {
                    return failure(
                        `${targetName} must use ${readOnly ? "execute_write" : "execute_readonly"}. Nothing ran.`,
                    );
                }
                const schema = schemaFor(tool);
                const parsed = schema.safeParse(args ?? {});
                if (!parsed.success) {
                    return failure(
                        `Invalid input for ${targetName}: ${parsed.error.message}\nInput schema: ${JSON.stringify(z.toJSONSchema(schema))}\nWarnings: ${tool.description}\n${tool.guidance.basic ?? ""}\n${tool.guidance.notes ?? ""}`,
                    );
                }
                return invokeToolDefinition(tool, parsed.data, deps, extra);
            },
        );
    };
    registerExecute("execute_readonly", true);
    registerExecute("execute_write", false);
}
