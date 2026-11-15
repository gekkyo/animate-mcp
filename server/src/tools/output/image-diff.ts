import { isAbsolute, relative, sep } from "node:path";
import { PNG } from "pngjs";

/**
 * Checks whether a path is a strict descendant of a root.
 * @param root Canonical root path.
 * @param path Canonical path to check.
 * @returns Whether path is inside root but is not root itself.
 */
export function isInside(root: string, path: string): boolean {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Decodes a PNG and associates malformed-image errors with its path.
 * @param path Source image path for error reporting.
 * @param bytes PNG file contents.
 * @returns The decoded PNG.
 */
export function decodePng(path: string, bytes: Buffer): PNG {
    try {
        return PNG.sync.read(bytes);
    } catch {
        throw new Error(`Invalid PNG: ${path}`);
    }
}

/**
 * Compares two decoded images and creates a red-highlight diff.
 * @param before Earlier image.
 * @param after Later image.
 * @param tolerance Maximum per-channel difference treated as unchanged.
 * @returns Pixel counts, percentage, bounds, and the diff PNG.
 */
export function comparePixels(before: PNG, after: PNG, tolerance: number) {
    const diff = new PNG({ width: before.width, height: before.height });
    let changedPixels = 0;
    let minX = before.width;
    let minY = before.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < before.height; y++) {
        for (let x = 0; x < before.width; x++) {
            const offset = (y * before.width + x) * 4;
            if (
                ![0, 1, 2, 3].some(
                    (channel) => Math.abs(before.data[offset + channel] - after.data[offset + channel]) > tolerance,
                )
            ) {
                continue;
            }
            changedPixels++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            diff.data[offset] = 255;
            diff.data[offset + 3] = 255;
        }
    }
    return {
        diff,
        changedPixels,
        changedPercent: (changedPixels / (before.width * before.height)) * 100,
        boundingBox: changedPixels === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    };
}
