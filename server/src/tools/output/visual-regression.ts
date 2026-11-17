import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PNG } from "pngjs";
import { z } from "zod";
import { baselinesDir, capturesDir, isInside } from "../core/paths.js";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";
import { comparePixels, decodePng } from "./lib/image-diff.js";

const RANGE = z
    .object({
        start: z.number().int().min(1),
        end: z.number().int().min(1),
        step: z.number().int().min(1).optional(),
    })
    .strict()
    .refine(({ start, end }) => end >= start, "range.end must be greater than or equal to range.start");
const COMMON = {
    name: z
        .string()
        .min(1)
        .max(64)
        .regex(
            /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
            "Baseline name must contain only letters, numbers, dot, underscore, and hyphen",
        ),
    frame: z.number().int().min(1).optional(),
    range: RANGE.optional(),
};
const INPUT = {
    action: z.enum(["save", "compare"]),
    ...COMMON,
    overwrite: z.boolean().optional(),
    tolerance: z.number().int().min(0).max(255).optional(),
    maxChangedPercent: z.number().min(0).max(100).optional(),
};
type Capture = { path: string; pathURI?: string; frame: number; timeline: string; width: number; height: number };
const CAPTURE_RESULT = z
    .object({
        path: z.string(),
        pathURI: z.string().optional(),
        frame: z.number().int(),
        timeline: z.string(),
        width: z.number(),
        height: z.number(),
    })
    .strict();
const CAPTURE_RESPONSE = z.union([CAPTURE_RESULT, z.object({ captures: z.array(CAPTURE_RESULT) }).strict()]);
type Baseline = { captures: Array<Omit<Capture, "path" | "pathURI">>; documentId: string };
type DocumentIdentity = { pathURI: string; name: string };
type CaptureMetadata = Omit<Capture, "path" | "pathURI">;
type BaselineContext = {
    name: string;
    identity: DocumentIdentity;
    documentId: string;
    target: string;
    documentDir: string;
    captures: Capture[];
    docPaths: string[];
    capturesMeta: CaptureMetadata[];
};
const STALE_LOCK_AGE_MS = 60_000;

/**
 * Reports whether an old lock has no verifiably live owner.
 * @param lock Lock directory path.
 * @returns Whether the lock is old and stale.
 */
async function isStaleLock(lock: string): Promise<boolean> {
    const lockStat = await stat(lock).catch(() => undefined);
    if (!lockStat || Date.now() - lockStat.mtimeMs < STALE_LOCK_AGE_MS) {
        return false;
    }
    let pid: unknown;
    try {
        pid = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")).pid;
    } catch {
        return true;
    }
    if (!Number.isInteger(pid) || (pid as number) <= 0) {
        return true;
    }
    try {
        process.kill(pid as number, 0);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
}

/**
 * Acquires a Baseline save lock, recovering only old locks with no live owner.
 * @param lock Lock directory path.
 * @returns Nothing.
 */
async function acquireSaveLock(lock: string): Promise<void> {
    const recoveryLock = `${lock}.recovery`;
    try {
        await mkdir(recoveryLock);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await isStaleLock(recoveryLock))) {
            throw new Error("Baseline save is already in progress");
        }
        await rm(recoveryLock, { recursive: true, force: true });
        try {
            await mkdir(recoveryLock);
        } catch (recoveryError) {
            if ((recoveryError as NodeJS.ErrnoException).code === "EEXIST") {
                throw new Error("Baseline save is already in progress");
            }
            throw recoveryError;
        }
    }
    let createdLock = false;
    try {
        await writeFile(join(recoveryLock, "owner.json"), JSON.stringify({ pid: process.pid }), { flag: "wx" });
        try {
            await mkdir(lock);
            createdLock = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await isStaleLock(lock))) {
                throw new Error("Baseline save is already in progress");
            }
            await rm(lock, { recursive: true, force: true });
            try {
                await mkdir(lock);
                createdLock = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                    throw new Error("Baseline save is already in progress");
                }
                throw error;
            }
        }
        await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { flag: "wx" });
    } catch (error) {
        if (createdLock) {
            await rm(lock, { recursive: true, force: true });
        }
        throw error;
    } finally {
        await rm(recoveryLock, { recursive: true, force: true });
    }
}

