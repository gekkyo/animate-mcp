import { reportStartupError, serve, TOOLS } from "../../src/index.js";
import { createToolRegistry } from "../../src/tools/registry.js";

serve(createToolRegistry(TOOLS)).catch(reportStartupError);
