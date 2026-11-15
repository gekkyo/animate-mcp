import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

export const auditDocumentTool: ToolDefinition = {
    name: "audit_document",
    description:
        "Read-only hygiene suggestions for unused Library items, empty keyframes, and default-looking English/Japanese layer or symbol names. These are review heuristics, not proof that content should be deleted; linkage-bearing items are explicitly protected from that conclusion.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        basic: "- Use audit_document for read-only document hygiene suggestions. Review every finding before changing content; unused Library items may be intentional, especially when linkage is enabled.",
    },
    /**
     * Collects read-only document hygiene findings.
     * @param _args No input arguments.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Findings grouped by category with any warnings.
     */
    run: async (_args: never, deps: ToolDeps) => {
        const { runner, bundle } = deps;
        const result = JSON.parse(
            String(await runner.execute(jsflRun("audit-document", { __docName: "" }, bundle))),
        ) as {
            document: string;
            findings: {
                category: "unusedLibraryItem" | "emptyKeyframe" | "defaultName";
                severity: "info" | "warning";
                location: string;
                message: string;
                item?: string;
                linkage?: boolean;
            }[];
            warnings: string[];
        };
        return {
            data: {
                ...result,
                findings: {
                    unusedLibraryItems: result.findings.filter((finding) => finding.category === "unusedLibraryItem"),
                    emptyKeyframes: result.findings.filter((finding) => finding.category === "emptyKeyframe"),
                    defaultNames: result.findings.filter((finding) => finding.category === "defaultName"),
                },
            },
        };
    },
};

/**
 * Registers the audit_document tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerAuditDocument(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, auditDocumentTool, deps);
}
