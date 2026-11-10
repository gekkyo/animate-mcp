import { readFileSync } from "node:fs";

const JSFL_ORDER: Record<string, number> = {
    "select-document": 0,
    "edit-state": 1,
    "export-common": 2,
    "get-document-info": 3,
    "export-scenes": 4,
    "export-library": 5,
    "apply-scenes": 6,
    "edit-timeline": 7,
};

/**
 * Loads tool JSFL from server/jsfl/<name>.jsfl (the same place from src/ and dist/).
 * @param name File name without extension (e.g. "get-document-info")
 * @returns The JSFL source string
 */
export const loadJsfl = (name: string) => readFileSync(new URL(`../jsfl/${name}.jsfl`, import.meta.url), "utf8");

/**
 * Concatenates shared parts and the main JSFL in order.
 * @param names File names without extension (shared parts first, the main script last)
 * @returns The concatenated JSFL source
 */
export const bundle = (...names: string[]) =>
    names
        .map(
            /** Adds each JSFL file's explicit bundle order.
             * @param name JSFL file name without extension
             * @param index Original position for unlisted names
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
            (left, right) => (JSFL_ORDER[left.name] ?? left.index) - (JSFL_ORDER[right.name] ?? right.index),
        )
        .map(
            /** Loads the source for a sorted JSFL file.
             * @param entry Sorted JSFL file name and input index
             * @returns JSFL source string
             */
            ({ name }) => loadJsfl(name),
        )
        .join("\n");
