import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

export type Diagnostic = {
    location: string;
    line?: number;
    column?: number;
    code?: string;
    message: string;
};

export type BuildResult = {
    ok: boolean;
    compilerOutput: "verified" | "unavailable" | "not_checked";
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
    // Animate appends localized error and warning totals; require that footer before trusting the listing.
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
        // Parse both English and Japanese compiler labels while preserving the source location and message.
        const match = /^\*\*(?:Error|Warning)\*\*\s*(.*?)\t(?:(?:Warning|警告):\s*)?([^:]+):\s*(.*)$/.exec(line);
        const parsed = match?.[1].trim() && match[2].trim() ? match : null;
        const location = parsed ? parsed[1] : "";
        const lineNumber = /(?:\bLine|行)\s+(\d+)/i.exec(location)?.[1];
        const columnNumber = /(?:\bColumn|列)\s+(\d+)/i.exec(location)?.[1];
        const diagnostic: Diagnostic = {
            location,
            ...(lineNumber ? { line: Number(lineNumber) } : {}),
            ...(columnNumber ? { column: Number(columnNumber) } : {}),
            code: parsed ? parsed[2].trim() : "",
            message: parsed ? parsed[3] : line.slice(prefix.length).trim(),
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

/**
 * Publishes a document and parses compiler output when Animate provides it.
 * @param document Optional document selector.
 * @param deps Tool dependencies for executing Animate commands.
 * @returns Publish status, compiler diagnostics, and any availability note.
 */
export async function runPublish(document: string | undefined, deps: ToolDeps): Promise<BuildResult> {
    const documentType = await deps.jsfl.run(
        "output/activate-publish",
        { __docName: document ?? "" },
        z.enum(["Flash", "htmlcanvas"]),
    );

    const outputPath = join(tmpdir(), `animate-mcp-publish-${randomUUID()}.txt`);
    const publishResult = z.union([z.string(), z.literal(true)]);
    const firstOutput = await deps.jsfl.run(
        "output/publish",
        { __docName: document ?? "", __publishOutputPath: outputPath },
        publishResult,
    );
    if (documentType === "htmlcanvas") {
        return {
            ok: true,
            compilerOutput: "not_checked",
            errors: [],
            warnings: [],
            note: "HTML5 Canvas: compile errors are unverified; ok only means Publish ran",
        };
    }
    const output =
        String(firstOutput) ||
        String(
            await deps.jsfl.run(
                "output/publish",
                { __docName: document ?? "", __publishOutputPath: outputPath },
                publishResult,
            ),
        );
    if (!output) {
        return {
            ok: true,
            compilerOutput: "unavailable",
            errors: [],
            warnings: [],
            note: "compiler output unavailable; no errors reported",
        };
    }
    const { errors, warnings } = parseCompilerOutput(output);
    return { ok: errors.length === 0, compilerOutput: "verified", errors, warnings };
}

export const publishTool: ToolDefinition<typeof PUBLISH_INPUT> = {
    name: "publish",
    description:
        'Publish an AS3 or HTML5 Canvas document and return its Build result. Publish overwrites outputs at the document\'s publish settings; the .fla is not saved, and unsaved edits in the open document are published. AS3 compilerOutput is "verified" when compiler output is parsed, or "unavailable" after empty output and one retry; unavailable reports no errors, not that the build is clean. AS3 compile errors are returned as a normal result, not a tool error. HTML5 Canvas compilerOutput is "not_checked"; compile errors are unverified and ok only means Publish ran.',
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
    },
    inputSchema: PUBLISH_INPUT,
    guidance: {
        basic: "- Use publish to publish AS3 or HTML5 Canvas documents and check the Build result; outputs at the document's publish settings are overwritten. Canvas compile errors cannot be detected.",
    },
    /**
     * Publishes the selected document and returns its build result.
     * @param document Optional document selector.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns The publish build result.
     */
    run: async ({ document }: Parameters<ToolCallback<typeof PUBLISH_INPUT>>[0], deps: ToolDeps) => ({
        data: await runPublish(document, deps),
    }),
};

/**
 * Registers the publish tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerPublish(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, publishTool, deps);
}
