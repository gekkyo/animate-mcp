import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerGetStatus } from "../dist/tools/document/get-status.js";
import { toolHandler } from "./smoke/lib/smoke-lib.mjs";

const execFileAsync = promisify(execFile);
const status = toolHandler(registerGetStatus);

/** Reads Animate process identities and its MCP-reported document state.
 * @returns Animate process and document snapshot, or a reason it is unavailable.
 */
export async function readAnimateState() {
    if (process.platform !== "darwin") {
        return { running: false, reason: "Real-Animate verification requires macOS." };
    }

    const pattern =
        process.env.ANIMATE_MCP_PROCESS_PATTERN ?? "Adobe Animate [0-9]{4}\\.app/Contents/MacOS/Adobe Animate";
    let processIds;
    try {
        const { stdout } = await execFileAsync("pgrep", ["-f", pattern], { maxBuffer: 4096 });
        processIds = stdout.trim().split(/\s+/).filter(Boolean).sort();
    } catch (error) {
        if (error.code === 1) {
            return { running: false, reason: "Adobe Animate is not running." };
        }
        return { running: false, reason: `Could not inspect Animate processes: ${error.message}` };
    }
    if (!processIds.length) {
        return { running: false, reason: "Adobe Animate is not running." };
    }

    try {
        const result = await status({});
        const state = result.structuredContent;
        if (result.isError || state?.animate !== "responding") {
            return { running: true, responding: false, processIds, reason: "Animate is not responding to get_status." };
        }
        const documents = (state.documents ?? []).map(({ name, path }) => `${name ?? ""}\t${path ?? ""}`).sort();
        return { running: true, responding: true, processIds, documents };
    } catch (error) {
        return {
            running: true,
            responding: false,
            processIds,
            reason: `Animate status check failed: ${error.message}`,
        };
    }
}
