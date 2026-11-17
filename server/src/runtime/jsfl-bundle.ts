import { readFileSync } from "node:fs";

const JSFL_ENTRY_NAME = /^[\w-]+(?:\/[\w-]+)*$/;

/**
 * Loads a JSFL entry under server/jsfl.
 * @param name JSFL entry path without its extension
 * @returns The JSFL source string
 */
export function loadJsfl(name: string): string {
    if (!JSFL_ENTRY_NAME.test(name)) {
        throw new Error(`Unknown JSFL bundle: ${name}`);
    }
    try {
        return readFileSync(new URL(`../../jsfl/${name}.jsfl`, import.meta.url), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Unknown JSFL bundle: ${name}`);
        }
        throw error;
    }
}

/**
 * Resolves requested entries and their @requires headers in stable topological order.
 * @param names JSFL entry paths to include
 * @returns Ordered entry names
 */
export function resolveBundleNames(names: string[]): string[] {
    const included = new Set<string>();
    const visiting = new Set<string>();
    const ordered: string[] = [];

    /** Adds an entry and its transitive requirements in declaration order.
     * @param name Entry name to include
     * @returns Nothing
     */
    const include = (name: string): void => {
        if (included.has(name)) {
            return;
        }
        if (visiting.has(name)) {
            throw new Error(`Cyclic JSFL bundle dependencies: ${[...visiting, name].join(", ")}`);
        }
        visiting.add(name);
        const source = loadJsfl(name);
        const header = source.match(/^\/\/ @requires ([^\r\n]+)(?:\r?\n|$)/)?.[1];
        for (const dependency of header ? header.split(/,\s*/) : []) {
            include(dependency);
        }
        visiting.delete(name);
        included.add(name);
        ordered.push(name);
    };

    names.forEach(include);
    return ordered;
}

/** Concatenates requested JSFL entries with their dependencies.
 * @param names JSFL entry paths to include
 * @returns Combined JSFL source
 */
export const bundle = (...names: string[]) => resolveBundleNames(names).map(loadJsfl).join("\n");

/** Serializes JSFL variables before concatenating the requested bundle.
 * @param names Entry path or paths to include
 * @param vars Variables to declare before the bundle
 * @param bundleFn Bundle source loader
 * @returns JSFL source containing declarations and bundle code
 */
export function jsflRun(
    names: string | string[],
    vars: Record<string, unknown>,
    bundleFn: (...names: string[]) => string = bundle,
): string {
    const declarations = Object.entries(vars).map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`);
    const jsflNames = Array.isArray(names) ? names : [names];
    return `${declarations.length ? `${declarations.join("\n")}\n` : ""}${bundleFn(...resolveBundleNames(jsflNames))}`;
}
