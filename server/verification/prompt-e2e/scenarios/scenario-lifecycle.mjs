import {
    documentScenarioIsReadOnly,
    documentScenarioMessage,
    prepareDocumentScenario,
    verifyDocumentPersistence,
    verifyDocumentScenario,
} from "./document.mjs";
import {
    outputScenarioMessage,
    outputScenarioNeedsPlayerCleanup,
    outputScenarioRequiresChrome,
    prepareOutputScenario,
    verifyOutputPersistence,
    verifyOutputScenario,
} from "./output.mjs";
import {
    prepareScriptsScenario,
    scriptsScenarioMessage,
    verifyScriptsPersistence,
    verifyScriptsScenario,
} from "./scripts.mjs";
import {
    prepareTimelineScenario,
    timelineScenarioIsReadOnly,
    timelineScenarioMessage,
    verifyTimelinePersistence,
    verifyTimelineScenario,
} from "./timeline.mjs";

const timelineScenarios = new Set(["layer", "stage", "text", "tween", "instance", "symbol", "inspect"]);
const scriptsScenarios = new Set(["script", "investigate"]);
const outputScenarios = new Set(["capture", "publish", "testmovie", "canvas"]);
const documentScenarios = new Set(["library", "assets"]);

/** Selects the scenario behavior group without exposing a generic plugin registry.
 * @param scenario Selected scenario name.
 * @returns Owning scenario group.
 */
function owner(scenario) {
    if (timelineScenarios.has(scenario)) {
        return "timeline";
    }
    if (scriptsScenarios.has(scenario)) {
        return "scripts";
    }
    if (outputScenarios.has(scenario)) {
        return "output";
    }
    if (documentScenarios.has(scenario)) {
        return "document";
    }
    throw new Error(`No README E2E scenario group handles "${scenario}".`);
}

/** Prepares a scenario-owned fixture and records its trusted baseline state.
 * @param scenario Selected scenario name.
 * @param context Fixture setup dependencies.
 * @param state Mutable scenario-specific state.
 * @returns Resolves after fixture setup.
 */
export async function prepareScenario(scenario, context, state) {
    switch (owner(scenario)) {
        case "timeline":
            return prepareTimelineScenario(scenario, context, state);
        case "scripts":
            return prepareScriptsScenario(scenario, context, state);
        case "output":
            return prepareOutputScenario(scenario, context, state);
        case "document":
            return prepareDocumentScenario(scenario, context, state);
    }
}

/** Validates a scenario's tool trace, response, and immediate document readback.
 * @param scenario Selected scenario name.
 * @param context Scenario run inputs and Animate handlers.
 * @returns Resolves after immediate validation.
 */
export async function verifyScenario(scenario, context) {
    switch (owner(scenario)) {
        case "timeline":
            return verifyTimelineScenario(scenario, context);
        case "scripts":
            return verifyScriptsScenario(scenario, context);
        case "output":
            return verifyOutputScenario(scenario, context);
        case "document":
            return verifyDocumentScenario(scenario, context);
    }
}

/** Verifies the saved scenario state after reopening the disposable FLA.
 * @param scenario Selected scenario name.
 * @param context Reopened document dependencies.
 * @returns Resolves after persistence validation.
 */
export async function verifyScenarioPersistence(scenario, context) {
    switch (owner(scenario)) {
        case "timeline":
            return verifyTimelinePersistence(scenario, context);
        case "scripts":
            return verifyScriptsPersistence(scenario, context);
        case "output":
            return verifyOutputPersistence(scenario, context);
        case "document":
            return verifyDocumentPersistence(scenario, context);
    }
}

/** Returns whether a read-only scenario skips save/reopen.
 * @param scenario Selected scenario name.
 * @returns True for the timeline inspect or Library listing scenario.
 */
export function scenarioIsReadOnly(scenario) {
    const group = owner(scenario);
    return (
        (group === "timeline" && timelineScenarioIsReadOnly(scenario)) ||
        (group === "document" && documentScenarioIsReadOnly(scenario))
    );
}

/** Returns whether this scenario requires Chrome before it runs.
 * @param scenario Selected scenario name.
 * @returns True for the Canvas scenario.
 */
export function scenarioRequiresChrome(scenario) {
    return owner(scenario) === "output" && outputScenarioRequiresChrome(scenario);
}

/** Returns whether the scenario may leave a Test Movie Player open.
 * @param scenario Selected scenario name.
 * @returns True for the Test Movie scenario.
 */
export function scenarioNeedsPlayerCleanup(scenario) {
    return owner(scenario) === "output" && outputScenarioNeedsPlayerCleanup(scenario);
}

/** Returns the completion message for a scenario.
 * @param scenario Selected scenario name.
 * @returns Completion message.
 */
export function scenarioMessage(scenario) {
    switch (owner(scenario)) {
        case "timeline":
            return timelineScenarioMessage(scenario);
        case "scripts":
            return scriptsScenarioMessage(scenario);
        case "output":
            return outputScenarioMessage(scenario);
        case "document":
            return documentScenarioMessage(scenario);
    }
}
