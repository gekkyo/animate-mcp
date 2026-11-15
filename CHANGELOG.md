# Changelog

## Unreleased

### Added

- Added `get_status` for a short Animate responsiveness probe and open-document summary; it does not report unsaved changes.
- Added read-only `preflight_publish` checks and audit findings without saving or publishing. Output-file checks are limited to safe candidate names beside the FLA, and compilation remains unchecked.
- Added `visual_regression` to save and compare named frame Baselines, with guarded overwrite and diff images for failed comparisons.

### Changed

- `inspect_timeline` accepts `geometry: true` to read bounds and symbol playback metadata, including interpolated tween values when available.

## 0.2.0

### Added

- Added `audit_document` to suggest unused Library items, empty keyframes, and default-looking names. Findings are review hints, not proof that items are safe to delete.
- Added `diff_captures` to compare two captured PNGs and report changed pixels with a highlighted difference image.
- Added `verify_canvas_output` to publish HTML5 Canvas output, check it in Chrome for loading errors, and capture a screenshot. Publishing is the default and overwrites existing outputs; use `publish: false` to check existing output.
- Added a tool reference in English and Japanese (`TOOLS.md` and `TOOLS.ja.md`) and included both in the npm package.

### Changed

- `publish` distinguishes verified AS3 compiler diagnostics from unavailable output and unchecked Canvas output; an empty error list does not always prove a clean build.
- `audit_document` accepts an optional document selector when multiple documents are open.
- Updated both READMEs with usage examples, architecture diagrams, and smoke-test instructions.

### Fixed

- Timeline edits report partial failures and restore the original layer by identity rather than by stale index.
- Canvas verification uses platform-native paths and ignores the browser's favicon 404.

## 0.1.9

### Added

- Added `edit_text` for adding and updating whole text fields, with text read-back in `inspect_timeline`.
- Added `import_assets` for images and audio, refusing Library name collisions before Animate can open a blocking dialog.
- Added `set_document_properties` for stage size, frame rate, and background color; `get_document_info` now reports background color.
- Added `edit_library` operations `findUsages`, `createSymbol`, and `duplicateItem`.
- Added graphic `loop`/`firstFrame` and symbol swapping to `edit_elements`.

## 0.1.8

### Added

- Added `open_document`, `save_document`, and `close_document` for explicitly targeted document operations; overwrite and discard require explicit confirmation.
- Added `convert_to_symbol` to convert explicitly addressed elements on one frame into a named symbol; linkage remains a separate `edit_library` operation.
- Added read-only `read_output` to return raw Output and Compiler Errors panel text with parsed compiler diagnostics when available; panel contents may be stale or mixed.
- Added `test_movie` for saved AS3 documents; it leaves the Player open and returns compiler diagnostics plus one bounded Output-panel delta.
- `edit_elements` can add a Library item to a named layer and frame (`{ op: "add", item, layer, frame, x?, y?, set? }`), creating the layer and extending the timeline if needed. Omitted coordinates default to the stage center.
- `edit_library` gained `getLinkage` and `setLinkage` to read and update AS3 linkage (`exportForAS`, `className`, `baseClass`, `exportInFirstFrame`) on Flash/AS3 documents. HTML5 Canvas linkage is not supported.
- `capture_frame` accepts `range: { start, end, step? }` to capture up to 24 frames as ordered PNG images, returned in `structuredContent.captures`.

### Changed

- `apply_scripts` detects linkage export/class-name changes after `export_scripts` and rejects stale exports. Existing exports created before this fingerprint change must be re-exported; preserve any unapplied script edits before using `force: true` (which discards them).
- `publish` now reports `compilerOutput` as `verified`, `unavailable`, or `not_checked` (HTML5 Canvas); `ok: true` with unavailable or unchecked diagnostics does not confirm an error-free build.
- `edit_elements` is no longer marked idempotent (`idempotentHint: false`), because `add` creates new elements on each call.

## 0.1.7

### Added

- Added `edit_elements` to set instance properties on validated timeline keyframes.
- Added `capture_frame` to return a PNG of one frame from the active AS3 or HTML5 Canvas timeline.
- Added `publish` for AS3 and HTML5 Canvas documents; Canvas compile errors cannot be detected.

### Changed

- Retry empty AS3 publish compiler output once; if it remains empty, report that no errors were reported instead of failing.
- `edit_elements` now rejects non-instance elements and marks its changes as destructive; supplied `filters` replace all existing filters, and `[]` clears them.
- `edit_elements` read-back elements now use the same fields as `inspect_timeline`, plus operation references. **Breaking:** the old `colorMode` field is replaced by `colorEffect.mode`.
- `publish` now reads the code of AS3 compiler warnings correctly (Animate prefixes them with `Warning:`, which was reported as the code).
- `edit_elements` and `edit_tween` now switch to the requested scene before editing (and restore the original) instead of silently doing nothing for color effects on a scene that is not open.
- Preserve compiler error and warning lines as plain diagnostics when Animate's location/code format cannot be parsed.

## 0.1.6

### Changed

- Added npm package description and search keywords.

## 0.1.5

### Changed

- Prepared the package for publication to the official MCP Registry.
- Changed the recommended MCP client registration name from `animate` to `animate-mcp`.

## 0.1.4

### Added

- Added `inspect_timeline` to inspect layers, keyframes, instances, and tweens.
- Added `edit_tween` to create motion and classic tweens with preset or custom easing.
- Added an `edit_timeline` operation to distribute instances across separate layers.
- Added `install_greensock` to install GreenSock-AS3 for ActionScript 3 documents.

### Changed

- `get_document_info` now reports the ActionScript version and GreenSock installation status.
- Consolidated Export workspace manifest handling and updated usage and tool documentation in both READMEs.

### Fixed

- Failed GreenSock installations no longer leave an empty `com/` directory behind.

## 0.1.3

### Added

- Added `edit_library` to create folders, move, rename, or delete items, and list unused items. Deletion requires confirmation and refuses items in use.

### Changed

- `apply_scripts` now rejects stale exports and requires a new export when the library has changed since Export.

## 0.1.2

### Added

- Added `edit_timeline` to edit layers and frames in scenes and library symbols, including shifting one layer's contents later without affecting other layers.
- `apply_scripts` can now add ActionScript or HTML5 Canvas scripts to previously scriptless frames; insertion into tween spans is refused.

### Fixed

- Re-export no longer overwrites unapplied scripts added to previously scriptless frames.
- Removed trailing commas that caused script application to fail in some JSFL environments.
