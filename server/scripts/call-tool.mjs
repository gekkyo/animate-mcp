#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [name, rawArguments] = process.argv.slice(2);
if (!name || rawArguments === undefined) {
    console.error('Usage: npm run call -- <tool> \'{"key":"value"}\'');
    process.exitCode = 2;
} else {
    let args;
    try {
        args = JSON.parse(rawArguments);
        if (args === null || Array.isArray(args) || typeof args !== "object") {
            throw new TypeError("Tool arguments must be a JSON object.");
        }
    } catch (error) {
        console.error(error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message);
        process.exitCode = 2;
    }

    if (process.exitCode !== 2) {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
        });
        const client = new Client({ name: "animate-mcp-local-call", version: "1.0.0" });
        try {
            await client.connect(transport);
            const result = await client.callTool({ name, arguments: args });
            console.log(JSON.stringify(result, null, 2));
            if (result.isError) {
                process.exitCode = 1;
            }
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
        } finally {
            await client.close();
        }
    }
}
