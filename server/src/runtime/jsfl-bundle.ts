import { readFileSync } from "node:fs";

export const JSFL_FILES: Record<string, { path: string; deps: string[] }> = {
    "select-document": { path: "shared/select-document.jsfl", deps: [] },
    "edit-state": { path: "shared/edit-state.jsfl", deps: [] },
    "export-common": { path: "shared/export-common.jsfl", deps: [] },
    "document-runtime-info": { path: "document/document-runtime-info.jsfl", deps: [] },
    "get-status": { path: "document/get-status.jsfl", deps: ["export-common"] },
    "get-document-info": { path: "document/get-document-info.jsfl", deps: ["export-common", "document-runtime-info"] },
    "audit-document": {
        path: "document/audit-document.jsfl",
        deps: ["select-document", "edit-state", "export-common"],
    },
    "export-scenes": { path: "scripts/export-scenes.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "export-library": { path: "scripts/export-library.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "apply-scenes": { path: "scripts/apply-scenes.jsfl", deps: ["select-document", "edit-state", "export-common"] },
    "timeline-helpers": { path: "timeline/helpers.jsfl", deps: ["edit-state"] },
    "timeline-layers": { path: "timeline/layers.jsfl", deps: ["timeline-helpers"] },
    "timeline-frames": { path: "timeline/frames.jsfl", deps: ["timeline-helpers"] },
    "timeline-index": {
        path: "timeline/index.jsfl",
        deps: ["select-document", "edit-state", "export-common", "timeline-layers", "timeline-frames"],
    },
    "tween-index": {
        path: "timeline/tween.jsfl",
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
        path: "timeline/inspect-timeline.jsfl",
        deps: ["select-document", "edit-state", "export-common", "element-read"],
    },
    publish: { path: "output/publish.jsfl", deps: ["select-document"] },
    "preflight-publish": { path: "output/preflight-publish.jsfl", deps: ["export-common"] },
    "capture-frame": { path: "output/capture-frame.jsfl", deps: ["export-common"] },
    "edit-elements": {
        path: "timeline/edit-elements.jsfl",
        deps: ["select-document", "edit-state", "export-common", "timeline-helpers", "element-read"],
    },
    "read-output": { path: "output/read-output.jsfl", deps: [] },
    // Its multi-run caller bundles select-document outside the embedded test-movie expression.
    "test-movie": { path: "output/test-movie.jsfl", deps: [] },
    "document-target": { path: "document/document-target.jsfl", deps: [] },
    "open-document": { path: "document/open-document.jsfl", deps: ["document-target"] },
    "convert-to-symbol": {
        path: "timeline/convert-to-symbol.jsfl",
        deps: ["select-document", "edit-state", "export-common"],
    },
    "close-document": { path: "document/close-document.jsfl", deps: ["document-target"] },
    "save-document": { path: "document/save-document.jsfl", deps: ["document-target"] },
    "edit-text": {
        path: "timeline/edit-text.jsfl",
        deps: ["select-document", "edit-state", "export-common", "element-read"],
    },
    "import-assets": { path: "library/import-assets.jsfl", deps: ["select-document", "export-common"] },
    "set-document-properties": {
        path: "document/set-document-properties.jsfl",
        deps: ["select-document", "export-common"],
    },
};

/**
 * Looks up a bundle name in the mapping.
 * @param name JSFL bundle name (e.g. "get-document-info")
 * @param files Bundle mapping to search
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
    readFileSync(new URL(`../../jsfl/${jsflFile(name).path}`, import.meta.url), "utf8");

/**
 * Resolves requested bundles and dependencies in stable topological order.
 * @param names JSFL bundle names (shared parts first, then tool-specific parts)
 * @param files Bundle mapping whose dependencies should be resolved
 * @returns Ordered bundle names
 */
export function resolveBundleNames(names: string[], files = JSFL_FILES): string[] {
    const included = new Set<string>();
    /** Adds a bundle and all of its dependencies to the requested set.
     * @param name Bundle name to include
     * @returns Nothing.
     */
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
        // Preserve mapping order while selecting only bundles whose dependencies are already emitted.
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

/** Concatenates requested JSFL parts with their dependencies.
 * @param names JSFL bundle names to include
 * @returns Combined JSFL source
 */
export const bundle = (...names: string[]) => resolveBundleNames(names).map(loadJsfl).join("\n");

/** Serializes JSFL variables before concatenating the requested bundle.
 * @param names Bundle name or names to include
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
