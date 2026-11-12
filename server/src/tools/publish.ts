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

export type BuildResult = {
    ok: boolean;
    errors: Diagnostic[];
    warnings: Diagnostic[];
    note?: string;
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
        const prefix = severity === "error" ? "**Error**" : "**Warning**";
        const match = /^\*\*(?:Error|Warning)\*\*\s*(.*?)\t([^:]+):\s*(.*)$/.exec(line);
        const parsed = match?.[1]?.trim() && match[2].trim();
        const location = parsed ? match[1] : "";
        const lineNumber = /(?:\bLine|行)\s+(\d+)/i.exec(location)?.[1];
        const columnNumber = /(?:\bColumn|列)\s+(\d+)/i.exec(location)?.[1];
        const diagnostic: Diagnostic = {
            location,
            ...(lineNumber ? { line: Number(lineNumber) } : {}),
            ...(columnNumber ? { column: Number(columnNumber) } : {}),
            code: parsed ? match[2].trim() : "",
            message: parsed ? match[3] : line.slice(prefix.length).trim(),
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
    /** Publishes an AS3 or HTML5 Canvas document and returns its Build result.
     * @param document Optional document name to select
     * @returns Tool result containing the Build result, or an MCP error result
     */
    const handlePublish: ToolCallback<typeof PUBLISH_INPUT> = async ({ document }) => {
        try {
            const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n`;
            const activate = `${prelude}${bundle("select-document")}\n(function () {\n  var document = selectDocument();\n  if (!document.pathURI) throw new Error("Document is not saved; save first");\n  fl.setActiveWindow(document);\n  return document.type;\n})()`;
            const documentType = await runner.execute(activate);

            const outputPath = join(tmpdir(), `animate-mcp-publish-${randomUUID()}.txt`);
            const publish = `${prelude}var __publishOutputPath = ${JSON.stringify(outputPath)};\n${bundle("select-document", "publish")}`;
            const firstOutput = String(await runner.execute(publish));
            let result: BuildResult;
            if (documentType === "htmlcanvas") {
                result = {
                    ok: true,
                    errors: [],
                    warnings: [],
                    note: "HTML5 Canvas: compile errors cannot be detected; ok only means Publish ran",
                };
            } else {
                const output = firstOutput || String(await runner.execute(publish));
                if (!output) {
                    result = {
                        ok: true,
                        errors: [],
                        warnings: [],
                        note: "compiler output unavailable; no errors reported",
                    };
                } else {
                    const { errors, warnings } = parseCompilerOutput(output);
                    result = { ok: errors.length === 0, errors, warnings };
                }
            }
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
                "Publish an AS3 or HTML5 Canvas document and return its Build result. Publish overwrites outputs at the document's publish settings; the .fla is not saved, and unsaved edits in the open document are published. AS3 compile errors are returned as a normal result, not a tool error; empty compiler output is retried once, then reported as unavailable with no errors reported. HTML5 Canvas compile errors cannot be detected; ok only means Publish ran.",
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
