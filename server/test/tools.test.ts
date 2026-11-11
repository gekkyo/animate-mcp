import assert from "node:assert/strict";
import { test } from "node:test";
import { text, withServer } from "./helpers/fake-animate.js";

test("get_document_info returns info, or a clear error with no document", { timeout: 20_000 }, async () => {
    await withServer({}, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, undefined, text(result));
        assert.deepEqual(result.structuredContent, {
            name: "a.fla",
            width: 550,
            height: 400,
            frameRate: 24,
            timelines: ["Scene 1"],
            asVersion: "AS3",
            greensock: false,
        });
    });
    await withServer({ FAKE_NO_DOC: "1" }, async (client) => {
        const result = await client.callTool({ name: "get_document_info", arguments: {} });
        assert.equal(result.isError, true);
        assert.equal(text(result), "No document open");
    });
});
