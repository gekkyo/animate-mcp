import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isInside } from "../core/paths.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";
import {
    type AirDescriptorElement,
    airDescriptorPathForFla,
    missingAirDescriptorDetail,
    parseAirDescriptorElements,
} from "./get-air-descriptor.js";

const INPUT = {
    document: z.string().optional().describe("Open document name; defaults to the only open document"),
};

const OUTPUT_PROBE = z.object({ name: z.string(), exists: z.boolean() }).strict();
const PREFLIGHT_RESULT = z
    .object({
        name: z.string(),
        pathURI: z.string(),
        type: z.string(),
        profile: z.string(),
        sameDocument: z.boolean(),
        outputFiles: z.array(OUTPUT_PROBE),
        playerTarget: z.string().optional(),
        platformPath: z.string().optional(),
    })
    .strict();
const AUDIT_RESULT = z
    .object({
        document: z.string(),
        findings: z.array(
            z
                .object({
                    category: z.enum(["unusedLibraryItem", "emptyKeyframe", "defaultName"]),
                    severity: z.enum(["info", "warning"]),
                    location: z.string(),
                    message: z.string(),
                    item: z.string().optional(),
                    linkage: z.boolean().optional(),
                })
                .strict(),
        ),
        warnings: z.array(z.string()),
    })
    .strict();

/**
 * Extracts enabled formats and output filename candidates from profile XML.
 * @param profile Publish profile XML.
 * @param documentType Animate document type.
 * @returns Enabled format flags and candidate file names.
 */
function parseProfile(profile: string, documentType: string) {
    if (documentType === "htmlcanvas") {
        const properties = new Map(
            [...profile.matchAll(/<PublishProperties\b([^>]*)>/g)]
                .map(([, attributes]) => {
                    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
                    const name = attributes.match(/\bname="([^"]+)"/)?.[1];
                    return id && name ? [id, name] : null;
                })
                .filter((entry): entry is [string, string] => entry !== null),
        );
        const formats = [...profile.matchAll(/<publishFormat\b[^>]*\bid="([^"]+)"[^>]*>\s*([01])\s*<\/publishFormat>/g)]
            .map(([, id, enabled]) => ({ name: properties.get(id), enabled: enabled === "1" }))
            .filter(
                (format): format is { name: string; enabled: boolean } =>
                    format.name === "JavaScript/HTML" || format.name === "SVG Image",
            );
        return { formats, candidates: [] as string[], mappingComplete: false };
    }
    const formatNames = [
        "flash",
        "html",
        "images",
        "audio",
        "video",
        "gif",
        "jpeg",
        "png",
        "svg",
        "projector",
        "projectorWin",
    ];
    const formats = [...profile.matchAll(/<([A-Za-z][\w:-]*)>\s*([01])\s*<\/\1>/g)]
        .filter(([, name]) => formatNames.includes(name))
        .map(([, name, enabled]) => ({ name, enabled: enabled === "1" }));
    const fileNames = new Map(
        [...profile.matchAll(/<([A-Za-z][\w:-]*FileName)>\s*([^<]+)\s*<\/\1>/g)].map(([, tag, name]) => [
            tag.slice(0, -"FileName".length),
            name.trim(),
        ]),
    );
    const hasDefaultNames = /<defaultNames>\s*1\s*<\/defaultNames>/.test(profile);
    const enabledNames = new Set(formats.filter((format) => format.enabled).map((format) => format.name));
    const candidates = hasDefaultNames
        ? []
        : [...fileNames]
              .filter(([format, name]) => name && enabledNames.has(format === "js" ? "html" : format))
              .map(([, name]) => name);
    const mappingComplete =
        !hasDefaultNames &&
        formats
            .filter((format) => format.enabled)
            .every((format) => format.name !== "images" && fileNames.has(format.name));
    return { formats, candidates: [...new Set(candidates)], mappingComplete };
}

/**
 * Resolves a safe profile basename beside the saved FLA.
 * @param fileName Profile filename.
 * @param documentPath Saved document file URI.
 * @returns Candidate file URI, or null when its location is ambiguous.
 */
