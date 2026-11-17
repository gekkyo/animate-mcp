import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";
import { bundle, jsflRun } from "../../runtime/jsfl-bundle.js";
import type { createRunner } from "../../runtime/runner.js";

export type ToolDeps = {
    runner: Pick<ReturnType<typeof createRunner>, "execute">;
    jsfl: JsflRunner;
};

export type JsflRunner = {
    run: <T>(entry: string, vars: Record<string, unknown>, schema: ZodType<T>, opts?: number) => Promise<T>;
};

/** Validates decoded JSFL output and names the entry in failures.
 * @param entry JSFL entry path
 * @param result Decoded JSON result
 * @param schema Result schema
 * @returns Validated result
 */
export function validateJsflResult<T>(entry: string, result: unknown, schema: ZodType<T>): T {
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
        throw new Error(`JSFL entry "${entry}" returned invalid data: ${parsed.error.message}`);
    }
    return parsed.data;
}

/** Creates the validated JSFL call seam used by tools.
 * @param runner Runner that executes generated JSFL
 * @returns JSFL call seam
 */
export function createJsflRunner(runner: ToolDeps["runner"]): JsflRunner {
    return {
        async run<T>(entry: string, vars: Record<string, unknown>, schema: ZodType<T>, opts?: number): Promise<T> {
            const code = jsflRun(entry, vars, bundle);
            const result = await runner.execute(code, opts);
            let decoded: unknown;
            try {
                decoded = JSON.parse(String(result));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`JSFL entry "${entry}" returned invalid JSON: ${message}`);
            }
            return validateJsflResult(entry, decoded, schema);
        },
    };
}

export type ToolExtra = Parameters<ToolCallback>[0];

export type ToolRunResult = {
    data: Record<string, unknown>;
    text?: string;
    content?: CallToolResult["content"];
};

export type ToolDefinition<S = unknown, D extends Pick<ToolDeps, "runner"> = ToolDeps> = {
    name: string;
    description: string;
    annotations?: ToolAnnotations;
    inputSchema?: S;
    guidance: { basic?: string; notes?: string };
    run: (args: never, deps: D, extra: ToolExtra) => Promise<ToolRunResult>;
};

// Keep catalog previews small enough for the initial tools/list + instructions byte budget.
export const TOOL_DESCRIPTION_PREVIEW_LENGTH = 60;

/**
 * Converts a tool exception into an MCP error result.
 * @param error The caught value
 * @returns A text result with isError set
 */
export const failure = (error: unknown) => ({
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
});

/** Invokes a validated tool definition and converts its result or error to MCP's response envelope.
 * @param tool Tool definition to invoke
 * @param args Validated tool arguments
 * @param deps Runtime dependencies passed to the tool
 * @param extra MCP callback metadata and notification helpers
 * @returns MCP response envelope
 */
export async function invokeToolDefinition<S, D extends Pick<ToolDeps, "runner">>(
    tool: ToolDefinition<S, D>,
    args: unknown,
    deps: D,
    extra: ToolExtra,
) {
    try {
        // Runtime schema validation precedes this bridge; ToolDefinition erases each concrete input type.
        // eslint-disable-next-line no-restricted-syntax -- Dispatch bridge after runtime validation.
        const { data, text, content } = await tool.run(args as never, deps, extra);
        return {
            content: content ?? [{ type: "text" as const, text: text ?? JSON.stringify(data) ?? "null" }],
            structuredContent: data,
        };
    } catch (error) {
        return failure(error);
    }
}

/** Registers a tool definition and converts its result to the MCP response envelope.
 * @param server MCP server to register against
 * @param tool Tool definition to register
 * @param deps Runtime dependencies passed to the tool
 * @returns Nothing.
 */
export function registerToolDefinition<S, D extends Pick<ToolDeps, "runner">>(
    server: McpServer,
    tool: ToolDefinition<S, D>,
    deps: D,
): void {
    /**
     * Creates the schema-appropriate callback that invokes this registered tool.
     * @param args Tool arguments, when the tool has an input schema
     * @param extra MCP callback metadata and notification helpers
     * @returns The tool invocation result
     */
    const handler =
        tool.inputSchema === undefined
            ? (extra: ToolExtra) => invokeToolDefinition(tool, {}, deps, extra)
            : (args: unknown, extra: ToolExtra) => invokeToolDefinition(tool, args, deps, extra);

    server.registerTool(
        tool.name,
        // eslint-disable-next-line no-restricted-syntax -- The SDK requires schema-specific generics that ToolDefinition erases.
        {
            description: tool.description,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
            ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        } as never,
        // eslint-disable-next-line no-restricted-syntax -- The SDK callback type must remain paired with the runtime schema.
        handler as never,
    );
}

/** Timelines handled per Run (to avoid timeouts) */
export const TIMELINES_PER_RUN = 10;