/**
 * Resolves a single saved FLA identity from Capture metadata.
 * @param captures Captures returned for this tool call.
 * @returns The private normalized URI and display name.
 */
function documentIdentity(captures: Capture[]): DocumentIdentity {
    const uris = captures.map(({ pathURI }) => pathURI);
    if (uris.some((pathURI) => !pathURI) || uris.some((pathURI) => pathURI !== uris[0])) {
        throw new Error("Capture set must have one saved document identity");
    }
    try {
        const uri = new URL(uris[0] as string);
        if (
            uri.protocol !== "file:" ||
            (uri.hostname !== "" && uri.hostname !== "localhost") ||
            uri.search ||
            uri.hash ||
            !uri.pathname.toLowerCase().endsWith(".fla")
        ) {
            throw new Error();
        }
        const name = basename(decodeURIComponent(uri.pathname)).replace(/\.fla$/i, "");
        if (!name) {
            throw new Error();
        }
        return { pathURI: uri.href, name };
    } catch {
        throw new Error("Capture set has an invalid or ambiguous saved document identity");
    }
}

/**
 * Saves captures as a Baseline using a lock and staged replacement.
 * @param context Validated paths and capture metadata.
 * @returns Baseline metadata.
 */
async function saveBaseline(
    context: BaselineContext & { overwrite?: boolean },
): Promise<{ data: { action: "save"; name: string; document: string; captures: CaptureMetadata[] } }> {
    const { name, identity, documentId, target, documentDir, captures, docPaths, capturesMeta, overwrite } = context;
    const lock = join(documentDir, `.${name}.lock`);
    await acquireSaveLock(lock).catch((error) => {
        if (error instanceof Error && error.message === "Baseline save is already in progress") {
            throw new Error(`Baseline save is already in progress: ${name}`);
        }
        throw error;
    });
    try {
        const exists = await access(target).then(
            () => true,
            () => false,
        );
        if (exists && !overwrite) {
            throw new Error(`Baseline already exists: ${name}; set overwrite: true to replace it`);
        }
        const stage = join(documentDir, `.${name}.tmp-${randomUUID()}`);
        const backup = join(documentDir, `.${name}.old-${randomUUID()}`);
        await mkdir(stage);
        try {
            for (let i = 0; i < captures.length; i++) {
                await writeFile(join(stage, `${captures[i].frame}.png`), await readFile(docPaths[i]), {
                    flag: "wx",
                });
            }
            await writeFile(
                join(stage, "metadata.json"),
                JSON.stringify({ documentId, captures: capturesMeta } satisfies Baseline),
                { flag: "wx" },
            );
            let hadOld = false;
            try {
                await rename(target, backup);
                hadOld = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error;
                }
            }
            try {
                await rename(stage, target);
            } catch (error) {
                if (hadOld) {
                    await rename(backup, target);
                }
                throw error;
            }
            if (hadOld) {
                await rm(backup, { recursive: true, force: true });
            }
        } catch (error) {
            await rm(stage, { recursive: true, force: true });
            throw error;
        }
    } finally {
        await rm(lock, { recursive: true, force: true });
    }
    return { data: { action: "save", name, document: identity.name, captures: capturesMeta } };
}

/**
 * Compares captures with a saved Baseline and records failed diffs.
 * @param context Validated paths, capture metadata, and comparison thresholds.
 * @returns Comparison metadata and any failed diff images.
 */
