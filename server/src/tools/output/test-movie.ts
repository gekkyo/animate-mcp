import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerToolDefinition, type ToolDefinition, type ToolDeps } from "../core/shared.js";
import { type Diagnostic, parseCompilerOutput } from "./publish.js";

const TEST_MOVIE_INPUT = {
    document: z.string().optional().describe("Saved AS3 document name; defaults to the only open document"),
};
const FIRST_OUTPUT_SNAPSHOT_MS = 2_000;
const OUTPUT_POLL_INTERVAL_MS = 500;
const OUTPUT_MAX_WAIT_MS = 6_000;
const FINAL_EMPTY_OUTPUT_GRACE_MS = 2_000;
const STABLE_OUTPUT_READS = 2;

/** Parses the length-prefixed panel text returned by read-output.jsfl.
 * @param result Encoded Compiler Errors availability and panel text
 * @returns Compiler Errors panel availability and raw Output/Compiler Errors text
 */
function parsePanelSnapshot(result: string) {
    let offset = 0;
    const compilerPanelAvailable = result.charAt(offset++) === "1";
    /**
     * Reads one length-prefixed field from the encoded panel snapshot.
     * @returns The next decoded panel string.
     */
    const readField = () => {
        const separator = result.indexOf(":", offset);
        if (separator < 0 || !/^\d+$/.test(result.slice(offset, separator))) {
            throw new Error("Animate returned an invalid test_movie panel result");
        }
        const length = Number(result.slice(offset, separator));
        offset = separator + 1;
        const field = result.slice(offset, offset + length);
        if (field.length !== length) {
            throw new Error("Animate returned an invalid test_movie panel result");
        }
        offset += length;
        return field;
    };
    const outputPanel = readField();
    const compilerErrorsPanel = readField();
    if (offset !== result.length) {
        throw new Error("Animate returned an invalid test_movie panel result");
    }
    return { compilerPanelAvailable, outputPanel, compilerErrorsPanel };
}

/**
 * Returns output appended since the initial panel snapshot, or the full text after a reset.
 * @param before Initial Output-panel text.
 * @param after Latest Output-panel text.
 * @returns The delta, or the full text if the panel prefix changed.
 */
function outputPanelDelta(before: string, after: string): string {
    return after.startsWith(before) ? after.slice(before.length) : after;
}

/** Checks whether a valid Compiler Errors snapshot confirms launch was blocked.
 * @param snapshot Parsed panel snapshot.
 * @returns Whether compilation errors are present.
 */
function hasCompilerErrors(snapshot: ReturnType<typeof parsePanelSnapshot>): boolean {
    try {
        return snapshot.compilerPanelAvailable && parseCompilerOutput(snapshot.compilerErrorsPanel).errors.length > 0;
    } catch {
        return false;
    }
}

