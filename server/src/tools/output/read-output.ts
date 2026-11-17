import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";
import { PANEL_RESULT } from "./lib/panel-result.js";
import { type Diagnostic, parseCompilerOutput } from "./publish.js";

export const readOutputTool: ToolDefinition = {
    name: "read_output",
    description:
        "Read the current Output and Compiler Errors panels without running Publish or Test Movie or changing a document. Panel contents may be stale or mixed because Animate does not identify their source document or run. Raw panel text is returned when Animate's API provides it; compilerDiagnostics.status is unavailable when the compiler panel is empty, incomplete, or unsupported, and this does not mean a clean compile.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    guidance: {
        notes: "- Use read_output to inspect the current Output and Compiler Errors panels; their contents may be stale or mixed because Animate does not identify their source document or run.",
    },
    /**
     * Reads and parses the current Output and Compiler Errors panels.
     * @param _args No input arguments.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Raw panel contents and parsed compiler diagnostics when available.
     */
    run: async (_args: never, deps: ToolDeps) => {
        const id = randomUUID();
        const outputPath = join(tmpdir(), `animate-mcp-read-output-${id}-output.txt`);
        const compilerPath = join(tmpdir(), `animate-mcp-read-output-${id}-compiler-errors.txt`);
        const { compilerPanelAvailable, outputPanel, compilerErrorsPanel } = await deps.jsfl.run(
            "output/read-output-json",
            {
                __readOutputPath: outputPath,
                __readCompilerPath: compilerPath,
            },
            PANEL_RESULT,
        );

        let compilerDiagnostics: {
            status: "parsed" | "unavailable";
            errors: Diagnostic[];
            warnings: Diagnostic[];
        };
        try {
            if (!compilerPanelAvailable) {
                throw new Error("Compiler Errors panel unavailable");
            }
            compilerDiagnostics = { status: "parsed", ...parseCompilerOutput(compilerErrorsPanel) };
        } catch {
            compilerDiagnostics = { status: "unavailable", errors: [], warnings: [] };
        }
        const response = {
            outputPanel,
            compilerErrorsPanel,
            compilerDiagnostics,
            note: "Panel contents may be stale or mixed; Animate does not identify their source document or run. An unavailable compilerDiagnostics status does not mean a clean compile.",
        };
        return { data: response };
    },
};

/**
 * Registers the read_output tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerReadOutput(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, readOutputTool, deps);
}
