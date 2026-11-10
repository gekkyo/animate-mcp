import { readFileSync } from "node:fs";

const JSFL_FILES: Record<string, { path: string; order: number }> = {
    "select-document": { path: "shared/select-document.jsfl", order: 0 },
    "edit-state": { path: "shared/edit-state.jsfl", order: 1 },
    "export-common": { path: "shared/export-common.jsfl", order: 2 },
    "get-document-info": { path: "tools/get-document-info.jsfl", order: 3 },
    "export-scenes": { path: "tools/export-scenes.jsfl", order: 4 },
    "export-library": { path: "tools/export-library.jsfl", order: 5 },
    "apply-scenes": { path: "tools/apply-scenes.jsfl", order: 6 },
    "timeline-helpers": { path: "timeline/helpers.jsfl", order: 7 },
    "timeline-layers": { path: "timeline/layers.jsfl", order: 8 },
    "timeline-frames": { path: "timeline/frames.jsfl", order: 9 },
    "timeline-index": { path: "timeline/index.jsfl", order: 10 },
    "library-helpers": { path: "library/helpers.jsfl", order: 11 },
    "library-ops": { path: "library/ops.jsfl", order: 12 },
    "library-index": { path: "library/index.jsfl", order: 13 },
};

/**
 * Looks up a bundle name in the mapping.
 * @param name JSFL bundle name (e.g. "get-document-info")
 * @returns The mapped path and bundle order
 */
function jsflFile(name: string) {
    const file = JSFL_FILES[name];
    if (!file) {
        throw new Error(`Unknown JSFL bundle: ${name}`);
    }
    return file;
}

/**
 * Loads JSFL from its mapped path under server/jsfl (the same place from src/ and dist/).
 * @param name JSFL bundle name (e.g. "get-document-info")
 * @returns The JSFL source string
 */
export const loadJsfl = (name: string) =>
    readFileSync(new URL(`../jsfl/${jsflFile(name).path}`, import.meta.url), "utf8");

/**
 * Concatenates named JSFL parts in their explicit bundle order.
 * @param names JSFL bundle names (shared parts first, then tool-specific parts)
 * @returns The concatenated JSFL source
 */
export const bundle = (...names: string[]) =>
    [...names]
        .sort(
            /** Sorts bundle names by their explicit order.
             * @param left First bundle name
             * @param right Second bundle name
             * @returns Relative sort order
             */
            (left, right) => jsflFile(left).order - jsflFile(right).order,
        )
        .map(loadJsfl)
        .join("\n");
