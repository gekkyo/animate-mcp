// Shared setup for real-Animate smoke scripts (not in CI). Run `npm run build` first.
import { isAnimateRunning, launcher } from "../dist/animate-launcher.js";
import { bundle } from "../dist/jsfl-bundle.js";
import { createRunner } from "../dist/runner.js";

export function toolHandler(register) {
    const runner = createRunner({
        dir: `${process.env.HOME}/.animate-mcp/runs`,
        launch: launcher(),
        isRunning: isAnimateRunning,
        timeoutMs: 120000,
    });
    let handle;
    register({ registerTool: (_name, _config, callback) => (handle = callback) }, { runner, bundle });
    return handle;
}
