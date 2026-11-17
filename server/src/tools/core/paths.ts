import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Checks whether a path is a strict descendant of a root.
 * @param root Root path.
 * @param path Path to check.
 * @returns Whether path is inside root but is not root itself.
 */
export function isInside(root: string, path: string): boolean {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Returns the configured Animate runs directory, using its environment override when set.
 * @returns The runs directory path.
 */
export function runsDir(): string {
    return process.env.ANIMATE_MCP_RUNS_DIR ?? join(homedir(), ".animate-mcp", "runs");
}

/**
 * Returns the default Animate captures directory.
 * @returns The captures directory path.
 */
export function capturesDir(): string {
    return join(homedir(), ".animate-mcp", "captures");
}

/**
 * Returns the default Animate baselines directory.
 * @returns The baselines directory path.
 */
export function baselinesDir(): string {
    return join(homedir(), ".animate-mcp", "baselines");
}

/**
 * Returns the default Animate exports directory.
 * @returns The exports directory path.
 */
export function exportsDir(): string {
    return join(homedir(), ".animate-mcp", "exports");
}
