import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { createRunner } from "../runner.js";
import { type Diagnostic, parseCompilerOutput } from "./publish.js";
import { failure } from "./shared.js";

type Runner = Pick<ReturnType<typeof createRunner>, "execute">;

const TEST_MOVIE_INPUT = {
    document: z.string().optional().describe("Saved AS3 document name; defaults to the only open document"),
};

/** Parses the length-prefixed panel text returned by read-output.jsfl.
 * @param result Encoded Compiler Errors availability and panel text
 * @returns Compiler Errors panel availability and raw Output/Compiler Errors text
 */
function parsePanelSnapshot(result: string) {
    let offset = 0;
    const compilerPanelAvailable = result.charAt(offset++) === "1";
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

/** Registers the test_movie tool.
 * @param server MCP server to register the tool with
 * @param deps Runner and JSFL bundle dependencies
 * @returns Nothing
 */
export function registerTestMovie(
    server: McpServer,
    deps: { runner: Runner; bundle: (...names: string[]) => string },
): void {
    const { runner, bundle } = deps;
    /** Runs Test Movie and returns compiler diagnostics and one Output panel delta.
     * @param document Optional document name to select
     * @returns Tool result containing the panel snapshot, or an MCP error result
     */
    const handleTestMovie: ToolCallback<typeof TEST_MOVIE_INPUT> = async ({ document }) => {
        try {
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
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, startedAt + 2000 - Date.now())));

            const after = parsePanelSnapshot(String(await runner.execute(`${panelPrelude}${bundle("read-output")}`)));
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
                runtimeOutput: after.outputPanel.startsWith(before.outputPanel)
                    ? after.outputPanel.slice(before.outputPanel.length)
                    : after.outputPanel,
                compilerErrorsPanel: after.compilerErrorsPanel,
                compilerDiagnostics,
                note: "Runtime output is a single snapshot taken two seconds after Test Movie starts; later output may be missed, concurrent Output-panel messages may be mixed in, and an empty delta does not prove that no runtime errors occurred. An unavailable compilerDiagnostics status does not mean a clean compile. Any Test Movie Player remains open for you to close.",
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response) }],
                structuredContent: response,
            };
        } catch (error) {
            return failure(error);
        }
    };

    server.registerTool(
        "test_movie",
        {
            description:
                "Run a saved AS3 document in Test Movie with abort-on-compiler-errors enabled, using its current in-memory contents (the .fla is never saved, published, or closed). Any Test Movie Player remains open for you to close. Compiler Errors raw text and parsed diagnostics are separate from a single Output-panel delta captured once two seconds after launch; later output may be missed, concurrent messages may be mixed in, and an empty delta does not prove there were no runtime errors. compilerDiagnostics.status: unavailable does not prove a clean compile.",
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            inputSchema: TEST_MOVIE_INPUT,
        },
        handleTestMovie,
    );
}
