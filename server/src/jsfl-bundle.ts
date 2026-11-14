import { readFileSync } from "node:fs";

const JSFL_FILES: Record<string, { path: string; order: number }> = {
    "select-document": { path: "shared/select-document.jsfl", order: 0 },
    "edit-state": { path: "shared/edit-state.jsfl", order: 1 },
    "export-common": { path: "shared/export-common.jsfl", order: 2 },
    "document-runtime-info": { path: "shared/document-runtime-info.jsfl", order: 3 },
    "get-document-info": { path: "tools/get-document-info.jsfl", order: 4 },
    "export-scenes": { path: "tools/export-scenes.jsfl", order: 5 },
    "export-library": { path: "tools/export-library.jsfl", order: 6 },
    "apply-scenes": { path: "tools/apply-scenes.jsfl", order: 7 },
    "timeline-helpers": { path: "timeline/helpers.jsfl", order: 8 },
    "timeline-layers": { path: "timeline/layers.jsfl", order: 9 },
    "timeline-frames": { path: "timeline/frames.jsfl", order: 10 },
    "timeline-index": { path: "timeline/index.jsfl", order: 11 },
    "tween-index": { path: "tween/index.jsfl", order: 12 },
    "library-helpers": { path: "library/helpers.jsfl", order: 13 },
    "library-ops": { path: "library/ops.jsfl", order: 14 },
    "library-index": { path: "library/index.jsfl", order: 15 },
    "element-read": { path: "shared/element-read.jsfl", order: 16 },
    "inspect-timeline": { path: "tools/inspect-timeline.jsfl", order: 17 },
    publish: { path: "tools/publish.jsfl", order: 18 },
    "capture-frame": { path: "tools/capture-frame.jsfl", order: 19 },
    "edit-elements": { path: "tools/edit-elements.jsfl", order: 20 },
    "read-output": { path: "tools/read-output.jsfl", order: 21 },
    "test-movie": { path: "tools/test-movie.jsfl", order: 22 },
    "document-target": { path: "shared/document-target.jsfl", order: 23 },
    "open-document": { path: "tools/open-document.jsfl", order: 24 },
    "convert-to-symbol": { path: "tools/convert-to-symbol.jsfl", order: 25 },
    "close-document": { path: "tools/close-document.jsfl", order: 26 },
    "save-document": { path: "tools/save-document.jsfl", order: 27 },
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