export const testMovieTool: ToolDefinition<typeof TEST_MOVIE_INPUT> = {
    name: "test_movie",
    description:
        "Run a saved AS3 document in Test Movie with abort-on-compiler-errors enabled, using its current in-memory contents (the .fla is never saved, published, or closed). Any Test Movie Player remains open for you to close. Compiler Errors raw text and parsed diagnostics are separate from the Output-panel delta; polling starts two seconds after launch and repeats every 500 ms until non-empty output is unchanged across two consecutive reads, or six seconds after launch. If still empty, it waits a final two-second Player startup grace and takes one last snapshot. Polling stops after the first snapshot if compilation errors prevent launch. Concurrent messages may be mixed in, and an empty delta does not prove there were no runtime errors. compilerDiagnostics.status: unavailable does not prove a clean compile.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: TEST_MOVIE_INPUT,
    guidance: {},
    /**
     * Runs Test Movie and polls its output panels after launch.
     * @param document Optional saved AS3 document selector.
     * @param deps Tool dependencies for executing Animate commands.
     * @returns Runtime output, compiler panel text, and parsed diagnostics when available.
     */
    run: async ({ document }: Parameters<ToolCallback<typeof TEST_MOVIE_INPUT>>[0], deps: ToolDeps) => {
        const { runner, bundle } = deps;

        const id = randomUUID();
        const outputPath = join(tmpdir(), `animate-mcp-test-movie-${id}-output.txt`);
        const compilerPath = join(tmpdir(), `animate-mcp-test-movie-${id}-compiler-errors.txt`);
        const prelude = `var __docName = ${JSON.stringify(document ?? "")};\n`;
        const panelPrelude = `var __readOutputPath = ${JSON.stringify(outputPath)};\nvar __readCompilerPath = ${JSON.stringify(compilerPath)};\n`;
        const validate = `if (document.type !== "Flash" || String(document.asVersion).indexOf("3") < 0) throw new Error("test_movie supports AS3 documents only");\n  if (!document.pathURI) throw new Error("Document is not saved; save first");`;
        // Animate applies setActiveWindow only after the Run returns; the next Run snapshots panels and launches.
        await runner.execute(
            `${prelude}${bundle("select-document")}\n(function () {\n  var document = selectDocument();\n  ${validate}\n  fl.setActiveWindow(document);\n})()`,
        );

        const launchResult = String(
            await runner.execute(
                `${prelude}${panelPrelude}${bundle("select-document")}\n(function () {\n  var document = selectDocument();\n  ${validate}\n  var before = ${bundle("read-output")};\n  var startedAt = ${bundle("test-movie")};\n  return String(startedAt) + "|" + before;\n})()`,
            ),
        );
        const separator = launchResult.indexOf("|");
        if (separator < 0) {
            throw new Error("Animate returned an invalid test_movie launch result");
        }
        const startedAt = Number(launchResult.slice(0, separator));
        const before = parsePanelSnapshot(launchResult.slice(separator + 1));
        if (!Number.isFinite(startedAt) || startedAt <= 0) {
            throw new Error("Animate returned an invalid test_movie start time");
        }
        /** Reads the latest Output and Compiler Errors panel snapshot.
         * @returns Parsed panel snapshot.
         */
        const readPanels = async () =>
            parsePanelSnapshot(String(await runner.execute(`${panelPrelude}${bundle("read-output")}`)));
        await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, startedAt + FIRST_OUTPUT_SNAPSHOT_MS - Date.now())),
        );
        let after = await readPanels();
        let runtimeOutput = outputPanelDelta(before.outputPanel, after.outputPanel);
        let stableReads = runtimeOutput ? 1 : 0;
        const deadline = startedAt + OUTPUT_MAX_WAIT_MS;
        while (stableReads < STABLE_OUTPUT_READS && Date.now() < deadline && !hasCompilerErrors(after)) {
            await new Promise((resolve) =>
                setTimeout(resolve, Math.max(0, Math.min(OUTPUT_POLL_INTERVAL_MS, deadline - Date.now()))),
            );
            after = await readPanels();
            const nextOutput = outputPanelDelta(before.outputPanel, after.outputPanel);
            if (!nextOutput) {
                stableReads = 0;
            } else if (nextOutput === runtimeOutput) {
                stableReads += 1;
            } else {
                stableReads = 1;
            }
            runtimeOutput = nextOutput;
        }
        if (!runtimeOutput && !hasCompilerErrors(after) && Date.now() >= deadline) {
            await new Promise((resolve) => setTimeout(resolve, FINAL_EMPTY_OUTPUT_GRACE_MS));
            after = await readPanels();
            runtimeOutput = outputPanelDelta(before.outputPanel, after.outputPanel);
        }
        let compilerDiagnostics: {
            status: "parsed" | "unavailable";
            errors: Diagnostic[];
            warnings: Diagnostic[];
        };
        try {
            if (!after.compilerPanelAvailable) {
                throw new Error("Compiler Errors panel unavailable");
            }
            compilerDiagnostics = { status: "parsed", ...parseCompilerOutput(after.compilerErrorsPanel) };
        } catch {
            compilerDiagnostics = { status: "unavailable", errors: [], warnings: [] };
        }
        const response = {
            runtimeOutput,
            compilerErrorsPanel: after.compilerErrorsPanel,
            compilerDiagnostics,
            note: "Output polling starts two seconds after Test Movie starts and repeats every 500 ms until non-empty output is unchanged across two consecutive reads, stopping by six seconds after launch. If still empty, a final Output-panel snapshot follows a two-second Player startup grace. Polling stops after the first snapshot if compilation errors prevent launch. Concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
        };
        return { data: response };
    },
};

/**
 * Registers the test_movie tool with the MCP server.
 * @param server MCP server to register with.
 * @param deps Tool dependencies used by the tool.
 */
export function registerTestMovie(server: McpServer, deps: ToolDeps): void {
    registerToolDefinition(server, testMovieTool, deps);
}
