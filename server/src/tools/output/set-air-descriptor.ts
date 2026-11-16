import { randomUUID } from "node:crypto";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";
import { resolveAirDescriptor } from "./get-air-descriptor.js";

const FIELDS = [
    "id",
    "versionNumber",
    "versionLabel",
    "renderMode",
    "aspectRatio",
    "autoOrients",
    "fullScreen",
] as const;
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
export async function runSetAirDescriptor(
    args: Record<string, unknown> & { document?: string; descriptorPath?: string; dryRun?: boolean },
    deps: ToolDeps,
) {
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
async function setAirDescriptorAtPath(
    args: Record<string, unknown> & { document?: string; descriptorPath?: string; dryRun?: boolean },
    path: string,
    playerTarget: string | undefined,
) {
    const xml = await readFile(path, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("AIR descriptor is not present; Animate generates it during Publish.");
        }
        throw error;
    });
    const values = Object.fromEntries(
        Object.entries(args).filter(([key]) => key !== "document" && key !== "descriptorPath" && key !== "dryRun"),
    );
    const allowed = new Set([...FIELDS, "icon", "extensions", "manifestAdditions", "InfoAdditions"]);
    for (const key of Object.keys(values)) {
        if (!allowed.has(key)) {
            throw new Error(`Unsupported AIR descriptor field: ${key}.`);
        }
    }
    if (!Object.keys(values).length) {
        throw new Error("Supply at least one AIR descriptor field.");
    }
    if (values.id === null || values.versionNumber === null) {
        throw new Error("id and versionNumber cannot be deleted.");
    }
    if (
        values.renderMode !== undefined &&
        values.renderMode !== null &&
        !["auto", "cpu", "direct", "gpu"].includes(String(values.renderMode))
    ) {
        throw new Error("renderMode must be auto, cpu, direct, or gpu.");
    }
    if (
        values.aspectRatio !== undefined &&
        values.aspectRatio !== null &&
        !["portrait", "landscape", "any"].includes(String(values.aspectRatio))
    ) {
        throw new Error("aspectRatio must be portrait, landscape, or any.");
    }
    for (const key of ["id", "versionNumber"] as const) {
        if (values[key] !== undefined && (typeof values[key] !== "string" || !values[key].trim())) {
            throw new Error(`${key} must be a non-empty string.`);
        }
    }
    const dir = dirname(path);
    if (values.icon && typeof values.icon === "object" && !Array.isArray(values.icon)) {
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
        for (const [name, file] of Object.entries(values.icon)) {
            if (!iconNames.has(name)) {
                throw new Error(`Invalid AIR icon size name: ${name}.`);
            }
            if (
                !file ||
                typeof file !== "string" ||
                isAbsolute(file) ||
                relative(resolve(dir), resolve(dir, file)).startsWith("..")
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
    const direct = (node: Node, name: string) => node.children.filter((child) => child.name === name);
    /**
     * Finds a unique direct child element.
     * @param node Parent XML element.
     * @param name Child element name.
     * @returns Matching child if present.
     */
    const one = (node: Node, name: string) => {
        const found = direct(node, name);
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
    const set = (parent: Node, name: string, value: string | null, encoded = true) => {
        const found = one(parent, name);
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
            const prefix = opening.match(/^<([^\s/>:]+:)?[^\s/>]+/)?.[1] ?? "";
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
    const initialWindow = one(root, "initialWindow");
    for (const name of FIELDS) {
        if (values[name] !== undefined) {
            const parent =
                name === "renderMode" || name === "aspectRatio" || name === "autoOrients" || name === "fullScreen"
                    ? initialWindow
                    : root;
            if (!parent) {
                throw new Error("AIR descriptor has no <initialWindow> element.");
            }
            if (
                (name === "autoOrients" || name === "fullScreen") &&
                values[name] !== null &&
                typeof values[name] !== "boolean"
            ) {
                throw new Error(`${name} must be boolean or null.`);
            }
            if (
                values[name] !== null &&
                !["autoOrients", "fullScreen"].includes(name) &&
                typeof values[name] !== "string"
            ) {
                throw new Error(`${name} must be a string or null.`);
            }
            set(parent, name, values[name] === null ? null : String(values[name]));
        }
    }
    for (const name of ["icon", "extensions"] as const) {
        if (values[name] === undefined) {
            continue;
        }
        const data = values[name];
        const container = one(root, name);
        if (container && /<!--|<!\[CDATA\[/.test(xml.slice(container.openEnd, container.closeStart))) {
            throw new Error(`Cannot replace <${name}> because it contains comments or CDATA.`);
        }
        if (data === null) {
            set(root, name, null);
            continue;
        }
        if (name === "icon") {
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error("icon must be an object or null.");
            }
            const opening = xml.slice(container?.start ?? root.start, container?.openEnd ?? root.openEnd);
            const prefix = opening.match(/^<([^\s/>:]+:)?[^\s/>]+/)?.[1] ?? "";
            const body = Object.entries(data)
                .map(([key, val]) => `\n            <${prefix}${key}>${escapeXml(String(val))}</${prefix}${key}>`)
                .join("");
            set(root, name, body ? `${body}\n        ` : "", false);
        } else {
            if (!Array.isArray(data) || data.some((item) => typeof item !== "string" || !item)) {
                throw new Error("extensions must be an array of non-empty strings or null.");
            }
            const opening = xml.slice(container?.start ?? root.start, container?.openEnd ?? root.openEnd);
            const prefix = opening.match(/^<([^\s/>:]+:)?[^\s/>]+/)?.[1] ?? "";
            set(
                root,
                name,
                data.length
                    ? `\n            ${data.map((id) => `<${prefix}extensionID>${escapeXml(id)}</${prefix}extensionID>`).join("\n            ")}\n        `
                    : "",
                false,
            );
        }
    }
    for (const [key, blockName] of [
        ["manifestAdditions", "android"],
        ["InfoAdditions", "iPhone"],
    ] as const) {
        if (values[key] === undefined) {
            continue;
        }
        const parent = one(root, blockName);
        if (!parent) {
            const closing = xml.lastIndexOf("</", root.end);
            const indent = xml.slice(xml.lastIndexOf("\n", root.start) + 1, root.start).match(/^\s*/)?.[0] ?? "";
            const value = values[key];
            if (value !== null && typeof value !== "string") {
                throw new Error(`${key} must be a string or null.`);
            }
            if (typeof value === "string" && value.includes("]]>")) {
                throw new Error(`${key} cannot contain the CDATA terminator ]]>.`);
            }
            if (value === null) {
                continue;
            }
            const rootOpening = xml.slice(root.start, root.openEnd);
            const prefix = rootOpening.match(/^<([^\s/>:]+:)?[^\s/>]+/)?.[1] ?? "";
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
        const value = values[key];
        if (value !== null && typeof value !== "string") {
            throw new Error(`${key} must be a string or null.`);
        }
        let inner = value as string | null;
        if (inner !== null) {
            if (inner.includes("]]>")) {
                throw new Error(`${key} cannot contain the CDATA terminator ]]>.`);
            }
            inner = `<![CDATA[${inner}]]>`;
        }
        set(parent, key, inner, false);
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
        ...(values.manifestAdditions !== undefined ? ["Android"] : []),
        ...(values.InfoAdditions !== undefined ? ["iOS"] : []),
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
        const { unlink } = await import("node:fs/promises");
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
        data: await runSetAirDescriptor(
            args as Record<string, unknown> & { document?: string; descriptorPath?: string; dryRun?: boolean },
            deps,
        ),
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
