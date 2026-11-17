import type { ZodType } from "zod";
import { type JsflRunner, validateJsflResult } from "../../src/tools/core/shared.js";

/** Builds a recording JSFL seam for tool tests.
 * @param results Canned decoded results keyed by JSFL entry
 * @param errors Optional JSFL errors keyed by entry
 * @returns Fake seam and its recorded calls
 */
export function createFakeJsfl(results: Record<string, unknown>, errors: Record<string, Error> = {}) {
    const calls: { entry: string; vars: Record<string, unknown> }[] = [];
    const jsfl: JsflRunner = {
        async run<T>(entry: string, vars: Record<string, unknown>, schema: ZodType<T>) {
            calls.push({ entry, vars });
            if (errors[entry]) {
                throw errors[entry];
            }
            return validateJsflResult(entry, results[entry], schema);
        },
    };
    return { jsfl, calls };
}