async function compareBaseline(context: BaselineContext & { tolerance: number; maxChangedPercent: number }): Promise<{
    data: {
        action: "compare";
        name: string;
        document: string;
        passed: boolean;
        frames: Array<Record<string, unknown>>;
    };
    content: Array<{ type: "image"; data: string; mimeType: "image/png" } | { type: "text"; text: string }>;
}> {
    const { name, identity, documentId, target, documentDir, captures, docPaths, tolerance, maxChangedPercent } =
        context;
    const metadataPath = join(target, "metadata.json");
    let baseline: Baseline;
    try {
        const safeTarget = await realpath(target);
        const safeMetadata = await realpath(metadataPath);
        if (!isInside(documentDir, safeTarget) || !isInside(safeTarget, safeMetadata)) {
            throw new Error("Unsafe Baseline path");
        }
        baseline = JSON.parse(await readFile(safeMetadata, "utf8")) as Baseline;
    } catch {
        throw new Error(`Baseline not found: ${name}`);
    }
    if (baseline.documentId !== documentId) {
        throw new Error(`Baseline belongs to a different document: ${name}`);
    }
    const diffRoot = join(target, "diffs");
    await mkdir(diffRoot, { recursive: true });
    const safeDiffRoot = await realpath(diffRoot);
    if (!isInside(await realpath(target), safeDiffRoot)) {
        throw new Error("Unsafe Baseline path");
    }
    const frames = [];
    const content = [];
    for (let i = 0; i < captures.length; i++) {
        const capture = captures[i];
        const prior = baseline.captures.find(
            (item) => item.frame === capture.frame && item.timeline === capture.timeline,
        );
        if (!prior) {
            frames.push({ frame: capture.frame, passed: false, reason: "Baseline frame is missing" });
            continue;
        }
        if (prior.width !== capture.width || prior.height !== capture.height) {
            frames.push({
                frame: capture.frame,
                passed: false,
                reason: `Stage size differs: ${prior.width}x${prior.height} vs ${capture.width}x${capture.height}`,
            });
            continue;
        }
        const baselinePng = join(target, `${capture.frame}.png`);
        const safePng = await realpath(baselinePng).catch(() => {
            throw new Error(`Baseline frame is missing: ${capture.frame}`);
        });
        if (!isInside(await realpath(target), safePng)) {
            throw new Error("Unsafe Baseline path");
        }
        const before = decodePng(safePng, await readFile(safePng));
        const after = decodePng(docPaths[i], await readFile(docPaths[i]));
        if (before.width !== after.width || before.height !== after.height) {
            frames.push({
                frame: capture.frame,
                passed: false,
                reason: `Image dimensions differ: ${before.width}x${before.height} vs ${after.width}x${after.height}`,
            });
            continue;
        }
        const { diff, changedPixels, changedPercent } = comparePixels(before, after, tolerance);
        const passed = changedPercent <= maxChangedPercent;
        const bytes = PNG.sync.write(diff);
        let diffPath: string | undefined;
        if (!passed && changedPixels) {
            diffPath = join(safeDiffRoot, `${capture.frame}-${randomUUID()}.png`);
            await writeFile(diffPath, bytes, { flag: "wx" });
            content.push({
                type: "image" as const,
                data: bytes.toString("base64"),
                mimeType: "image/png" as const,
            });
        }
        frames.push({ frame: capture.frame, passed, changedPixels, changedPercent, diff: diffPath });
    }
    const passed = frames.length === captures.length && frames.every((item) => item.passed);
    const data = { action: "compare" as const, name, document: identity.name, passed, frames };
    content.push({ type: "text" as const, text: JSON.stringify(data) });
    return { data, content };
}

/**
 * Saves named frame captures as a Baseline or compares them with one.
 * @param args Validated tool arguments.
 * @param deps Tool dependencies.
 * @param _extra MCP callback metadata.
 * @returns Baseline metadata or comparison results.
 */