function outputCandidateUri(fileName: string, documentPath: string): string | null {
    if (
        !fileName ||
        fileName === "." ||
        fileName === ".." ||
        fileName.includes("/") ||
        fileName.includes("\\") ||
        fileName.includes(":")
    ) {
        return null;
    }
    for (let characterIndex = 0; characterIndex < fileName.length; characterIndex++) {
        if (fileName.charCodeAt(characterIndex) < 32) {
            return null;
        }
    }
    try {
        const docUri = new URL(documentPath);
        if (docUri.protocol !== "file:" || docUri.search || docUri.hash) {
            return null;
        }
        return new URL(encodeURIComponent(fileName), new URL(".", docUri)).href;
    } catch {
        return null;
    }
}

/**
 * Checks the descriptor and the AIR assets that can be safely inspected.
 * @param flaPath Saved FLA platform path.
 * @param playerTarget Animate's AIR target string.
 * @returns AIR preflight checks.
 */
async function checkAir(flaPath: string, playerTarget: string) {
    const matchedTarget = playerTarget.match(/AIR [\d.]+ for (Desktop|Android|iOS)$/)?.[1];
    const target = matchedTarget === "Desktop" ? "desktop" : (matchedTarget?.toLowerCase() ?? "unknown");
    const targetCheck = {
        status: matchedTarget ? ("pass" as const) : ("unchecked" as const),
        target,
        detail: matchedTarget ? `AIR target: ${target}.` : `Unrecognized AIR target: ${playerTarget || "not exposed"}.`,
    };
    const signing = {
        status: "unchecked" as const,
        detail: "Certificate/provisioning paths are not exposed by Animate; not inspected.",
    };
    /**
     * Builds an unchecked sub-check.
     * @param detail Why the check could not run.
     * @returns The unchecked result.
     */
    const unchecked = (detail: string) => ({ status: "unchecked" as const, detail });
    /**
     * Builds checks for an unavailable AIR descriptor.
     * @param descriptor Descriptor result.
     * @param descriptor.status Descriptor status.
     * @param descriptor.detail Descriptor detail.
     * @param reason Why descriptor-dependent checks could not run.
     * @returns AIR checks with descriptor-dependent checks unchecked.
     */
    const unavailable = (descriptor: { status: "unchecked" | "fail"; detail: string }, reason: string) => ({
        target: targetCheck,
        descriptor,
        identity: unchecked(reason),
        icons: { ...unchecked(reason), items: [] },
        ...(target === "ios" ? { iosAssetsCar: unchecked(reason) } : {}),
        ...(target === "android" ? { androidAdaptiveIcon: unchecked(reason) } : {}),
        signing,
    });
    /**
     * Checks whether a candidate path escapes its descriptor folder.
     * @param candidatePath Original path from the descriptor.
     * @param resolvedPath Candidate resolved against the descriptor folder.
     * @param folder Descriptor folder.
     * @returns Whether the path is absolute or outside the folder.
     */
    const isOutsideFolder = (candidatePath: string, resolvedPath: string, folder: string) =>
        isAbsolute(candidatePath) || /^[A-Za-z]:[\\/]/.test(candidatePath) || !isInside(folder, resolvedPath);
    let descriptorPath: string;
    try {
        if (!flaPath) {
            throw new Error("Document has not been saved.");
        }
        descriptorPath = airDescriptorPathForFla(flaPath);
    } catch (error) {
        const detail = `AIR descriptor cannot be located: ${error instanceof Error ? error.message : String(error)}`;
        return unavailable(unchecked(detail), "AIR descriptor is unavailable.");
    }
    let xml: string;
    try {
        xml = await readFile(descriptorPath, "utf8");
    } catch (error) {
        const detail = missingAirDescriptorDetail(error, descriptorPath);
        if (detail) {
            return unavailable(unchecked(detail), "AIR descriptor is unavailable.");
        }
        const readDetail = `AIR descriptor could not be read: ${error instanceof Error ? error.message : String(error)}`;
        return unavailable({ status: "fail", detail: readDetail }, "AIR descriptor could not be parsed.");
    }
    let application: AirDescriptorElement | undefined;
    try {
        application = parseAirDescriptorElements(xml);
    } catch (error) {
        const detail = `AIR descriptor is not valid XML: ${error instanceof Error ? error.message : String(error)}`;
        return unavailable({ status: "fail", detail }, "AIR descriptor could not be parsed.");
    }
    if (application?.name !== "application") {
        const detail = "AIR descriptor root element must be application.";
        return unavailable({ status: "fail", detail }, "AIR descriptor could not be parsed.");
    }
    const identityValues = ["id", "versionNumber"].map((name) =>
        application.children.find((element) => element.name === name)?.text.trim(),
    );
    const identity = identityValues.every(Boolean)
        ? { status: "pass" as const, detail: "Application id and versionNumber are present." }
        : { status: "fail" as const, detail: "Application id and versionNumber must both be non-empty." };
    const icon = application.children.find((element) => element.name === "icon");
    const declarations = (icon?.children ?? []).flatMap((element) => {
        const match = element.name.match(/^image(\d+)x(\d+)$/);
        return match ? [{ width: match[1], height: match[2], path: element.text }] : [];
    });
    const iconRoot = await realpath(dirname(descriptorPath));
    const icons = await Promise.all(
        declarations.map(async ({ width: widthText, height: heightText, path: rawPath }) => {
            const size = `${widthText}x${heightText}`;
            const iconPath = rawPath.trim();
            const expectedWidth = Number(widthText);
            const expectedHeight = Number(heightText);
            const resolved = resolve(dirname(descriptorPath), iconPath);
            if (isOutsideFolder(iconPath, resolved, dirname(descriptorPath))) {
                return {
                    path: iconPath,
                    expected: size,
                    status: "unchecked" as const,
                    detail: "Icon path is outside the descriptor folder.",
                };
            }
            try {
                const actualPath = await realpath(resolved);
                if (!isInside(iconRoot, actualPath)) {
                    return {
                        path: iconPath,
                        expected: size,
                        status: "unchecked" as const,
                        detail: "Icon path resolves outside the descriptor folder.",
                    };
                }
                const bytes = await readFile(actualPath);
                const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
                if (
                    bytes.length < 24 ||
                    !bytes.subarray(0, 8).equals(pngSignature) ||
                    bytes.toString("ascii", 12, 16) !== "IHDR"
                ) {
                    return {
                        path: iconPath,
                        expected: size,
                        status: "fail" as const,
                        detail: "Icon is missing a valid PNG signature or IHDR.",
                    };
                }
                const width = bytes.readUInt32BE(16);
                const height = bytes.readUInt32BE(20);
                return width === expectedWidth && height === expectedHeight
                    ? {
                          path: iconPath,
                          expected: size,
                          status: "pass" as const,
                          width,
                          height,
                          detail: "PNG dimensions match.",
                      }
                    : {
                          path: iconPath,
                          expected: size,
                          status: "fail" as const,
                          width,
                          height,
                          detail: `PNG dimensions are ${width}x${height}.`,
                      };
            } catch (error) {
                return {
                    path: iconPath,
                    expected: size,
                    status: "fail" as const,
                    detail: `Icon is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }),
    );
    let iconStatus: "fail" | "unchecked" | "pass" = "pass";
    if (icons.some((icon) => icon.status === "fail")) {
        iconStatus = "fail";
    } else if (icons.some((icon) => icon.status === "unchecked")) {
        iconStatus = "unchecked";
    }
    const iconCheck = declarations.length
        ? { status: iconStatus, detail: "Checked each declared AIR descriptor icon.", items: icons }
        : { status: "unchecked" as const, detail: "No icon sizes are declared in the AIR descriptor.", items: [] };
    const folder = dirname(descriptorPath);
    let targetAssets: { status: "pass" | "fail" | "warning" | "unchecked"; detail: string } | undefined;
    if (target === "ios") {
        targetAssets = await stat(join(folder, "Assets.car"))
            .then(() => ({ status: "pass" as const, detail: "Assets.car exists; contents unchecked." }))
            .catch(() => ({ status: "fail" as const, detail: "Assets.car is missing." }));
    } else if (target === "android") {
        // Verified with AIR SDK 51.3 descriptor XSD: resdir is a direct child of <application>, not <android>.
        const resdir = application.children.find((element) => element.name === "resdir")?.text.trim();
        if (!resdir) {
            targetAssets = { status: "warning", detail: "Adaptive icon is not configured (no resdir declared)." };
        } else {
            const resPath = resolve(folder, resdir);
            if (isOutsideFolder(resdir, resPath, folder)) {
                targetAssets = { status: "unchecked", detail: "resdir is outside the descriptor folder." };
            } else {
                try {
                    const actualPath = await realpath(resPath);
                    if (!isInside(iconRoot, actualPath)) {
                        targetAssets = {
                            status: "unchecked",
                            detail: "resdir resolves outside the descriptor folder.",
                        };
                    } else if (!(await stat(actualPath)).isDirectory()) {
                        targetAssets = { status: "fail", detail: "Declared resdir is not a directory." };
                    } else {
                        const files = await readdir(join(actualPath, "mipmap-anydpi-v26")).catch(() => [] as string[]);
                        // AIR's manifest icon is @mipmap/icon and android:icon cannot be overridden, so the file must be named icon.xml.
                        targetAssets = files.includes("icon.xml")
                            ? { status: "pass", detail: "Adaptive icon mipmap-anydpi-v26/icon.xml found." }
                            : {
                                  status: "warning",
                                  detail: "No mipmap-anydpi-v26/icon.xml found; AIR only uses the resource named icon.",
                              };
                    }
                } catch (error) {
                    targetAssets =
                        (error as NodeJS.ErrnoException).code === "ENOENT"
                            ? { status: "fail", detail: "Declared resdir is missing." }
                            : {
                                  status: "fail",
                                  detail: `Declared resdir could not be read: ${error instanceof Error ? error.message : String(error)}`,
                              };
                }
            }
        }
    }
    return {
        target: targetCheck,
        descriptor: { status: "pass" as const, detail: "AIR descriptor exists." },
        identity,
        icons: iconCheck,
        ...(target === "ios" ? { iosAssetsCar: targetAssets } : {}),
        ...(target === "android" ? { androidAdaptiveIcon: targetAssets } : {}),
        signing,
    };
}

/**
 * Runs read-only preflight checks and includes the existing document audit.
 * @param document Optional open document name.
 * @param deps Tool dependencies for executing Animate commands.
 * @returns Individual preflight checks and audit findings.
 */
export async function runPreflightPublish(document: string | undefined, deps: ToolDeps) {
    const info = await deps.jsfl.run("output/preflight-publish", { __docName: document ?? "" }, PREFLIGHT_RESULT);
    const supported = info.type === "Flash" || info.type === "htmlcanvas";
    const airTarget =
        info.type === "Flash" && info.playerTarget?.startsWith("AIR ")
            ? await checkAir(info.platformPath ?? "", info.playerTarget)
            : undefined;
    const { formats, candidates, mappingComplete } = parseProfile(info.profile || "", info.type);
    if (!supported) {
        const unchecked = { status: "unchecked" as const, detail: `Unsupported type: ${info.type}.` };
        return {
            document: info.name,
            type: info.type,
            checks: {
                saved: unchecked,
                documentType: unchecked,
                publishFormats: { ...unchecked, formats: [] },
                outputFiles: { ...unchecked, candidates: [], warnings: [] },
                compilation: unchecked,
            },
            audit: {
                status: "unchecked",
                document: info.name,
                findings: { unusedLibraryItems: [], emptyKeyframes: [], defaultNames: [] },
                warnings: [],
            },
        };
    }
    const audit = await deps.jsfl.run("document/audit-document", { __docName: document ?? "" }, AUDIT_RESULT);
    if (audit.document !== info.name) {
        throw new Error(`Document changed during preflight (audit: ${audit.document}, info: ${info.name})`);
    }
    const checkedUris = candidates
        .map((name) => ({ name, uri: outputCandidateUri(name, info.pathURI) }))
        .filter((candidate): candidate is { name: string; uri: string } => candidate.uri !== null);
    const probe = await deps.jsfl.run(
        "output/preflight-publish",
        {
            __docName: document ?? "",
            __expectedName: info.name,
            __expectedPath: info.pathURI,
            __outputFiles: checkedUris,
        },
        PREFLIGHT_RESULT,
    );
    if (!probe.sameDocument || probe.name !== info.name || probe.pathURI !== info.pathURI) {
        throw new Error("Document changed during preflight; results were not reported.");
    }
    const outputWarnings = probe.outputFiles
        .filter((file) => file.exists)
        .map((file) => ({
            severity: "warning" as const,
            filename: file.name,
            detail: "May be overwritten by Publish.",
        }));
    const outputComplete = mappingComplete && candidates.length > 0 && checkedUris.length === candidates.length;
    let formatStatus: "unchecked" | "pass" | "fail";
    if (!formats.length) {
        formatStatus = "unchecked";
    } else if (formats.some((format) => format.enabled)) {
        formatStatus = "pass";
    } else {
        formatStatus = "fail";
    }
    let auditStatus: "unchecked" | "pass" | "fail";
    if (audit.warnings.length) {
        auditStatus = "unchecked";
    } else if (audit.findings.some((finding) => finding.severity === "warning")) {
        auditStatus = "fail";
    } else {
        auditStatus = "pass";
    }
    return {
        document: info.name,
        type: info.type,
        checks: {
            ...(airTarget ? { air: airTarget } : {}),
            saved: {
                status: info.pathURI ? "pass" : "fail",
                detail: info.pathURI
                    ? "Document has a saved path; pending edits are unchecked."
                    : "Document has not been saved.",
            },
            documentType: {
                status: "pass",
                detail: `Supported document type: ${info.type}.`,
            },
            publishFormats: {
                status: formatStatus,
                formats,
            },
            outputFiles: {
                status: outputComplete ? "pass" : "unchecked",
                candidates,
                warnings: outputWarnings,
                detail: outputComplete
                    ? "Checked only safe filename candidates beside the saved document."
                    : "Some output paths could not be safely determined.",
            },
            compilation: {
                status: "unchecked",
                detail: "Preflight does not compile; use Publish for an actual Build result.",
            },
        },
        audit: {
            status: auditStatus,
            document: audit.document,
            findings: {
                unusedLibraryItems: audit.findings.filter((finding) => finding.category === "unusedLibraryItem"),
                emptyKeyframes: audit.findings.filter((finding) => finding.category === "emptyKeyframe"),
                defaultNames: audit.findings.filter((finding) => finding.category === "defaultName"),
            },
            warnings: audit.warnings,
        },
    };
}

export const preflightPublishTool: ToolDefinition<typeof INPUT> = {
    name: "preflight_publish",
    description:
        "Read-only checks for saved state, document type, publish profile, possible output filenames, AIR descriptor/icons/assets, and audit findings. It never saves, compiles, publishes, or fixes the document. Ambiguous output paths are unchecked; compilation and AIR signing are always unchecked.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        basic: "- Use preflight_publish to review known risks before Publish. AIR signing, ambiguous output-file paths, and compilation are not verified.",
    },
    inputSchema: INPUT,
    run: async ({ document }: Parameters<ToolCallback<typeof INPUT>>[0], deps: ToolDeps) => ({
        data: await runPreflightPublish(document, deps),
    }),
};

/**
 * Registers the preflight_publish tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 * @returns Nothing.
 */
export function registerPreflightPublish(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, preflightPublishTool, deps);
}
