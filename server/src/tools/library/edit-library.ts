import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";

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
    z.object({ op: z.literal("findUsages"), item: LIBRARY_PATH }).strict(),
    z
        .object({
            op: z.literal("createSymbol"),
            type: z.enum(["movie clip", "button", "graphic"]),
            name: z
                .string()
                .min(1)
                .regex(/^[^/]+$/),
        })
        .strict(),
    z
        .object({
            op: z.literal("duplicateItem"),
            item: LIBRARY_PATH,
            newName: z
                .string()
                .min(1)
                .regex(/^[^/]+$/),
        })
        .strict(),
    z.object({ op: z.literal("getLinkage"), item: LIBRARY_PATH }).strict(),
    z
        .object({
            op: z.literal("setLinkage"),
            item: LIBRARY_PATH,
            exportForAS: z.boolean().optional(),
            className: z.string().min(1).optional(),
            baseClass: z.string().optional(),
            exportInFirstFrame: z.boolean().optional(),
        })
        .strict()
        .refine(
            ({ exportForAS, className, baseClass, exportInFirstFrame }) =>
                exportForAS !== undefined ||
                className !== undefined ||
                baseClass !== undefined ||
                exportInFirstFrame !== undefined,
            { message: "setLinkage requires at least one linkage setting" },
        ),
]);
const EDIT_LIBRARY_INPUT = {
    ops: z.array(EDIT_LIBRARY_OP).min(1),
    document: z.string().optional(),
};

export const editLibraryTool: ToolDefinition<typeof EDIT_LIBRARY_INPUT> = {
    name: "edit_library",
    description:
        "Create folders and symbols, move, rename, duplicate, or delete library items, find direct timeline usages, list unused items, and inspect or update AS3 linkage with getLinkage/setLinkage (Flash/AS3 documents only). Operations stop at the first failure; collisions are refused. Moving, renaming, or duplicating items does not update code-string references. deleteItem requires confirm: true and refuses items in use. If setLinkage changes a movie clip, graphic, or button's AS3 export or class name, run export_scripts again to refresh linked-class metadata in the export workspace. After reorganizing the library, run export_scripts again before apply_scripts. Changes apply to the open document but do not save the .fla; use save_document after confirming an overwrite, or save in Animate.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: EDIT_LIBRARY_INPUT,
    guidance: {
        basic: "- Use edit_library to organize library folders and items. Re-export with export_scripts before apply_scripts; deleteItem requires confirm: true and refuses items in use.\n- edit_library can also create/duplicate symbols and find direct usages; edit_elements can swap a symbol and set graphic loop/firstFrame.",
    },
    /**
     * Applies library operations in order and stops at the first failure.
     * @param ops Library operations to apply.
     * @param document Optional document selector.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Operation results, failures, skipped operations, and warnings.
     */
    run: async ({ ops, document }: Parameters<ToolCallback<typeof EDIT_LIBRARY_INPUT>>[0], deps: ToolDeps) => {
        const { runner, bundle } = deps;

        const code = jsflRun("library-index", { __docName: document ?? "", __ops: ops }, bundle);
        const result = JSON.parse(String(await runner.execute(code))) as {
            applied: typeof ops;
            results: { op: (typeof ops)[number]; result: unknown }[];
            failed: { op: (typeof ops)[number]; error: string } | null;
            skipped: typeof ops;
            warnings: string[];
        };
        return {
            data: result,
            text: `If library structure changed, run export_scripts again before apply_scripts.\n${JSON.stringify(result)}`,
        };
    },
};

/**
 * Registers the edit_library tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerEditLibrary(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, editLibraryTool, deps);
}
