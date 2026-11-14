import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";
import { type Diagnostic, parseCompilerOutput } from "./publish.js";

export const readOutputTool: ToolDefinition = {
    name: "read_output",
    description:
        "Read the current Output and Compiler Errors panels without running Publish or Test Movie or changing a document. Panel contents may be stale or mixed because Animate does not identify their source document or run. Raw panel text is returned when Animate's API provides it; compilerDiagnostics.status is unavailable when the compiler panel is empty, incomplete, or unsupported, and this does not mean a clean compile.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    guidance: {
        notes: "- Use read_output to inspect the current Output and Compiler Errors panels; their contents may be stale or mixed because Animate does not identify their source document or run.",
    },
    run: async (_args: never, deps: ToolDeps) => {
        const { runner, bundle } = deps;

        const id = randomUUID();
        const outputPath = join(tmpdir(), `animate-mcp-read-output-${id}-output.txt`);
        const compilerPath = join(tmpdir(), `animate-mcp-read-output-${id}-compiler-errors.txt`);
        const prelude = `var __readOutputPath = ${JSON.stringify(outputPath)};\nvar __readCompilerPath = ${JSON.stringify(compilerPath)};\n`;
        const result = String(await runner.execute(`${prelude}${bundle("read-output")}`));
        let offset = 0;
        const compilerPanelAvailable = result.charAt(offset++) === "1";
        const readField = () => {
            const separator = result.indexOf(":", offset);
            if (separator < 0 || !/^\d+$/.test(result.slice(offset, separator))) {
                throw new Error("Animate returned an invalid read_output result");
            }
            const length = Number(result.slice(offset, separator));
            offset = separator + 1;
            const field = result.slice(offset, offset + length);
            if (field.length !== length) {
                throw new Error("Animate returned an invalid read_output result");
            }
            offset += length;
            return field;
        };
        const outputPanel = readField();
        const compilerErrorsPanel = readField();
        if (offset !== result.length) {
            throw new Error("Animate returned an invalid read_output result");
        }

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

export function registerReadOutput(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, readOutputTool, deps);
}
