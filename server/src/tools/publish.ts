import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

export type Diagnostic = {
    location: string;
    line?: number;
    column?: number;
    code?: string;
    message: string;
};

const PUBLISH_INPUT = {
    document: z.string().optional().describe("Open document name; defaults to the only open document"),
};

/** Parses compiler errors and warnings saved by Animate.
 * @param output Text written by fl.compilerErrors.save
 * @returns Deduplicated diagnostics, or throws when the compiler output is incomplete
 */
export function parseCompilerOutput(output: string): { errors: Diagnostic[]; warnings: Diagnostic[] } {
    const lines = output.split(/\r?\n/);
    const lastLine =
        lines
            .slice()
            .reverse()
            .find((line) => line.trim().length > 0)
            ?.trim() ?? "";
    if (!/^\d+\D+,\s*\d+\D+$/.test(lastLine)) {
        throw new Error("Compiler output unavailable; retry publish");
    }

    const errors: Diagnostic[] = [];
    const warnings: Diagnostic[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        let severity: "error" | "warning" | null = null;
        if (line.startsWith("**Error**")) {
            severity = "error";
        } else if (line.startsWith("**Warning**")) {
            severity = "warning";
        }
        if (!severity) {
            continue;
        }
        const match = /^\*\*(?:Error|Warning)\*\*\s*(.*?)\t([^:]+):\s*(.*)$/.exec(line);
        if (!match?.[1]?.trim() || !match[2].trim()) {
            throw new Error("Compiler output unavailable; retry publish");
        }
        const location = match[1];
        const lineNumber = /(?:\bLine|行)\s+(\d+)/i.exec(location)?.[1];
        const columnNumber = /(?:\bColumn|列)\s+(\d+)/i.exec(location)?.[1];
        const diagnostic: Diagnostic = {
            location,
            ...(lineNumber ? { line: Number(lineNumber) } : {}),
            ...(columnNumber ? { column: Number(columnNumber) } : {}),
            code: match[2].trim(),
            message: match[3],
        };
        const key = `${severity}:${JSON.stringify(diagnostic)}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        (severity === "error" ? errors : warnings).push(diagnostic);
    }
    return { errors, warnings };
}

/** Registers the publish tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerPublish(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Publishes an AS3 document and returns its compiler diagnostics.
     * @param document Optional document name to select
     * @returns Tool result containing the Build result, or an MCP error result
     */
    const handlePublish: ToolCallback<typeof PUBLISH_INPUT> = async ({ document }) => {
        try {
            const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n`;
            const activate = `${prelude}${bundle("select-document")}\n(function () {\n  var document = selectDocument();\n  if (document.type === "htmlcanvas") throw new Error("HTML5 Canvas is not supported yet");\n  if (!document.pathURI) throw new Error("Document is not saved; save first");\n  fl.setActiveWindow(document);\n  return true;\n})()`;
            await runner.execute(activate);

            const outputPath = join(tmpdir(), `animate-mcp-publish-${randomUUID()}.txt`);
            const publish = `${prelude}var __publishOutputPath = ${JSON.stringify(outputPath)};\n${bundle("select-document", "publish")}`;
            const output = String(await runner.execute(publish));
            const { errors, warnings } = parseCompilerOutput(output);
            const result = { ok: errors.length === 0, errors, warnings };
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "publish",
        {
            description:
                "Publish an AS3 document and return its Build result. Publish overwrites outputs at the document's publish settings; the .fla is not saved, and unsaved edits in the open document are published. Compile errors are returned as a normal result, not a tool error.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: PUBLISH_INPUT,
        },
        handlePublish,
    );
}
