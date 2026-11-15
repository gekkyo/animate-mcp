export function toolHandler(
    register: (server: {
        registerTool: (_name: string, _config: object, callback: (...args: unknown[]) => unknown) => unknown;
    }) => unknown,
    checkModal?: () => unknown,
): (...args: unknown[]) => Promise<unknown>;
