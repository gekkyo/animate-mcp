/**
 * Converts a tool exception into an MCP error result.
 * @param error The caught value
 * @returns A text result with isError set
 */
export const failure = (error: unknown) => ({
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
});

/** Timelines handled per Run (to avoid timeouts) */
export const TIMELINES_PER_RUN = 10;
