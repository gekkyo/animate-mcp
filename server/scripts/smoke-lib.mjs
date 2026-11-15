// Shared setup for real-Animate smoke scripts (not in CI). Run `npm run build` first.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAnimateRunning, launcher } from "../dist/runtime/animate-launcher.js";
import { bundle } from "../dist/runtime/jsfl-bundle.js";
import { createRunner } from "../dist/runtime/runner.js";

const execFileAsync = promisify(execFile);
const MODAL_QUERY = `tell application "System Events"
    set animateProcesses to every application process whose name contains "Animate"
    if (count of animateProcesses) is 0 then return "UNKNOWN"
    repeat with animateProcess in animateProcesses
        tell animateProcess
            repeat with targetWindow in windows
                if subrole of targetWindow is "AXDialog" then return "MODAL"
                if (count of sheets of targetWindow) > 0 then return "MODAL"
            end repeat
        end tell
    end repeat
    return "CLEAR"
end tell`;

async function inspectAnimateModal() {
    if (process.platform !== "darwin") {
        return { state: "unavailable", reason: "macOS System Events is unavailable on this platform" };
    }
    try {
        const { stdout } = await execFileAsync("osascript", ["-e", MODAL_QUERY], { timeout: 3000, maxBuffer: 4096 });
        switch (stdout.trim()) {
            case "MODAL":
                return { state: "modal" };
            case "CLEAR":
                return { state: "clear" };
            case "UNKNOWN":
                return { state: "unknown" };
            default:
                return { state: "unavailable", reason: "osascript returned an unexpected response" };
        }
    } catch (error) {
        const reason =
            error?.code === "ETIMEDOUT"
                ? "osascript timed out after 3000 ms"
                : String(error?.stderr || error?.message || error)
                      .trim()
                      .slice(0, 400) || "osascript failed";
        return { state: "unavailable", reason };
    }
}

function modalHint(diagnostic) {
    switch (diagnostic?.state) {
        case "modal":
            return "Animate modal diagnostic: a dialog or sheet was detected; close it manually and retry.";
        case "clear":
            return "Animate modal diagnostic: no dialog or sheet was detected.";
        case "unknown":
            return "Animate modal diagnostic: state unknown (no matching Animate process was found).";
        case "unavailable":
            return `Animate modal diagnostic unavailable: ${diagnostic.reason}`;
        default:
            return "Animate modal diagnostic unavailable: the state could not be determined.";
    }
}

/** Creates and saves a disposable AS3 document (Test Movie and publish need a saved path).
 * @param runJsfl run_jsfl tool handler
 * @param fileUri file:/// URI of the .fla to create, under a temp dir
 * @param actionScript frame-1 script
 * @returns {Promise<{ name: string, pathURI: string }>} pathURI is Animate's normalized URI (`/Macintosh%20HD` prefix on macOS)
 */
export async function createSavedAs3Document(runJsfl, fileUri, actionScript) {
    const result = await runJsfl({
        code: `(function () { var doc = null, created = false, existing = []; for (var i = 0; i < fl.documents.length; i++) existing.push(fl.documents[i]); try { fl.createDocument("timeline", 550, 400, 24); doc = fl.getDocumentDOM(); var wasExisting = false; for (var j = 0; j < existing.length; j++) if (existing[j] === doc) wasExisting = true; if (!doc || wasExisting) throw new Error("Animate did not create a new document"); created = true; if (doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Created document is not AS3"); doc.getTimeline().layers[0].frames[0].actionScript = ${JSON.stringify(actionScript)}; if (fl.saveDocument(doc, ${JSON.stringify(fileUri)}) !== true) throw new Error("fl.saveDocument returned false"); if (!doc.name || !doc.pathURI) throw new Error("Saved document has no name or pathURI"); return doc.name + "\\t" + doc.pathURI; } catch (error) { if (created) { try { doc.close(false); } catch (cleanupError) { throw new Error(String(error) + "; closing disposable document also failed: " + String(cleanupError)); } } throw error; } })()`,
    });
    if (result.isError) {
        throw new Error(result.content?.[0]?.text ?? "run_jsfl failed");
    }
    const value = result.structuredContent?.result;
    if (typeof value !== "string") {
        throw new Error("Could not read saved document details from Animate");
    }
    const separator = value.indexOf("\t");
    const name = value.slice(0, separator);
    const pathURI = value.slice(separator + 1);
    if (separator < 1 || !pathURI) {
        throw new Error("Animate returned invalid saved document details");
    }
    return { name, pathURI };
}

/** Closes only the document with this exact pathURI, discarding edits; never touches other documents.
 * @param runJsfl run_jsfl tool handler
 * @param pathURI URI returned by createSavedAs3Document
 */
export async function closeDocumentByPath(runJsfl, pathURI) {
    if (typeof pathURI !== "string" || !pathURI) {
        throw new Error("A document pathURI is required for cleanup");
    }
    const result = await runJsfl({
        code: `(function () { var hits = []; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) hits.push(fl.documents[i]); if (hits.length !== 1) throw new Error("Expected exactly one disposable document at pathURI; found " + hits.length); hits[0].close(false); for (var j = 0; j < fl.documents.length; j++) if (fl.documents[j].pathURI === ${JSON.stringify(pathURI)}) throw new Error("Disposable document remained open after close"); return true; })()`,
    });
    if (result.isError) {
        throw new Error(result.content?.[0]?.text ?? "run_jsfl failed while closing disposable document");
    }
    if (result.structuredContent?.result !== true) {
        throw new Error("Animate did not confirm disposable document cleanup");
    }
}

export function toolHandler(register, checkModal = inspectAnimateModal) {
    const runner = createRunner({
        dir: `${process.env.HOME}/.animate-mcp/runs`,
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: 120000,
    });
    let handle;
    register({ registerTool: (_name, _config, callback) => (handle = callback) }, { runner, bundle });
    return async (...args) => {
        const result = await handle(...args);
        const errorText = result?.content?.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
        if (
            !result?.isError ||
            !/^Run timed out after \d+ ms \(Animate did not run the \.jsfl; on Windows check that \.jsfl files are associated with Animate, or set ANIMATE_MCP_LAUNCH_COMMAND\)$/.test(
                errorText ?? "",
            )
        ) {
            return result;
        }

        let hint;
        try {
            hint = modalHint(await checkModal());
        } catch (error) {
            hint = `Animate modal diagnostic unavailable: ${String(error?.message || error).slice(0, 400)}`;
        }
        const content = Array.isArray(result.content) ? [...result.content] : [];
        const firstTextIndex = content.findIndex((item) => item?.type === "text" && typeof item.text === "string");
        if (firstTextIndex >= 0) {
            const firstText = content[firstTextIndex];
            content[firstTextIndex] = { ...firstText, text: `${firstText.text}\n${hint}` };
        } else {
            content.push({ type: "text", text: hint });
        }
        return { ...result, content };
    };
}
