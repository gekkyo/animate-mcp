import { randomUUID } from "node:crypto";
import { copyFile, lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { isInside } from "../core/paths.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";
import { AIR_DESCRIPTOR_FIELDS, missingAirDescriptorDetail, resolveAirDescriptor } from "./get-air-descriptor.js";

const INPUT = z.strictObject({
    document: z.string().optional().describe("Open document name; defaults to the only open document"),
    descriptorPath: z.string().optional().describe("Absolute path to an AIR *-app.xml descriptor"),
    id: z.string().nullable().optional(),
    versionNumber: z.string().nullable().optional(),
    versionLabel: z.string().nullable().optional(),
    renderMode: z.enum(["auto", "cpu", "direct", "gpu"]).nullable().optional(),
    aspectRatio: z.enum(["portrait", "landscape", "any"]).nullable().optional(),
    autoOrients: z.boolean().nullable().optional(),
    fullScreen: z.boolean().nullable().optional(),
    icon: z.record(z.string(), z.string()).nullable().optional(),
    extensions: z.array(z.string()).nullable().optional(),
    manifestAdditions: z.string().nullable().optional(),
    InfoAdditions: z.string().nullable().optional(),
    dryRun: z.boolean().optional().default(false),
});
type SetAirDescriptorInput = Parameters<ToolCallback<typeof INPUT>>[0];

type Node = {
    name: string;
    openEnd: number;
    start: number;
    closeStart: number;
    end: number;
    selfClosing: boolean;
    children: Node[];
};
type Edit = { start: number; end: number; text: string };
const descriptorLocks = new Map<string, Promise<void>>();

/**
 * Resolves the nearest existing path ancestor, following symlinks.
 * @param path Candidate path.
 * @returns The real path of the nearest existing ancestor, or undefined for an unresolved symlink.
 */
async function nearestExistingRealPath(path: string): Promise<string | undefined> {
    let candidate = path;
    while (true) {
        try {
            return await realpath(candidate);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            try {
                if ((await lstat(candidate)).isSymbolicLink()) {
                    return undefined;
                }
            } catch (lstatError) {
                if ((lstatError as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw lstatError;
                }
            }
            const parent = dirname(candidate);
            if (parent === candidate) {
                return undefined;
            }
            candidate = parent;
        }
    }
}

/**
 * Extracts the namespace prefix from an element's opening tag.
 * @param opening Element opening tag.
 * @returns Namespace prefix, if present.
 */
function namespacePrefix(opening: string): string {
    return opening.match(/^<([^\s/>:]+:)?[^\s/>]+/)?.[1] ?? "";
}

/**
 * Rejects a CDATA terminator in CDATA content.
 * @param value Content to write.
 * @param field AIR descriptor field name.
 * @returns Nothing.
 */
function assertCdataSafe(value: string, field: string): void {
    if (value.includes("]]>")) {
        throw new Error(`${field} cannot contain the CDATA terminator ]]>.`);
    }
}

/**
 * Serializes descriptor updates within this process.
 * @param path Descriptor path.
 * @param action Update to run while holding the path lock.
 * @returns The update result.
 */
async function withDescriptorLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const key = resolve(path);
    const previous = descriptorLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
        release = resolveLock;
    });
    const queued = previous.then(() => current);
    descriptorLocks.set(key, queued);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (descriptorLocks.get(key) === queued) {
            descriptorLocks.delete(key);
        }
    }
}

/**
 * Parses element boundaries for lossless text edits.
 * @param xml Descriptor source.
 * @returns The root element and its descendants.
 */
function locateElements(xml: string): Node {
    let root: Node | undefined;
    const stack: Node[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
        const openEnd = parser.position;
        const start = xml.lastIndexOf("<", openEnd - 1);
        const node: Node = {
            name: tag.local ?? tag.name,
            start,
            openEnd,
            closeStart: openEnd,
            end: openEnd,
            selfClosing: tag.isSelfClosing,
            children: [],
        };
        if (stack.length) {
            stack[stack.length - 1].children.push(node);
        } else {
            root = node;
        }
        stack.push(node);
    });
    parser.on("closetag", () => {
        const node = stack.pop();
        if (node) {
            node.end = parser.position;
            if (!node.selfClosing) {
                node.closeStart = Math.max(node.openEnd, xml.lastIndexOf("</", parser.position));
            }
        }
    });
    parser.write(xml).close();
    if (root?.name !== "application") {
        throw new Error("AIR descriptor root element must be application.");
    }
    return root;
}

