import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const EDIT_STATE_SOURCE = fileURLToPath(new URL("../../jsfl/shared/edit-state.jsfl", import.meta.url));

/**
 * Build two timelines with a saved nonempty selection for edit-state restoration tests.
 * @param throwOnRestore Whether returning to the original scene should fail.
 * @returns A minimal Animate document fixture.
 */
function documentWithSelection(throwOnRestore = false) {
    /**
     * Builds a fake timeline with a selection that can be restored.
     * @returns A minimal fake timeline
     */
    const makeTimeline = () => ({
        layers: [{}, {}],
        currentLayer: 0,
        currentFrame: 0,
        // Duplicate frame indexes must survive snapshot/restore without normalization.
        selectedFrames: [0, 0, 2],
        getSelectedFrames() {
            return this.selectedFrames.slice();
        },
        setSelectedFrames(frames: number[]) {
            this.selectedFrames = frames.slice();
        },
    });
    const timelines = [makeTimeline(), makeTimeline()];
    let sceneEdits = 0;
    const document = {
        currentTimeline: 0,
        timelines,
        library: { items: [] },
        getTimeline() {
            return timelines[this.currentTimeline];
        },
        exitEditMode() {},
        editScene(index: number) {
            sceneEdits++;
            if (throwOnRestore && index === 0 && sceneEdits > 1) {
                throw new Error("restore blocked");
            }
            this.currentTimeline = index;
        },
    };
    return document;
}

/**
 * Run a callback inside the JSFL edit-state helper using the supplied fake document.
 * @param document Document fixture to expose to the JSFL.
 * @param callback JavaScript body executed while the target timeline is active.
 * @returns The VM evaluation result.
 */
async function runSession(document: ReturnType<typeof documentWithSelection>, callback: string) {
    const source = await readFile(EDIT_STATE_SOURCE, "utf8");
    return runInNewContext(`${source}\nwithTimelineEdit(document, 1, function (timeline) { ${callback} })`, {
        document,
    });
}

test("withTimelineEdit restores selected frames and edit state on success and failure", async () => {
    const successDocument = documentWithSelection();
    const success = (await runSession(successDocument, 'timeline.setSelectedFrames([1, 3, 4]); return "done";')) as {
        result: string;
        warnings: string[];
    };
    assert.equal(success.result, "done");
    // Restoration targets the original timeline, not the one active during the callback.
    assert.deepEqual(Array.from(successDocument.timelines[1].selectedFrames), [0, 0, 2]);
    assert.equal(successDocument.currentTimeline, 0);

    const failureDocument = documentWithSelection();
    await assert.rejects(
        runSession(failureDocument, 'timeline.setSelectedFrames([1, 3, 4]); throw new Error("operation failed");'),
        /operation failed/,
    );
    assert.deepEqual(Array.from(failureDocument.timelines[1].selectedFrames), [0, 0, 2]);
    assert.equal(failureDocument.currentTimeline, 0);
});

test("withTimelineEdit returns warnings when the original edit state cannot be restored", async () => {
    const document = documentWithSelection(true);
    const session = (await runSession(document, 'return "done";')) as { warnings: string[] };
    assert.match(session.warnings.join(" "), /Edit state was not restored: restore blocked/);
});
