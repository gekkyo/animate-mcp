import { z } from "zod";

export const PANEL_RESULT = z
    .object({
        compilerPanelAvailable: z.boolean(),
        outputPanel: z.string(),
        compilerErrorsPanel: z.string(),
    })
    .strict();