/**
 * Escapes text for XML element content.
 * @param value Input string.
 * @returns XML-safe text.
 */
function escapeXml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Writes a patch to the selected descriptor.
 * @param args Tool arguments.
 * @param deps Tool dependencies for Animate target resolution.
 * @returns The resulting diff or updated descriptor fields.
 */
export async function runSetAirDescriptor(args: SetAirDescriptorInput, deps: ToolDeps) {
    const { path, playerTarget } = await resolveAirDescriptor(args, deps);
    return withDescriptorLock(path, () => setAirDescriptorAtPath(args, path, playerTarget));
}

/**
 * Applies validated field updates to a resolved descriptor.
 * @param args Tool arguments.
 * @param path Resolved descriptor path.
 * @param playerTarget Current Animate target.
 * @returns The resulting diff or updated descriptor fields.
 */
async function setAirDescriptorAtPath(args: SetAirDescriptorInput, path: string, playerTarget: string | undefined) {
    const xml = await readFile(path, "utf8").catch((error: unknown) => {
        const detail = missingAirDescriptorDetail(error, path);
        if (detail) {
            throw new Error(detail);
        }
        throw error;
    });
    const patch = {
        id: args.id,
        versionNumber: args.versionNumber,
        versionLabel: args.versionLabel,
        renderMode: args.renderMode,
        aspectRatio: args.aspectRatio,
        autoOrients: args.autoOrients,
        fullScreen: args.fullScreen,
        icon: args.icon,
        extensions: args.extensions,
        manifestAdditions: args.manifestAdditions,
        InfoAdditions: args.InfoAdditions,
    };
    if (Object.values(patch).every((value) => value === undefined)) {
        throw new Error("Supply at least one AIR descriptor field.");
    }
    const descriptorFolder = resolve(dirname(path));
    if (patch.icon) {
        const iconNames = new Set([
            "image16x16",
            "image29x29",
            "image32x32",
            "image36x36",
            "image40x40",
            "image44x44",
            "image48x48",
            "image50x50",
            "image57x57",
            "image58x58",
            "image60x60",
            "image66x66",
            "image72x72",
            "image75x75",
            "image76x76",
            "image80x80",
            "image87x87",
            "image96x96",
            "image100x100",
            "image114x114",
            "image120x120",
            "image128x128",
            "image144x144",
            "image152x152",
            "image160x160",
            "image167x167",
            "image180x180",
            "image192x192",
            "image240x240",
            "image256x256",
            "image320x320",
            "image512x512",
            "image732x412",
            "image1024x1024",
        ]);
        const realDescriptorFolder = await realpath(descriptorFolder);
        for (const [name, file] of Object.entries(patch.icon)) {
            if (!iconNames.has(name)) {
                throw new Error(`Invalid AIR icon size name: ${name}.`);
            }
            const resolvedPath = resolve(descriptorFolder, file);
            if (!file || isAbsolute(file) || !isInside(descriptorFolder, resolvedPath)) {
                throw new Error(`Icon path must be inside the descriptor folder: ${String(file)}.`);
            }
            const existingPath = await nearestExistingRealPath(resolvedPath);
            if (
                !existingPath ||
                (existingPath !== realDescriptorFolder && !isInside(realDescriptorFolder, existingPath))
            ) {
                throw new Error(`Icon path must be inside the descriptor folder: ${String(file)}.`);
            }
        }
    }
    const root = locateElements(xml);
    /**
     * Finds direct child elements by name.
     * @param node Parent XML element.
     * @param name Child element name.
     * @returns Matching children.
     */
    const childrenNamed = (node: Node, name: string) => node.children.filter((child) => child.name === name);
    /**
     * Finds a unique direct child element.
     * @param node Parent XML element.
     * @param name Child element name.
     * @returns Matching child if present.
     */
    const uniqueChild = (node: Node, name: string) => {
        const found = childrenNamed(node, name);
        if (found.length > 1) {
            throw new Error(`AIR descriptor has ambiguous duplicate <${name}> elements.`);
        }
        return found[0];
    };
    const edits: Edit[] = [];
    /**
     * Adds a text replacement, deletion, or child insertion.
     * @param parent Parent XML element.
     * @param name Child element name.
     * @param value New text or null to delete.
     * @param encoded Whether the value is XML text or already serialized markup.
     * @returns Nothing.
     */
    const patchChild = (parent: Node, name: string, value: string | null, encoded = true) => {
        const found = uniqueChild(parent, name);
        if (value === null) {
            if (found) {
                edits.push({ start: found.start, end: found.end, text: "" });
            }
        } else if (found) {
            const content = encoded ? escapeXml(value) : value;
            if (found.selfClosing) {
                const opening = xml.slice(found.start, found.openEnd).replace(/\/\s*>$/, ">");
                const qname = opening.match(/^<([^\s/>]+)/)?.[1] ?? name;
                edits.push({ start: found.start, end: found.end, text: `${opening}${content}</${qname}>` });
            } else {
                edits.push({ start: found.openEnd, end: found.closeStart, text: content });
            }
        } else {
            const opening = xml.slice(parent.start, parent.openEnd);
            const prefix = namespacePrefix(opening);
            const childName = `${prefix}${name}`;
            const childText = `${encoded ? escapeXml(value) : value}`;
            if (parent.selfClosing) {
                const parentName = opening.match(/^<([^\s/>]+)/)?.[1] ?? "application";
                const existingEdit = edits.find((edit) => edit.start === parent.start && edit.end === parent.end);
                if (existingEdit) {
                    existingEdit.text = existingEdit.text.replace(
                        `</${parentName}>`,
                        `<${childName}>${childText}</${childName}></${parentName}>`,
                    );
                    return;
                }
                const expanded = opening.replace(/\/\s*>$/, ">");
                edits.push({
                    start: parent.start,
                    end: parent.end,
                    text: `${expanded}<${childName}>${childText}</${childName}></${parentName}>`,
                });
                return;
            }
            const closing = xml.lastIndexOf("</", parent.end);
            if (closing < parent.openEnd) {
                throw new Error(`Cannot add <${name}> to malformed parent.`);
            }
            const indent = xml.slice(xml.lastIndexOf("\n", parent.start) + 1, parent.start).match(/^\s*/)?.[0] ?? "";
            edits.push({
                start: closing,
                end: closing,
                text: `\n${indent}    <${childName}>${childText}</${childName}>`,
            });
        }
    };
    const initialWindow = uniqueChild(root, "initialWindow");
    for (const field of AIR_DESCRIPTOR_FIELDS) {
        if (!field.writable) {
            continue;
        }
        const { name, parent: parentName } = field;
        const value = patch[name];
        if (value !== undefined) {
            if (name === "id" || name === "versionNumber") {
                if (value === null) {
                    throw new Error("id and versionNumber cannot be deleted.");
                }
                if (typeof value !== "string" || !value.trim()) {
                    throw new Error(`${name} must be a non-empty string.`);
                }
            }
            if (
                name === "renderMode" &&
                value !== null &&
                typeof value === "string" &&
                !["auto", "cpu", "direct", "gpu"].includes(value)
            ) {
                throw new Error("renderMode must be auto, cpu, direct, or gpu.");
            }
            const parent = parentName === "initialWindow" ? initialWindow : root;
            if (!parent) {
                throw new Error("AIR descriptor has no <initialWindow> element.");
            }
            patchChild(parent, name, value === null ? null : String(value));
        }
    }
    for (const name of ["icon", "extensions"] as const) {
        const data = patch[name];
        if (data === undefined) {
            continue;
        }
        const container = uniqueChild(root, name);
        if (container && /<!--|<!\[CDATA\[/.test(xml.slice(container.openEnd, container.closeStart))) {
            throw new Error(`Cannot replace <${name}> because it contains comments or CDATA.`);
        }
        if (data === null) {
            patchChild(root, name, null);
            continue;
        }
        if (name === "extensions" && (!Array.isArray(data) || data.some((item) => !item))) {
            throw new Error("extensions must be an array of non-empty strings or null.");
        }
        const opening = xml.slice(container?.start ?? root.start, container?.openEnd ?? root.openEnd);
        const prefix = namespacePrefix(opening);
        const items = Array.isArray(data)
            ? data.map((id) => `<${prefix}extensionID>${escapeXml(id)}</${prefix}extensionID>`)
            : Object.entries(data).map(([key, value]) => `<${prefix}${key}>${escapeXml(value)}</${prefix}${key}>`);
        const body = items.length ? `\n            ${items.join("\n            ")}\n        ` : "";
        patchChild(root, name, body, false);
    }
    for (const [key, blockName] of [
        ["manifestAdditions", "android"],
        ["InfoAdditions", "iPhone"],
    ] as const) {
        if (patch[key] === undefined) {
            continue;
        }
        const parent = uniqueChild(root, blockName);
        if (!parent) {
            const closing = xml.lastIndexOf("</", root.end);
            const indent = xml.slice(xml.lastIndexOf("\n", root.start) + 1, root.start).match(/^\s*/)?.[0] ?? "";
            const value = patch[key];
            if (value !== null) {
                assertCdataSafe(value, key);
            }
            if (value === null) {
                continue;
            }
            const rootOpening = xml.slice(root.start, root.openEnd);
            const prefix = namespacePrefix(rootOpening);
            const qualifiedBlock = `${prefix}${blockName}`;
            const qualifiedKey = `${prefix}${key}`;
            const child = `<${qualifiedKey}><![CDATA[${String(value)}]]></${qualifiedKey}>`;
            edits.push({
                start: closing,
                end: closing,
                text: `\n${indent}    <${qualifiedBlock}>${child}</${qualifiedBlock}>`,
            });
            continue;
        }
        const value = patch[key];
        let inner = value;
        if (inner !== null) {
            assertCdataSafe(inner, key);
            inner = `<![CDATA[${inner}]]>`;
        }
        patchChild(parent, key, inner, false);
    }
    const groupedEdits = new Map<string, Edit>();
    for (const edit of edits) {
        const key = `${edit.start}:${edit.end}`;
        const existing = groupedEdits.get(key);
        if (existing && edit.start === edit.end) {
            existing.text += edit.text;
        } else {
            groupedEdits.set(key, { ...edit });
        }
    }
    const orderedEdits = [...groupedEdits.values()].sort((a, b) => b.start - a.start);
    const changes = orderedEdits.map((edit) => ({
        offset: edit.start,
        before: xml.slice(edit.start, edit.end),
        after: edit.text,
    }));
    const next = orderedEdits.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), xml);
    // Validate the complete result before any filesystem write.
    locateElements(next);
    const diff =
        xml === next
            ? "(no changes)"
            : `--- ${basename(path)}\n+++ ${basename(path)}\n${changes
                  .map(
                      ({ offset, before, after }) =>
                          `@@ offset ${offset} @@\n-${before || "(empty)"}\n+${after || "(empty)"}`,
                  )
                  .join("\n")}`;
    const editedPlatforms = [
        ...(patch.manifestAdditions !== undefined ? ["Android"] : []),
        ...(patch.InfoAdditions !== undefined ? ["iOS"] : []),
    ];
    const notes = playerTarget
        ? editedPlatforms
              .filter((platform) => !playerTarget.toLowerCase().includes(platform.toLowerCase()))
              .map((platform) => `Edited ${platform} settings while the current player target is ${playerTarget}.`)
        : [];
    if (args.dryRun) {
        return {
            path,
            dryRun: true,
            diff,
            ...(playerTarget ? { playerTarget } : {}),
            ...(notes.length ? { notes } : {}),
        };
    }
    const backup = `${path}.bak`;
    await copyFile(path, backup);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, next, "utf8");
        await rename(temporary, path);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    return {
        path,
        backup,
        dryRun: false,
        ...(playerTarget ? { playerTarget } : {}),
        ...(notes.length ? { notes } : {}),
    };
}

export const setAirDescriptorTool: ToolDefinition<typeof INPUT> = {
    name: "set_air_descriptor",
    description:
        "Patch whitelisted fields in an existing AIR *-app.xml descriptor. Writes a .bak first; use dryRun to inspect changes. The AIR settings dialog's OK may rewrite the descriptor.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    guidance: {
        basic: "- Use set_air_descriptor to edit AIR app settings; dryRun first. The AIR settings dialog's OK may rewrite the descriptor.",
    },
    inputSchema: INPUT,
    run: async (args: Parameters<ToolCallback<typeof INPUT>>[0], deps: ToolDeps) => ({
        data: await runSetAirDescriptor(args, deps),
    }),
};

/**
 * Registers the set_air_descriptor tool.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 * @returns Nothing.
 */
export function registerSetAirDescriptor(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, setAirDescriptorTool, deps);
}
