// Real-Animate smoke test (not in CI): npm run build, open the target document in Animate, then `node server/scripts/smoke-capture-frame.mjs [frame] [dir]`.
import { readFile } from "node:fs/promises";
import { createRunner } from "../dist/runner.js";
import { isAnimateRunning, launcher } from "../dist/animate-launcher.js";
import { bundle } from "../dist/jsfl-bundle.js";
import { registerCaptureFrame } from "../dist/tools/capture-frame.js";

const runner = createRunner({
    dir: `${process.env.HOME}/.animate-mcp/runs`,
    launch: launcher(),
    isRunning: isAnimateRunning,
    timeoutMs: 120000,
});
let handle;
registerCaptureFrame({ registerTool: (_name, _config, callback) => (handle = callback) }, { runner, bundle });

const [frameArg, dir] = process.argv.slice(2);
const result = await handle({ ...(frameArg ? { frame: Number(frameArg) } : {}), ...(dir ? { dir } : {}) });
if (result.isError) {
    console.error("TOOLERROR", result.content[0].text);
    process.exitCode = 1;
} else {
    const image = result.content.find((item) => item.type === "image");
    const text = result.content.find((item) => item.type === "text");
    if (!image || image.type !== "image" || !text || text.type !== "text") throw new Error("Missing image or metadata content");
    const metadata = JSON.parse(text.text);
    const saved = await readFile(metadata.path);
    const returned = Buffer.from(image.data, "base64");
    if (!saved.equals(returned)) throw new Error("Returned image does not match the saved PNG");
    console.log(JSON.stringify(metadata));
}
