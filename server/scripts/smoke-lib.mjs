// Shared setup for real-Animate smoke scripts (not in CI). Run `npm run build` first.
import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let client;
let clientTransport;
let connecting;

/** Keeps stdio handles alive only while an MCP request is pending.
 * @param ref Whether to reference or unreference the child process handles.
 */
function refClientProcess(ref) {
    const method = ref ? "ref" : "unref";
    clientTransport?._process?.[method]();
    clientTransport?._process?.stdin?._handle?.[method]();
    clientTransport?._process?.stdout?._handle?.[method]();
}
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

/** Checks macOS accessibility state for an Animate modal dialog or sheet.
 * @returns Promise resolving to modal state and optional diagnostic reason.
 */
async function inspectAnimateModal() {
    if (process.platform !== "darwin") {
        return { state: "unavailable", reason: "macOS System Events is unavailable on this platform" };
    }
    try {
        // Bound the accessibility probe so a stalled System Events query cannot hang a smoke run.
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

/** Formats a human-readable hint from the Animate modal diagnostic.
 * @param diagnostic Modal state returned by inspectAnimateModal.
 * @returns Diagnostic hint text.
 */
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

/** Creates and saves a disposable AS3 document for saved-path smoke operations.
 * @param runJsfl run_jsfl tool handler.
 * @param fileUri file URI where the temporary FLA will be saved.
 * @param actionScript Frame-one ActionScript source.
 * @returns Promise resolving to the document name and normalized path URI.
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

/** Closes only the document with this exact path URI, discarding edits.
 * @param runJsfl run_jsfl tool handler.
 * @param pathURI Exact URI of the disposable document.
 * @returns Promise resolving when Animate confirms the document is closed.
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

/** Starts the shared production MCP client on its first request.
 * @returns Promise resolving to the connected MCP client.
 */
function getClient() {
    if (!connecting) {
        client = new Client({ name: "animate-mcp-smoke", version: "1.0.0" });
        clientTransport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env });
        connecting = client.connect(clientTransport).then(() => {
            refClientProcess(false);
            return client;
        });
        process.once("beforeExit", () => {
            void client?.close();
        });
    }
    return connecting.then(() => client);
}

/** Replaces HOME in string values before recording smoke arguments.
 * @param value Value to sanitize.
 * @returns Sanitized value.
 */
function sanitizeArguments(value) {
    if (typeof value === "string") {
        return process.env.HOME ? value.replaceAll(process.env.HOME, `\${HOME}`) : value;
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeArguments);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeArguments(item)]));
    }
    return value;
}

/** Describes the value-free type shape of structured tool output.
 * @param value Structured output value.
 * @returns Type shape.
 */
function shapeOf(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return value.length ? [shapeOf(value[0])] : ["empty"];
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item)]));
    }
    return typeof value;
}

/** Appends a values-free result shape to the optional smoke recording directory.
 * @param tool Registered tool name.
 * @param args Tool arguments.
 * @param result MCP tool result.
 * @returns Promise resolving when the recording is written.
 */
async function recordResult(tool, args, result) {
    const directory = process.env.SMOKE_RECORD_DIR;
    if (!directory || result.isError) {
        return;
    }
    await mkdir(directory, { recursive: true });
    const entry = {
        tool,
        isError: result.isError ?? false,
        arguments: sanitizeArguments(args),
        shape: shapeOf(result.structuredContent),
    };
    await appendFile(join(directory, `${tool}.jsonl`), `${JSON.stringify(entry)}\n`);
}

/** Registers an Entrance-routed tool and augments timeout errors with modal diagnostics.
 * @param register Tool registration function.
 * @param checkModal Function that reports Animate modal state.
 * @param call Optional Entrance call implementation, primarily for tests.
 * @returns Async handler for the registered tool.
 */
export function toolHandler(register, checkModal = inspectAnimateModal, call) {
    let tool;
    let readOnly;
    register(
        {
            registerTool: (name, config) => {
                tool = name;
                readOnly = config.annotations?.readOnlyHint === true;
            },
        },
        {},
    );
    return async (args) => {
        let name = "execute_write";
        if (tool === "run_jsfl") {
            name = tool;
        } else if (readOnly) {
            name = "execute_readonly";
        }
        const requestArgs = tool === "run_jsfl" ? args : { name: tool, arguments: args };
        const invoke =
            call ??
            (async (entranceName, requestArguments) => {
                const client = await getClient();
                refClientProcess(true);
                try {
                    const result = await client.callTool(
                        { name: entranceName, arguments: requestArguments },
                        undefined,
                        { timeout: 130000 },
                    );
                    await recordResult(
                        tool,
                        tool === "run_jsfl" ? requestArguments : requestArguments.arguments,
                        result,
                    );
                    return result;
                } finally {
                    refClientProcess(false);
                }
            });
        const result = await invoke(name, requestArgs);
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
