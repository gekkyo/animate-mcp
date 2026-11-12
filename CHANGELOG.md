# Changelog

## Unreleased

### Added

- Added `edit_elements` to set instance properties on validated timeline keyframes.
- Added `capture_frame` to return a PNG of one frame from the active AS3 or HTML5 Canvas timeline.
- Added `publish` for AS3 and HTML5 Canvas documents; Canvas compile errors cannot be detected.

### Changed

- Retry empty AS3 publish compiler output once; if it remains empty, report that no errors were reported instead of failing.
- `edit_elements` now rejects non-instance elements and marks its changes as destructive; supplied `filters` replace all existing filters, and `[]` clears them.
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
