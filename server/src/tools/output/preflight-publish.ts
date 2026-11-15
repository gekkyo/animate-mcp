import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsflRun } from "../../runtime/jsfl-bundle.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../shared.js";

const INPUT = {
    document: z.string().optional().describe("Open document name; defaults to the only open document"),
};

type DocumentInfo = {
    name: string;
    pathURI: string;
    type: string;
    profile: string;
};

type OutputProbe = {
    name: string;
    exists: boolean;
};

type AuditResult = {
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
 * Runs read-only preflight checks and includes the existing document audit.
 * @param document Optional open document name.
 * @param deps Tool dependencies for executing Animate commands.
 * @returns Individual preflight checks and audit findings.
 */
export async function runPreflightPublish(document: string | undefined, deps: ToolDeps) {
    const { runner, bundle } = deps;
    const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n`;
    const info = JSON.parse(String(await runner.execute(`${prelude}${bundle("preflight-publish")}`))) as DocumentInfo;
    const supported = info.type === "Flash" || info.type === "htmlcanvas";
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
    const audit = JSON.parse(
        String(await runner.execute(jsflRun("audit-document", { __docName: document ?? "" }, bundle))),
    ) as AuditResult;
    if (audit.document !== info.name) {
        throw new Error(`Document changed during preflight (audit: ${audit.document}, info: ${info.name})`);
    }
    const checkedUris = candidates
        .map((name) => ({ name, uri: outputCandidateUri(name, info.pathURI) }))
        .filter((candidate): candidate is { name: string; uri: string } => candidate.uri !== null);
    const probe = JSON.parse(
        String(
            await runner.execute(
                prelude +
                    `var __expectedName = ${JSON.stringify(info.name)};\n` +
                    `var __expectedPath = ${JSON.stringify(info.pathURI)};\n` +
                    `var __outputFiles = ${JSON.stringify(checkedUris)};\n${bundle("preflight-publish")}`,
            ),
        ),
    ) as DocumentInfo & { sameDocument: boolean; outputFiles: OutputProbe[] };
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
        "Read-only checks for saved state, document type, publish profile, possible output filenames, and audit findings. It never saves, compiles, publishes, or fixes the document. Ambiguous output paths are unchecked; compilation is always unchecked.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    guidance: {
        basic: "- Use preflight_publish to review known risks before Publish. Ambiguous output-file paths and compilation are not verified.",
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
