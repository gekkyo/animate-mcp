import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    GREEN_SOCK_LICENSE_URL,
    GREEN_SOCK_VERSION,
    installGreensock,
    isGreensockInstalled,
} from "../greensock/greensock.js";
import type { createRunner } from "../runner.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;
const INSTALL_GREENSOCK_INPUT = { confirm: z.boolean().optional(), document: z.string().optional() };

/** Registers the install_greensock tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerInstallGreensock(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Installs GreenSock-AS3 beside the selected saved ActionScript 3 document.
     * @param confirm Whether the user confirmed the licensed download
     * @param document Optional document name to select
     * @returns Tool result with installation status or an MCP error
     */
    const handleInstallGreensock: ToolCallback<typeof INSTALL_GREENSOCK_INPUT> = async ({ confirm, document }) => {
        try {
            const code = `var __docName = ${JSON.stringify(document ?? "")};\n${bundle("select-document", "export-common", "document-runtime-info")}\nserialize(documentRuntimeInfo(selectDocument()))`;
            const info = JSON.parse(String(await runner.execute(code))) as {
                folder: string | null;
                kind: "as3" | "as2" | "canvas" | "other";
                name: string;
            };
            if (!info.folder) {
                throw new Error("Save the document first");
            }
            const destination = join(info.folder, "com", "greensock");
            if (info.kind === "canvas") {
                throw new Error("For HTML5 Canvas, use createjs.Tween instead; GSAP is not supported for Canvas.");
            }
            if (info.kind === "as2") {
                throw new Error("GreenSock-AS3 can only be installed in AS3 documents; this is an AS2 document.");
            }
            if (info.kind !== "as3") {
                throw new Error("GreenSock-AS3 can only be installed in ActionScript 3 documents.");
            }
            if (confirm !== true) {
                throw new Error(
                    `GreenSock will be installed to ${destination}. Review the GreenSock Standard License at ${GREEN_SOCK_LICENSE_URL}, then pass confirm: true to continue.`,
                );
            }
            if (isGreensockInstalled(info.folder)) {
                return {
                    content: [
                        { type: "text", text: `GreenSock already installed: ${join(destination, "TweenLite.as")}` },
                    ],
                    structuredContent: { installed: true, path: join(destination, "TweenLite.as") },
                };
            }
            if (existsSync(destination)) {
                throw new Error("Folder com/greensock exists but is incomplete; remove it and retry");
            }

            await installGreensock(info.folder);
            return {
                content: [
                    {
                        type: "text",
                        text: `Installed GreenSock-AS3 ${GREEN_SOCK_VERSION} at ${destination}. GreenSock Standard License, ${GREEN_SOCK_LICENSE_URL} — fetched from GitHub on your request, not bundled. The .fla was not modified or saved; the AS3 default classpath (the FLA folder) picks it up.`,
                    },
                ],
                structuredContent: { installed: true, path: destination, version: GREEN_SOCK_VERSION },
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "install_greensock",
        {
            description:
                "Download GreenSock-AS3 12.1.5 into com/greensock beside a saved AS3 document. Requires confirm: true after reviewing https://gsap.com/standard-license/; does not modify or save the .fla. Not supported for AS2 or HTML5 Canvas.",
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
            inputSchema: INSTALL_GREENSOCK_INPUT,
        },
        handleInstallGreensock,
    );
}
