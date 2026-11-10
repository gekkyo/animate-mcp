import type { ManifestFile } from "./export.js";

export type Edit = ManifestFile & { file: string; expected: string };
export type NewScript = ManifestFile & { file: string; layerDir: string; asLayer: boolean };
export type AppliedNewScript = ManifestFile & {
    file: string;
    layerDir: string;
    layerName: string;
    asLayer: boolean;
};

export type TimelineFingerprint = { scene: number; item?: string; structureFingerprint: string };

/** Payload fields injected before the JSFL apply-scenes tool runs. */
export type ApplyPayload = {
    edits: Edit[];
    newScripts: NewScript[];
    fingerprints: TimelineFingerprint[];
    libraryFingerprint?: string;
};

export type ApplyFailure = { file: string; error: string };

/** Result returned by the JSFL apply-scenes tool. */
export type ApplyResult = {
    applied: string[];
    failed: ApplyFailure[];
    warning: string;
    warnings: string[];
    newApplied: AppliedNewScript[];
    fingerprints: TimelineFingerprint[];
    libraryMismatch?: boolean;
};

/** Builds the JSFL variable declarations for an apply payload.
 * @param payload Edits, new scripts, and timeline fingerprints to inject
 * @returns JSFL declarations for the payload fields
 */
export function serializeApplyPayload(payload: ApplyPayload): string {
    return `var __edits = ${JSON.stringify(payload.edits)};\nvar __newScripts = ${JSON.stringify(payload.newScripts)};\nvar __fingerprints = ${JSON.stringify(payload.fingerprints)};\nvar __libraryFingerprint = ${JSON.stringify(payload.libraryFingerprint ?? null)};`;
}
