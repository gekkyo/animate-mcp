import { readFileSync } from "node:fs";

export const JSFL_FILES: Record<string, { path: string; deps: string[] }> = {
    "select-document": { path: "shared/select-document.jsfl", deps: [] },
    "edit-state": { path: "shared/edit-state.jsfl", deps: [] },
    "export-common": { path: "shared/export-common.jsfl", deps: [] },
    "document-runtime-info": { path: "shared/document-runtime-info.jsfl", deps: [] },
    "get-document-info": { path: "tools/get-document-info.jsfl", deps: ["export-common", "document-runtime-info"] },
    "export-scenes": { path: "tools/export-scenes.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "export-library": { path: "tools/export-library.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "apply-scenes": { path: "tools/apply-scenes.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "timeline-helpers": { path: "timeline/helpers.jsfl", deps: ["edit-state"] },
    "timeline-layers": { path: "timeline/layers.jsfl", deps: ["timeline-helpers"] },
    "timeline-frames": { path: "timeline/frames.jsfl", deps: ["timeline-helpers"] },
    "timeline-index": {
        path: "timeline/index.jsfl",
        deps: ["select-document", "edit-state", "export-common", "timeline-layers", "timeline-frames"],
    },
    "tween-index": {
        path: "tween/index.jsfl",
        deps: ["select-document", "edit-state", "export-common", "timeline-helpers"],
    },
    "library-helpers": { path: "library/helpers.jsfl", deps: [] },
    "library-ops": { path: "library/ops.jsfl", deps: ["library-helpers"] },
    "library-index": {
        path: "library/index.jsfl",
        deps: ["select-document", "edit-state", "export-common", "library-ops"],
    },
    "element-read": { path: "shared/element-read.jsfl", deps: [] },
    "inspect-timeline": {
        path: "tools/inspect-timeline.jsfl",
        deps: ["select-document", "edit-state", "export-common", "element-read"],
    },
    publish: { path: "tools/publish.jsfl", deps: ["select-document"] },
    "capture-frame": { path: "tools/capture-frame.jsfl", deps: ["export-common"] },
    "edit-elements": {
        path: "tools/edit-elements.jsfl",
        deps: ["select-document", "edit-state", "export-common", "timeline-helpers", "element-read"],
    },
    "read-output": { path: "tools/read-output.jsfl", deps: [] },
    // Its multi-run caller bundles select-document outside the embedded test-movie expression.
    "test-movie": { path: "tools/test-movie.jsfl", deps: [] },
    "document-target": { path: "shared/document-target.jsfl", deps: [] },
    "open-document": { path: "tools/open-document.jsfl", deps: ["document-target"] },
    "convert-to-symbol": {
        path: "tools/convert-to-symbol.jsfl",
        deps: ["select-document", "edit-state", "export-common"],
    },
    "close-document": { path: "tools/close-document.jsfl", deps: ["document-target"] },
    "save-document": { path: "tools/save-document.jsfl", deps: ["document-target"] },
    "edit-text": {
        path: "tools/edit-text.jsfl",
        deps: ["select-document", "edit-state", "export-common", "element-read"],
    },
    "import-assets": { path: "tools/import-assets.jsfl", deps: ["select-document", "export-common"] },
    "set-document-properties": {
        path: "tools/set-document-properties.jsfl",
        deps: ["select-document", "export-common"],
    },
};

/**
 * Looks up a bundle name in the mapping.
 * @param name JSFL bundle name (e.g. "get-document-info")
 * @returns The mapped path and dependencies
 */
function jsflFile(name: string, files = JSFL_FILES) {
    const file = files[name];
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
 * Resolves requested bundles and dependencies in stable topological order.
 * @param names JSFL bundle names (shared parts first, then tool-specific parts)
 * @returns Ordered bundle names
 */
export function resolveBundleNames(names: string[], files = JSFL_FILES): string[] {
    const included = new Set<string>();
    const include = (name: string) => {
        if (included.has(name)) {
            return;
        }
        included.add(name);
        for (const dependency of jsflFile(name, files).deps) {
            include(dependency);
        }
    };
    names.forEach(include);

    const remaining = new Set(included);
    const ordered: string[] = [];
    while (remaining.size) {
        const next = Object.keys(files).find(
            (name) =>
                remaining.has(name) && jsflFile(name, files).deps.every((dependency) => !remaining.has(dependency)),
        );
        if (!next) {
            throw new Error(`Cyclic JSFL bundle dependencies: ${[...remaining].join(", ")}`);
        }
        ordered.push(next);
        remaining.delete(next);
    }
    return ordered;
}

/** Concatenates requested JSFL parts with their dependencies. */
export const bundle = (...names: string[]) => resolveBundleNames(names).map(loadJsfl).join("\n");

/** Serializes JSFL variables before concatenating the requested bundle. */
export function jsflRun(
    names: string | string[],
    vars: Record<string, unknown>,
    bundleFn: (...names: string[]) => string = bundle,
): string {
    const declarations = Object.entries(vars).map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`);
    const jsflNames = Array.isArray(names) ? names : [names];
    return `${declarations.length ? `${declarations.join("\n")}\n` : ""}${bundleFn(...resolveBundleNames(jsflNames))}`;
}