export const visualRegressionTool: ToolDefinition<typeof INPUT> = {
    name: "visual_regression",
    description:
        "Save a named set of frame Captures as a Baseline or compare frames against one. Supports up to 24 frames; Baselines are stored under ~/.animate-mcp/baselines/.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: INPUT,
    guidance: {
        basic: "- Save a named Baseline, then compare the same timeline and frames later. Saving over an existing Baseline requires overwrite: true.",
    },
    run: async (args: Parameters<ToolCallback<typeof INPUT>>[0], deps: ToolDeps) => {
        const { action, name, frame, range } = args;
        if (action === "save" && (args.tolerance !== undefined || args.maxChangedPercent !== undefined)) {
            throw new Error("tolerance and maxChangedPercent are only valid for compare");
        }
        if (action === "compare" && args.overwrite !== undefined) {
            throw new Error("overwrite is only valid for save");
        }
        if (frame !== undefined && range !== undefined) {
            throw new Error("Specify either frame or range, not both");
        }
        if (range && Math.floor((range.end - range.start) / (range.step ?? 1)) + 1 > 24) {
            throw new Error("Capture range cannot exceed 24 frames");
        }
        const captureRoot = capturesDir();
        const baselineRoot = baselinesDir();
        const result = await deps.jsfl.run(
            "output/capture-frame",
            {
                __captureFrame: frame ?? null,
                __captureRange: range ?? null,
                __captureDir: "",
                __captureIncludeDocumentURI: true,
                __captureRoot: captureRoot,
            },
            CAPTURE_RESPONSE,
        );
        const captures = "captures" in result ? result.captures : [result];
        if (!captures.length || captures.length > 24) {
            throw new Error("Capture range cannot exceed 24 frames");
        }
        const root = await realpath(captureRoot).catch(() => {
            throw new Error("Capture directory does not exist");
        });
        const docPaths = await Promise.all(
            captures.map(async (capture) => {
                const path = await realpath(capture.path).catch(() => {
                    throw new Error(`Cannot read Capture PNG: ${capture.path}`);
                });
                if (!isInside(root, path) || !path.toLowerCase().endsWith(".png")) {
                    throw new Error("Capture path must be inside the Server capture directory");
                }
                return path;
            }),
        );
        const captureDocument = basename(relative(root, docPaths[0]).split(sep)[0]);
        if (
            !captureDocument ||
            captures.some(
                (_capture, index) => basename(relative(root, docPaths[index]).split(sep)[0]) !== captureDocument,
            )
        ) {
            throw new Error("Capture set must belong to one document");
        }
        if (captures.some(({ timeline }) => !timeline || timeline !== captures[0].timeline)) {
            throw new Error("Capture set must belong to one timeline");
        }
        const identity = documentIdentity(captures);
        const documentId = createHash("sha256").update(identity.pathURI).digest("hex").slice(0, 24);
        const documentDirName = `doc-${documentId}`;
        const target = join(baselineRoot, documentDirName, name);
        await mkdir(join(baselineRoot, documentDirName), { recursive: true });
        const managedRoot = await realpath(baselineRoot);
        const documentDir = await realpath(join(baselineRoot, documentDirName));
        if (!isInside(managedRoot, documentDir)) {
            throw new Error("Baseline path must remain inside the Server baseline directory");
        }
        const existingTarget = await realpath(target).catch(() => undefined);
        if (existingTarget && !isInside(documentDir, existingTarget)) {
            throw new Error("Baseline path must remain inside the Server baseline directory");
        }
        const capturesMeta = captures.map(({ frame: capturedFrame, timeline, width, height }) => ({
            frame: capturedFrame,
            timeline,
            width,
            height,
        }));
        const context = { name, identity, documentId, target, documentDir, captures, docPaths, capturesMeta };
        return action === "save"
            ? saveBaseline({ ...context, overwrite: args.overwrite })
            : compareBaseline({
                  ...context,
                  tolerance: args.tolerance ?? 8,
                  maxChangedPercent: args.maxChangedPercent ?? 0,
              });
    },
};

/**
 * Registers visual_regression with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies.
 * @returns Nothing.
 */
export function registerVisualRegression(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, visualRegressionTool, deps);
}
