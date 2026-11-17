// Disposable real-Animate smoke runner (not in CI): `npm run build && node server/verification/smoke/scenarios/smoke-run.mjs steps.json`.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { TOOLS } from "../../../dist/index.js";
import { isAnimateRunning } from "../../../dist/runtime/animate-launcher.js";
import { createToolRegistry } from "../../../dist/tools/core/registry.js";
import { closeDocumentByPath, createSavedAs3Document, toolHandler } from "../lib/smoke-lib.mjs";

/** Prints command usage.
 * @returns Nothing.
 */
function usage() {
    console.error("Usage: node server/verification/smoke/scenarios/smoke-run.mjs [--entrances] <steps.json>");
    process.exitCode = 2;
}

/** Reads and validates the ordered smoke steps from disk.
 * @param stepsPath Path to the JSON steps file.
 * @returns Ordered tool-call steps.
 */
async function readSteps(stepsPath) {
    const steps = JSON.parse(await readFile(stepsPath, "utf8"));
    if (
        !Array.isArray(steps) ||
        steps.some(
            (step) =>
                !step ||
                typeof step !== "object" ||
                typeof step.tool !== "string" ||
                (step.args !== undefined &&
                    (!step.args || typeof step.args !== "object" || Array.isArray(step.args))) ||
                (step.expectError !== undefined && typeof step.expectError !== "boolean"),
        )
    ) {
        throw new Error("Steps must be an array of { tool, args?, expectError? } objects");
    }
    return steps;
}

const entrances = process.argv[2] === "--entrances";
const stepsPath = process.argv[entrances ? 3 : 2];

if (!stepsPath || process.argv.length > (entrances ? 4 : 3)) {
    usage();
} else {
    const steps = await readSteps(stepsPath);
    if (entrances && steps.some((step) => step.tool === "run_jsfl")) {
        throw new Error("run_jsfl is direct-only and cannot be used with --entrances");
    }
    if (!(await isAnimateRunning())) {
        throw new Error("Animate must already be running; refusing to launch it");
    }

    const handlers = new Map(TOOLS.map((tool) => [tool.name, toolHandler(createToolRegistry([tool]).register)]));
    const runJsfl = handlers.get("run_jsfl");
    const outDir = await mkdtemp(join(tmpdir(), "animate-mcp-smoke-run-"));
    const flaPath = join(outDir, `${basename(outDir)}.fla`);
    let disposable;
    let failed = false;

    try {
        disposable = await createSavedAs3Document(runJsfl, pathToFileURL(flaPath).href, "");
        for (const [index, step] of steps.entries()) {
            const handler = handlers.get(step.tool);
            if (!handler) {
                throw new Error(`Unknown MCP tool at step ${index + 1}: ${step.tool}`);
            }
            const args = { ...(step.args ?? {}) };
            if (
                Object.hasOwn(args, "document") &&
                args.document !== disposable.name &&
                args.document !== disposable.pathURI
            ) {
                throw new Error(`Step ${index + 1} document must identify only the disposable document`);
            }
            args.document ??= disposable.name;
            const result = await handler(args);
            console.log(
                JSON.stringify({
                    tool: step.tool,
                    structuredContent: result.structuredContent,
                    text: result.content?.filter((item) => item.type === "text").map((item) => item.text),
                    isError: result.isError === true,
                }),
            );
            if (result.isError === true && step.expectError !== true) {
                failed = true;
            }
        }
    } finally {
        try {
            if (disposable?.pathURI) {
                await closeDocumentByPath(runJsfl, disposable.pathURI);
            }
        } finally {
            await rm(outDir, { recursive: true, force: true });
        }
    }

    if (failed) {
        process.exitCode = 1;
    }
}
