import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createJsflRunner, invokeToolDefinition, type ToolDeps, type ToolExtra } from "../../src/tools/core/shared.js";
import { getDocumentInfoTool } from "../../src/tools/document/get-document-info.js";
import { createFakeJsfl } from "../helpers/fake-jsfl.js";

test("jsfl.run executes the requested entry with serialized variables and timeout", async () => {
    let executedCode = "";
    let executedTimeout: number | undefined;
    const jsfl = createJsflRunner({
        async execute(code, timeoutMs) {
            executedCode = code;
            executedTimeout = timeoutMs;
            const value = JSON.parse(code.match(/^var __probe = (.*);$/m)?.[1] ?? "null");
            return JSON.stringify({ echo: value });
        },
    });
    const schema = z.object({ echo: z.string() }).strict();

    assert.deepEqual(await jsfl.run("document/get-status", { __probe: "entry+vars" }, schema, 5_000), {
        echo: "entry+vars",
    });
    assert.match(executedCode, /function metadata\(document\)/);
    assert.match(executedCode, /var __probe = "entry\+vars";/);
    assert.equal(executedTimeout, 5_000);
});

test("invalid JSFL results become tool failures naming the entry", async () => {
    const fake = createFakeJsfl({ "document/get-document-info": { unexpected: true } });
    const deps: ToolDeps = {
        runner: { execute: async () => undefined },
        jsfl: fake.jsfl,
    };

    const result = await invokeToolDefinition(getDocumentInfoTool, {}, deps, {} as ToolExtra);

    assert.equal(result.isError, true);
    assert.match(
        result.content[0].type === "text" ? result.content[0].text : "",
        /document\/get-document-info.*invalid data/,
    );
    assert.deepEqual(fake.calls, [{ entry: "document/get-document-info", vars: {} }]);
});
