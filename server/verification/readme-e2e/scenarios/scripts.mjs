import assert from "node:assert/strict";
import { investigationScript } from "./scenarios.mjs";

/** Requires export, a write to its existing script, and a successful apply in order.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulScriptEdit(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const relevant = entries.filter(({ targetTool }) =>
        ["export_scripts", "write_export_script", "apply_scripts"].includes(targetTool),
    );
    assert.deepEqual(
        relevant.map(({ targetTool, succeeded }) => [targetTool, succeeded]),
        [
            ["export_scripts", true],
            ["write_export_script", true],
            ["apply_scripts", true],
        ],
        "Expected successful export → write_export_script → apply_scripts sequence",
    );
}

/** Requires a successful script export and read, with no tools outside the read-only workflow.
 * @param trace JSONL tool trace.
 */
export function assertSuccessfulScriptInvestigation(trace) {
    const entries = trace
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(entries.length > 0, "No script investigation tools were traced");
    assert.ok(
        entries.every(({ targetTool }) => ["get_status", "export_scripts", "read_export_file"].includes(targetTool)),
        "A tool outside the read-only script workflow was traced",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "export_scripts" && succeeded),
        "Claude did not successfully export scripts",
    );
    assert.ok(
        entries.some(({ targetTool, succeeded }) => targetTool === "read_export_file" && succeeded),
        "Claude did not successfully read the exported frame script",
    );
}

/** Requires a meaningful diagnosis tied to the deliberately malformed fixture.
 * @param result Claude's parsed final result, held in memory only.
 */
export function assertScriptInvestigationReply(result) {
    assert.equal(typeof result, "string", "Claude final result is missing");
    assert.ok(/readmeTotal/.test(result), "Claude final result did not identify the fixture script");
    assert.ok(
        /閉じ.*括弧|missing.*closing parenthes|missing.*\)|expected.*\)|unclosed parenthes/i.test(result),
        "Claude final result did not identify the missing closing parenthesis",
    );
}

/** Reads back frame one from the sole exact disposable document using read-only JSFL.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function assertScriptInDocument(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (
        result.isError ||
        typeof source !== "string" ||
        !source.includes('trace("readme initial");') ||
        !/\bstop\s*\(\s*\)\s*;?/.test(source)
    ) {
        throw new Error("Trusted frame-one script verification failed");
    }
}

/** Reads the exact frame-one source without exposing it in logs or traces.
 * @param runJsfl JSFL tool handler.
 * @param status Status tool handler.
 * @param pathURI Exact disposable document URI.
 * @returns Frame-one ActionScript source.
 */
export async function readInvestigationScript(runJsfl, status, pathURI) {
    const documents = (await status({})).structuredContent?.documents ?? [];
    if (documents.length !== 1 || documents[0].path !== pathURI) {
        throw new Error("Safety check failed: the disposable FLA is not the only open document.");
    }
    const result = await runJsfl({
        code: `(function () { var doc = null; if (fl.documents.length !== 1) throw new Error("Document scope changed"); for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc) throw new Error("Disposable document not found"); return String(doc.getTimeline().layers[0].frames[0].actionScript || ""); })()`,
    });
    const source = result.structuredContent?.result;
    if (result.isError || typeof source !== "string") {
        throw new Error("Trusted frame-one script verification failed");
    }
    return source;
}

/** Sets a deliberately malformed but syntactically valid JSFL string as frame-one ActionScript.
 * @param runJsfl run_jsfl tool handler.
 * @param pathURI Exact disposable document URI.
 */
export async function createInvestigationScriptFixture(runJsfl, pathURI) {
    const result = await runJsfl({
        code: `(function () { var doc = null; if (fl.documents.length !== 1) throw new Error("Expected only the disposable FLA open"); for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].pathURI === ${JSON.stringify(pathURI)}) doc = fl.documents[i]; if (!doc || doc.type !== "Flash" || String(doc.asVersion).indexOf("3") < 0) throw new Error("Disposable AS3 document not found"); var frame = doc.getTimeline().layers[0].frames[0]; frame.actionScript = ${JSON.stringify(investigationScript)}; return String(frame.actionScript); })()`,
    });
    if (result.isError || result.structuredContent?.result !== investigationScript) {
        throw new Error("Could not create the malformed AS3 script fixture");
    }
}

/** Prepares a malformed script fixture for a read-only investigation.
 * @param scenario Selected scenario name.
 * @param context Fixture setup dependencies.
 * @param state Mutable scenario-specific state.
 */
export async function prepareScriptsScenario(scenario, context, state) {
    if (scenario !== "investigate") {
        return;
    }
    await createInvestigationScriptFixture(context.runJsfl, context.pathURI);
    state.investigationBefore = await readInvestigationScript(context.runJsfl, context.status, context.pathURI);
    if (state.investigationBefore !== investigationScript) {
        throw new Error("Malformed AS3 script fixture did not read back exactly");
    }
}

/** Validates a scripts scenario's tool trace and trusted readback.
 * @param scenario Selected scenario name.
 * @param context Scenario run inputs and Animate handlers.
 */
export async function verifyScriptsScenario(scenario, context) {
    const { trace, claudeResult, runJsfl, status, pathURI, state } = context;
    if (scenario === "script") {
        assertSuccessfulScriptEdit(trace);
        await assertScriptInDocument(runJsfl, status, pathURI);
    } else if (scenario === "investigate") {
        assertSuccessfulScriptInvestigation(trace);
        assertScriptInvestigationReply(claudeResult);
        if ((await readInvestigationScript(runJsfl, status, pathURI)) !== state.investigationBefore) {
            throw new Error("Read-only script investigation changed the frame-one script");
        }
    }
}

/** Verifies the scripts scenario after save and reopen.
 * @param scenario Selected scenario name.
 * @param context Reopened document dependencies.
 */
export async function verifyScriptsPersistence(scenario, context) {
    const { runJsfl, status, pathURI, state } = context;
    if (scenario === "script") {
        await assertScriptInDocument(runJsfl, status, pathURI);
    } else if (
        scenario === "investigate" &&
        (await readInvestigationScript(runJsfl, status, pathURI)) !== state.investigationBefore
    ) {
        throw new Error("Frame-one script changed after investigation or publish/reopen");
    }
}

/** Returns the completion message for a scripts scenario.
 * @param scenario Selected scenario name.
 * @returns Completion message.
 */
export function scriptsScenarioMessage(scenario) {
    if (scenario === "script") {
        return "PASS: export_scripts → script edit → apply_scripts succeeded; frame-one script persisted after save and reopen.";
    }
    if (scenario === "investigate") {
        return "PASS: exported and read the malformed frame-one AS3 script; its source was unchanged after save and reopen.";
    }
    return "";
}
