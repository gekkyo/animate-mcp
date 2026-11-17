import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const INPUT = {
    document: z.string().optional().describe("Open document name; defaults to the only open document"),
    descriptorPath: z.string().optional().describe("Absolute path to an AIR *-app.xml descriptor"),
};

export type AirDescriptorElement = { name: string; text: string; children: AirDescriptorElement[] };

/**
 * Derives the adjacent AIR descriptor path from a saved FLA path.
 * @param flaPath Saved FLA path.
 * @returns The adjacent *-app.xml descriptor path.
 */
export function airDescriptorPathForFla(flaPath: string): string {
    return join(dirname(flaPath), `${basename(flaPath).replace(/\.fla$/i, "")}-app.xml`);
}

/**
 * unverified: Animate may create a missing AIR descriptor during Publish.
 * @param error The descriptor read error.
 * @param path Expected descriptor path.
 * @returns Missing-descriptor detail for ENOENT, otherwise undefined.
 */
export function missingAirDescriptorDetail(error: unknown, path: string): string | undefined {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `AIR descriptor not found at ${path}. Animate may create it during Publish (unverified).`;
    }
    return undefined;
}

export const AIR_DESCRIPTOR_FIELDS = [
    { name: "id", parent: "root", type: "string", writable: true },
    { name: "versionNumber", parent: "root", type: "string", writable: true },
    { name: "versionLabel", parent: "root", type: "string", writable: true },
    { name: "filename", parent: "root", type: "string", writable: false },
    { name: "renderMode", parent: "initialWindow", type: "string", writable: true },
    { name: "aspectRatio", parent: "initialWindow", type: "string", writable: true },
    { name: "autoOrients", parent: "initialWindow", type: "boolean", writable: true },
    { name: "fullScreen", parent: "initialWindow", type: "boolean", writable: true },
] as const;

/**
 * Parses XML elements into a tree while preserving the text content of each element.
 * @param xml Descriptor XML.
 * @returns The root element, if present.
 */
export function parseAirDescriptorElements(xml: string): AirDescriptorElement | undefined {
    let root: AirDescriptorElement | undefined;
    const stack: AirDescriptorElement[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
        const element: AirDescriptorElement = { name: tag.local ?? tag.name, text: "", children: [] };
        if (stack.length) {
            stack[stack.length - 1].children.push(element);
        } else {
            root = element;
        }
        stack.push(element);
    });
    /**
     * Adds XML text to every open element's content.
     * @param text XML text or CDATA content.
     * @returns Nothing.
     */
    const addText = (text: string) => {
        for (const element of stack) {
            element.text += text;
        }
    };
    parser.on("text", addText);
    parser.on("cdata", addText);
    parser.on("closetag", () => stack.pop());
    parser.write(xml).close();
    return root;
}

/**
 * Parses an AIR descriptor and returns only its documented fields.
 * @param xml Descriptor XML.
 * @returns The application descriptor fields.
 */
export function parseAirDescriptor(xml: string) {
    const root = parseAirDescriptorElements(xml);
    if (root?.name !== "application") {
        throw new Error("AIR descriptor root element must be application.");
    }
    /**
     * Finds a direct child element.
     * @param parent Parent element to search.
     * @param name Child element name.
     * @returns The matching child, if present.
     */
    const child = (parent: AirDescriptorElement | undefined, name: string) =>
        parent?.children.find((element) => element.name === name);
    /**
     * Reads trimmed text from a direct child element.
     * @param parent Parent element to search.
     * @param name Child element name.
     * @returns The child's text, if present.
     */
    const text = (parent: AirDescriptorElement | undefined, name: string) => child(parent, name)?.text.trim();
    const initialWindow = child(root, "initialWindow");
    const result: Record<string, unknown> = {};
    for (const { name, parent, type } of AIR_DESCRIPTOR_FIELDS) {
        const value = text(parent === "root" ? root : initialWindow, name);
        if (value !== undefined) {
            result[name] = type === "boolean" ? value === "true" || value === "1" : value;
        }
    }
    const icon = child(root, "icon");
    result.icon = Object.fromEntries((icon?.children ?? []).map((element) => [element.name, element.text.trim()]));
    result.extensions = (child(root, "extensions")?.children ?? [])
        .filter((element) => element.name === "extensionID")
        .map((element) => element.text.trim());
    const android = child(root, "android");
    const iphone = child(root, "iPhone");
    const manifestAdditions = child(android, "manifestAdditions")?.text;
    const infoAdditions = child(iphone, "InfoAdditions")?.text;
    if (manifestAdditions !== undefined) {
        result.manifestAdditions = manifestAdditions;
    }
    if (infoAdditions !== undefined) {
        result.InfoAdditions = infoAdditions;
    }
    return result;
}

