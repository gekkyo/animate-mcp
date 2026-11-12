// Real-Animate smoke test (not in CI): npm run build, open docs in Animate, then `node server/scripts/smoke-publish.mjs <name.fla>...`
import { createRunner } from "../dist/runner.js";
import { isAnimateRunning, launcher } from "../dist/animate-launcher.js";
import { bundle } from "../dist/jsfl-bundle.js";
import { registerPublish } from "../dist/tools/publish.js";
const runner = createRunner({ dir: `${process.env.HOME}/.animate-mcp/runs`, launch: launcher(), isRunning: isAnimateRunning, timeoutMs: 120000 });
let h; registerPublish({ registerTool: (_n, _c, f) => (h = f) }, { runner, bundle });
for (const d of process.argv.slice(2)) { const r = await h({ document: d }); console.log(d, r.isError ? "TOOLERROR" : "", r.content[0].text.slice(0, 400)); }
