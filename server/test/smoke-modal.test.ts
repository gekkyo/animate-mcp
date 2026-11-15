import assert from "node:assert/strict";
import { test } from "node:test";
import { toolHandler } from "../scripts/smoke-lib.mjs";

/** Builds a smoke-tool wrapper around a callback and modal diagnostic.
 * @param callback Registered tool implementation
 * @param checkModal Diagnostic invoked after timeout failures
 * @returns The wrapped handler
 */
function makeHandler(callback: (...args: unknown[]) => unknown, checkModal: () => unknown) {
    const wrapped = toolHandler((server) => server.registerTool("test", {}, callback), checkModal);
    return (...args: unknown[]) => wrapped(...args);
}

/**
 * Extracts the first text block from a tool result.
 * @param result Result whose content may contain text
 * @param result.content Optional content blocks to search
 * @returns First text block, or an empty string when absent
 */
const message = (result: { content?: Array<{ type: string; text?: string }> }) =>
    result.content?.find((item) => item.type === "text")?.text ?? "";
const timeoutMessage =
    "Run timed out after 120000 ms (Animate did not run the .jsfl; on Windows check that .jsfl files are associated with Animate, or set ANIMATE_MCP_LAUNCH_COMMAND)";

test("smoke tool callbacks check timeout failures only and preserve original errors", async () => {
    let checks = 0;
    /**
     * Returns a modal diagnostic result and records that it was checked.
     * @returns The fake modal state
     */
    const checkModal = async () => {
        checks += 1;
        return { state: "modal" };
    };
    const success = { content: [{ type: "text", text: "ok" }] };
    const successfulHandler = makeHandler(async () => success, checkModal);
    assert.equal(await successfulHandler({}), success);
    assert.equal(checks, 0);

    const failure = { isError: true, content: [{ type: "text", text: timeoutMessage }] };
    const failedHandler = makeHandler(async () => failure, checkModal);
    const result = (await failedHandler({})) as typeof failure;
    assert.equal(checks, 1);
    assert.equal(result.isError, true);
    assert.equal(
        message(result),
        `${timeoutMessage}\nAnimate modal diagnostic: a dialog or sheet was detected; close it manually and retry.`,
    );
    assert.ok(message(result).startsWith(failure.content[0].text));

    const refusal = { isError: true, content: [{ type: "text", text: "Operation refused: document is read-only" }] };
    const refusedHandler = makeHandler(async () => refusal, checkModal);
    assert.equal(await refusedHandler({}), refusal);
    assert.equal(checks, 1);
});

test("smoke tool reports unknown or unavailable modal checks without masking the tool error", async () => {
    const failure = { isError: true, content: [{ type: "text", text: timeoutMessage }] };
    for (const [checkModal, expected] of [
        [async () => ({ state: "unknown" }), /state unknown/],
        [
            async () => ({ state: "unavailable", reason: "permission denied" }),
            /diagnostic unavailable: permission denied/,
        ],
        [
            async () => {
                throw new Error("permission denied");
            },
            /diagnostic unavailable: permission denied/,
        ],
    ] as const) {
        const result = (await makeHandler(async () => failure, checkModal)({})) as typeof failure;
        assert.equal(message(result).split("\n")[0], timeoutMessage);
        assert.match(message(result), expected);
    }
});

test("smoke tool does not inspect modal state when a failure has no timeout text", async () => {
    const failure = { isError: true, content: [{ type: "image", data: "encoded", mimeType: "image/png" }] };
    let checks = 0;
    const result = await makeHandler(
        async () => failure,
        async () => {
            checks += 1;
            return { state: "modal" };
        },
    )({});
    assert.equal(result, failure);
    assert.equal(checks, 0);
});