/**
 * Resolves an AIR descriptor path from explicit input or the selected Animate document.
 * @param args Target arguments.
 * @param args.document Optional open document name.
 * @param args.descriptorPath Optional absolute descriptor path.
 * @param deps Tool dependencies for executing Animate commands.
 * @returns The descriptor path and optional player target.
 */
export async function resolveAirDescriptor(
    args: { document?: string; descriptorPath?: string },
    deps: ToolDeps,
): Promise<{ path: string; playerTarget?: string }> {
    if (args.document !== undefined && args.descriptorPath !== undefined) {
        throw new Error("Specify either document or descriptorPath, not both.");
    }
    if (args.descriptorPath !== undefined) {
        if (!args.descriptorPath.endsWith("-app.xml") || !isAbsolute(args.descriptorPath)) {
            throw new Error("descriptorPath must be an absolute path ending in -app.xml.");
        }
        return { path: args.descriptorPath };
    }
    const info = JSON.parse(
        String(
            await deps.runner.execute(
                `var __docName = ${JSON.stringify(args.document ?? "")};\n${deps.bundle("preflight-publish")}`,
            ),
        ),
    ) as { name: string; platformPath?: string; playerTarget?: string };
    if (!info.platformPath) {
        throw new Error("Document has no AIR descriptor path.");
    }
    return {
        path: airDescriptorPathForFla(info.platformPath),
        playerTarget: info.playerTarget,
    };
}

/**
 * Reads whitelisted fields from the selected AIR descriptor.
 * @param args Tool target arguments.
 * @param args.document Optional open document name.
 * @param args.descriptorPath Optional absolute descriptor path.
 * @param deps Tool dependencies for executing Animate commands.
 * @returns Descriptor values and optional player target.
 */
export async function runGetAirDescriptor(args: { document?: string; descriptorPath?: string }, deps: ToolDeps) {
    const { path, playerTarget } = await resolveAirDescriptor(args, deps);
    const xml = await readFile(path, "utf8").catch((error: unknown) => {
        const detail = missingAirDescriptorDetail(error, path);
        if (detail) {
            throw new Error(detail);
        }
        throw error;
    });
    let data: Record<string, unknown>;
    try {
        data = parseAirDescriptor(xml);
    } catch (error) {
        throw new Error(`AIR descriptor is not valid XML: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ...data, ...(playerTarget !== undefined ? { playerTarget } : {}) };
}

export const getAirDescriptorTool: ToolDefinition<typeof INPUT> = {
    name: "get_air_descriptor",
    description:
        "Read the whitelisted settings from an AIR *-app.xml descriptor. Specify an open document or an absolute descriptorPath (which works without Animate); omit both only when exactly one document is open. The AIR settings dialog's OK may rewrite the descriptor.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        basic: "- Use get_air_descriptor to inspect AIR app settings; the AIR settings dialog's OK may rewrite its descriptor.",
    },
    inputSchema: INPUT,
    run: async ({ document, descriptorPath }: Parameters<ToolCallback<typeof INPUT>>[0], deps: ToolDeps) => ({
        data: await runGetAirDescriptor({ document, descriptorPath }, deps),
    }),
};

/**
 * Registers the get_air_descriptor tool.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 * @returns Nothing.
 */
export function registerGetAirDescriptor(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, getAirDescriptorTool, deps);
}
