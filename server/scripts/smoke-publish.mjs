// Real-Animate smoke test (not in CI): `node server/scripts/smoke-publish.mjs <name.fla>...` (docs open in Animate).
import { registerPublish } from "../dist/tools/publish.js";
import { toolHandler } from "./smoke-lib.mjs";

const handle = toolHandler(registerPublish);
for (const document of process.argv.slice(2)) {
    const result = await handle({ document });
    console.log(document, result.isError ? "TOOLERROR" : "", result.content[0].text.slice(0, 400));
}
