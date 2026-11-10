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
};

/**
 * Loads JSFL from its mapped path under server/jsfl (the same place from src/ and dist/).
 * @param name JSFL bundle name (e.g. "get-document-info")
 * @returns The JSFL source string
 */
export const loadJsfl = (name: string) => {
    const file = JSFL_FILES[name];
    if (!file) {
        throw new Error(`Unknown JSFL bundle: ${name}`);
    }
    return readFileSync(new URL(`../jsfl/${file.path}`, import.meta.url), "utf8");
};

/**
 * Concatenates named JSFL parts in their explicit bundle order.
 * @param names JSFL bundle names (shared parts first, then tool-specific parts)
 * @returns The concatenated JSFL source
 */
export const bundle = (...names: string[]) =>
    names
        .map(
            /** Adds each JSFL file's explicit bundle order.
             * @param name JSFL file name without extension
             * @param index Original position used as a fallback order
             * @returns JSFL file name and sort order
             */
            (name, index) => ({ name, index }),
        )
        .sort(
            /** Sorts JSFL files by shared dependencies, preserving ties.
             * @param left First JSFL file and its input index
             * @param right Second JSFL file and its input index
             * @returns Relative sort order
             */
            (left, right) =>
                (JSFL_FILES[left.name]?.order ?? left.index) - (JSFL_FILES[right.name]?.order ?? right.index),
        )
        .map(
            /** Loads the source for a sorted JSFL file.
             * @param entry Sorted JSFL file name and input index
             * @returns JSFL source string
             */
            ({ name }) => loadJsfl(name),
        )
        .join("\n");
