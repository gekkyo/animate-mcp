export function toolHandler(
    register: (server: {
        registerTool: (
            _name: string,
            _config: { annotations?: { readOnlyHint?: boolean } },
            callback: (...args: unknown[]) => unknown,
        ) => unknown;
    }) => unknown,
    checkModal?: () => unknown,
    call?: (entranceName: string, requestArgs: unknown) => Promise<unknown>,
): (...args: unknown[]) => Promise<unknown>;
