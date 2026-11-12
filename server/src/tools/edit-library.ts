import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const LIBRARY_PATH = z.string().regex(/^[^/]+(?:\/[^/]+)*$/);
const EDIT_LIBRARY_OP = z.discriminatedUnion("op", [
    z.object({ op: z.literal("createFolder"), path: LIBRARY_PATH }),
    z.object({ op: z.literal("moveItem"), item: LIBRARY_PATH, toFolder: z.union([z.literal(""), LIBRARY_PATH]) }),
    z.object({
        op: z.literal("renameItem"),
        item: LIBRARY_PATH,
        newName: z
            .string()
            .min(1)
            .regex(/^[^/]+$/),
    }),
    z.object({ op: z.literal("deleteItem"), item: LIBRARY_PATH, confirm: z.literal(true) }),
    z.object({ op: z.literal("listUnused") }),
]);
const EDIT_LIBRARY_INPUT = {
    ops: z.array(EDIT_LIBRARY_OP).min(1),
    document: z.string().optional(),
};

/** Registers the edit_library tool.
 * @param server MCP server to register the tool with.
 * @param deps Runner and JSFL bundle dependencies.
 * @returns Nothing.
 */
export function registerEditLibrary(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Applies ordered library operations to the selected document.
     * @param ops Library operations to apply.
     * @param document Optional document name to select.
     * @returns Tool result with per-operation results, failure, skipped operations, and warnings.
     */
    const handleEditLibrary: ToolCallback<typeof EDIT_LIBRARY_INPUT> = async ({ ops, document }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\nvar __ops = ${JSON.stringify(ops)};\n${bundle("select-document", "edit-state", "export-common", "library-helpers", "library-ops", "library-index")}`;
            const result = JSON.parse(String(await runner.execute(code))) as {
                applied: typeof ops;
                results: { op: (typeof ops)[number]; result: unknown }[];
                failed: { op: (typeof ops)[number]; error: string } | null;
                skipped: typeof ops;
                warnings: string[];
            };
            return {
                content: [
                    {
                        type: "text",
                        text: `If library structure changed, run export_scripts again before apply_scripts.\n${JSON.stringify(result)}`,
                    },
                ],
                structuredContent: result,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "edit_library",
        {
            description:
                "Organize the active Animate document's library with createFolder, moveItem, renameItem, deleteItem, and listUnused. Operations stop at the first failure; collisions are refused and linkage metadata is not changed. deleteItem requires confirm: true and refuses items in use. After reorganizing the library, run export_scripts again before apply_scripts. Changes apply to the open document but do not save the .fla; save it in Animate.",
            annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
            inputSchema: EDIT_LIBRARY_INPUT,
        },
        handleEditLibrary,
    );
}
