<div align="center">

# animate-mcp

An MCP server for operating Adobe Animate from AI agents.

English | [日本語](README.ja.md)

[Changelog](CHANGELOG.md)

[![CI](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
[![license MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## Overview

`animate-mcp` is an MCP server that lets AI agents such as Claude Code and Codex operate Adobe Animate directly.

Just give the AI instructions in plain language to write and edit frame scripts, work with animations, and automate repetitive tasks.

It reads the structure and scripts of scenes and library symbols so it can edit with an understanding of what is already there, and it supports a wide range of operations, including layers, frames, tweens, instance properties, and library assets. It can also publish a document and capture a frame as a PNG image.

## Highlights

- AI agents can read frame scripts and structure from scenes and library symbols through files, then apply edited scripts back to Animate.
- Inspect layers, keyframes, instances, and tweens.
- Add and edit whole text fields, including font, size, color, alignment, and text type.
- Edit instance transforms, color effects, filters, names, blend modes, and visibility on keyframes.
- Edit layer and frame structure and labels.
- Create motion and classic tweens with preset or custom Bézier easing.
- Organize library folders and items and find unused items.
- Import images and audio, find direct Library usages, create or duplicate symbols, and change stage properties.
- Publish AS3 and HTML5 Canvas documents and get AS3 compile errors and warnings back.
- Read Animate's diagnostic panels and run an AS3 Test Movie to capture runtime output.
- Capture a frame or range as PNG images.
- Check for unused Library items and empty keyframes.
- Verify Canvas HTML in Chrome and compare captured PNGs.
- Install GreenSock-AS3 with a prompt.
- Work with ActionScript 3 and HTML5 Canvas, and run arbitrary JSFL.

## Requirements

- Node.js
- Adobe Animate (must be running)
- An MCP-compatible client (Claude Code, Claude Desktop, etc.)
- Verified with Animate 2027 on macOS and with Animate on Windows.

## Install

### Claude Code

    claude mcp add animate-mcp -- npx -y animate-mcp@latest

### Clients configured with JSON (Claude Desktop, etc.)

    {
      "mcpServers": {
        "animate-mcp": {
          "command": "npx",
          "args": ["-y", "animate-mcp@latest"]
        }
      }
    }

## Usage

1. Start Animate and open the target .fla.
2. Ask your agent to do the work.
3. When editing scripts, the workflow is:
    1. `export_scripts` writes the structure and every frame script to `~/.animate-mcp/exports/<document name>/`.
    2. The agent edits the files.
    3. `apply_scripts` writes them back into Animate.

### Example prompts

#### Script operations

```text
Export the scripts from the open document and find the cause of an error
```

#### Inspecting the timeline

```text
Check the instance and tween on frame 12 of the Character layer in Scene 1
```

#### Editing layers and frames

```text
Add a Background layer to Scene 1 and extend it to 24 frames
```

#### Creating a tween

```text
Move the Ball instance 200 px to the right over frames 1–24 in Scene 1, using backOut easing (overshoot and return)
```

#### Editing instance properties

```text
Set the Ball instance on frame 1 of Scene 1 to 50% alpha and add a blur filter
```

#### Publishing

```text
Publish the open document and tell me the compile errors
```

#### Capturing a frame

```text
Capture frame 12 of Scene 1 and tell me how it looks
```

#### Organizing the library

```text
List unused library items
```

#### Installing GreenSock

```text
Install GreenSock-AS3 for the open document
```

## Usage tips

- If multiple documents are open, specify the target document.
- Changes made in Animate after Export are detected as conflicts during Apply. Apply is refused if the library has changed.
- Re-exporting is refused when unapplied edits exist. Use `force: true` only if you are willing to discard them.
- After changing the timeline, tweens, or library, re-export before editing or applying scripts.
- Deleting a layer, frames, or a library item requires `confirm: true`. Library items in use cannot be deleted.
- Save with `save_document` after confirming any overwrite, or save in Animate. Use `edit_library`'s `getLinkage` and `setLinkage` operations to inspect or edit AS3 linkage; renaming or moving an item still does not automatically update linkage names or string references in code.
- `edit_elements` rejects tween interiors and validates all operations before writing; it does not save the `.fla`.

## Tools

| Tool | What it does | Inputs and caveats |
|------|--------------|--------------------|
| `get_document_info` | Reports the open document's name, dimensions, frame rate, background color, timeline names, ActionScript version, and GreenSock status. | Takes no arguments. |
| `open_document` | Opens an existing `.fla` or creates a new AS3 or HTML5 Canvas document with Animate's default size and frame rate. | Supply exactly one of `path` (existing `.fla`) or `type` (`timeline` or `htmlcanvas`). Returns the opened document name and path, if saved. |
| `save_document` | Saves an explicitly named open document to its current path or a new path. | Requires `document` (exact name or path); unsaved documents require `path`. Overwriting the current file or another existing file requires `confirm: true` after asking the user. Never defaults to the active document. |
| `close_document` | Closes an explicitly named open document without saving. | Requires `document` (exact name or path) and `discardUnsavedChanges: true`; any unsaved edits are discarded. Save first if needed. Never defaults to the active document or closes Test Movie Players. |
| `export_scripts` | Exports scene and library-symbol structure and frame scripts, plus `index.md` and each timeline's `structure.md`. | Defaults to `~/.animate-mcp/exports/<document name>/`. Refuses to re-export over unapplied edits; `force: true` discards them. |
| `apply_scripts` | Applies edits to exported scripts in Animate. An empty script file deletes that frame's script. | Pass the export directory as `dir`. Frames changed in Animate are not overwritten. Does not save the `.fla`. |
| `read_output` | Reads the current Output and Compiler Errors panels as raw text and parses compiler diagnostics. | Read-only; contents may be stale or mixed because Animate does not identify their source document or run. `compilerDiagnostics.status: "unavailable"` means the panel is empty, incomplete, or unsupported; it does not prove a clean compile. |
| `test_movie` | Runs a saved AS3 document in Test Movie with abort-on-compiler-errors enabled, using its current in-memory contents; returns compiler diagnostics plus the Output panel delta. | Does not save, publish, or close the `.fla`; any Test Movie Player remains open for you to close. The Output panel is sampled once, two seconds after launch, so later messages may be missed and concurrent messages may be mixed in. An empty delta does not prove there were no runtime errors. |
| `publish` | Publishes an AS3 or HTML5 Canvas document and returns its Build result. | Overwrites outputs at the document's publish settings; unsaved edits in the open document are published, but the `.fla` is not saved. `compilerOutput` is `verified` for parsed AS3 output, `unavailable` after one empty-output retry, or `not_checked` for Canvas. An empty `errors` list when output is unavailable or unchecked does not prove a clean build. Compiler diagnostics without a parsed location/code are returned as plain messages when the summary is present. Canvas compile errors are unverified; `ok: true` only means Publish ran. |
| `verify_canvas_output` | Optionally Publishes a saved HTML5 Canvas document, opens the resulting HTML in installed Chrome, and returns Browser output and a screenshot. | Publish runs by default and overwrites outputs at the document's Publish settings. Use `publish: false` to avoid publishing or `htmlPath` to specify an absolute HTML path; the default is `<FLA stem>.html` beside the FLA (verified on Animate 2027 with default settings) and may not match custom settings. Chrome must already be installed. The HTML and local assets are served only from the HTML directory on loopback; only known web asset types are served, page-authored scripts execute, and remote assets may need network access. Browser output covers console errors, uncaught exceptions, and failed requests during loading plus `observeMs` (default 3000); a clean result does not prove visual correctness or exclude later errors. |
| `audit_document` | Read-only suggestions for unused Library items, empty keyframes, and default-looking English/Japanese layer and symbol names. | Findings include severity and location and are review heuristics, not proof of defects. Unused items may be referenced by external code; linkage-bearing items are specifically marked as not safe to infer deletion. Direct timeline usage is scanned across scenes and symbols; nested/runtime references are not proven. The tool temporarily visits timelines and restores the prior edit context and selection. |
| `capture_frame` | Returns PNG images of one frame or an inclusive range from the active timeline, including a library symbol being edited. | Specify either `frame` (1-based, defaults to the current frame) or `range: { start, end, step? }` (1-based, ascending and inclusive; `step` defaults to 1, must be a positive integer, and at most 24 frames are captured). Range results return ordered image/metadata pairs and `structuredContent.captures`. Saves each image under `~/.animate-mcp/captures/<document>/` or `dir`; unsaved documents are supported. The current frame is restored, but changing frames may clear the selection. Stages larger than 2048px on either side are refused, without scaling. |
| `diff_captures` | Compares two existing Capture PNGs and returns a red-highlight difference image plus changed-pixel count, percentage, and bounding box. | Use absolute paths inside `~/.animate-mcp/captures/`; dimensions must match. `tolerance` defaults to 8 and ignores a pixel when every RGBA channel differs by no more than that value. An unchanged image has `boundingBox: null`. A new diff PNG is saved beside the earlier Capture without overwriting existing files. |
| `inspect_timeline` | Reads layers, keyframe ranges, instances, text, and tweens at a specified frame of a scene or library symbol. | `timeline` is a zero-based scene index or library-item path. Frame numbers are one-based; layers can be filtered. Text includes its string and whole-field style. |
| `edit_elements` | Sets symbol-instance transforms, names, color effects, filters, blend modes, visibility, graphic loop/firstFrame, and swaps symbols; or adds a Library item to a timeline. | Set operations use layer and element names or zero-based indexes; `{ op: "add", item, layer, frame, x?, y?, set? }` places a Library item on a named layer at a 1-based frame, creating the layer and extending the timeline if needed. Omitted coordinates default to the stage center. `set.swapSymbol` names an existing Library symbol; `set.loop` and `set.firstFrame` apply only to graphics. Non-instances and tween interiors are refused, and all operations are validated before any write. Supplying `filters` replaces all existing filters; `[]` clears them. Read-back element fields match `inspect_timeline` with added layer/frame/element references. Rotation and skew cannot be set together in one operation. Does not save the `.fla`. |
| `edit_text` | Adds text to a scene or symbol timeline or edits an existing text field. | `timeline` is a scene index or Library path; `ops` contains `{ op: "add", layer, frame, rectangle: { left, top, right, bottom }, text, style? }` or `{ op: "set", layer, frame, element, text?, style? }`. Style can set face, size, fillColor, bold, italic, alignment, textType, and lineType for the whole field. Canvas refuses input and single-line text. No per-character styling; does not save the `.fla`. |
| `import_assets` | Imports images and audio to the Library, not the stage. | `paths` is a nonempty array of absolute PNG/JPEG/GIF/WAV/MP3 file paths. Existing Library names or duplicate input names are refused before importing; no overwrite or auto-rename. `document` is optional; does not save the `.fla`. |
| `set_document_properties` | Sets stage width, height, frame rate, and background color. | Specify at least one of `width`, `height` (integer pixels, 1–3840; 3840 was tested as accepted and is the tool's conservative cap, not a verified Animate maximum), `frameRate` (0.01–120), or `backgroundColor` (`#RRGGBB`). Does not scale or move stage content or save the `.fla`; `document` is optional. |
| `convert_to_symbol` | Converts explicitly addressed elements on one timeline frame into a movie clip, button, or graphic. | Supply a scene or Library timeline, one-based frame, element references, unique symbol name, and optional registration point (center by default). Refuses tween interiors; does not set linkage or save the `.fla`. Use `edit_library`'s `setLinkage` separately for AS3 linkage. |
| `edit_timeline` | Edits layers, frames, keyframes, and labels, and distributes instances across layers. Runs operations in `ops` order. | `deleteLayer` and `removeFrames` require `confirm: true`. `shiftLayerFrames` overwrites the clipboard and may require Undo if it fails partway through. |
| `edit_tween` | Creates motion or classic tweens and changes easing. Supports presets, numeric easing, and four-number custom easing. | The named instance must be alone on its layer. Existing tween spans are not replaced. |
| `edit_library` | Creates folders and symbols, moves, renames, duplicates, and deletes items, finds direct usages, lists unused items, and reads or updates AS3 linkage. | `findUsages` reports direct scene/symbol timeline placements only: `timeline` is a scene index or a symbol path, and sound uses have `element: null`. `createSymbol` requires a unique name and type; `duplicateItem` requires `newName`. `getLinkage` and `setLinkage` support Flash/AS3 documents only. `setLinkage` accepts `exportForAS`, `className`, `baseClass`, and `exportInFirstFrame`, and returns Animate's read-back values. With export disabled, the linkage fields are `{ exportForAS: false, className: "", baseClass: "", exportInFirstFrame: false }`; results also include the item `name`. Setting class/base or enabling first-frame export requires `exportForAS: true`. If `setLinkage` changes a movie clip, graphic, or button's AS3 export or class name, rerun `export_scripts` to refresh linked-class metadata in the export workspace; `apply_scripts` rejects exports with stale linkage. Deletion requires `confirm: true` and refuses items in use. Moving or renaming does not update code-string references. |
| `install_greensock` | Fetches GreenSock-AS3 12.1.5 from GitHub and places it alongside a saved AS3 document. | Review the [license](https://gsap.com/standard-license/) and pass `confirm: true`. Does not change or save the `.fla`; does not support AS2 or HTML5 Canvas. |
| `run_jsfl` | Executes arbitrary JSFL in Animate and returns the result. Object return values become strings. | Can modify documents and files; ask the user before running code that makes changes. |

### Operations accepted in `ops`

`edit_timeline`, `edit_tween`, and `edit_library` accept the following operations in their `ops` arrays. `edit_elements` accepts `{ layer, frame, element, set }` to update an existing instance, or `{ op: "add", item, layer, frame, x?, y?, set? }` to add a Library item; see its row in the table above.

#### `edit_timeline`

| Operation | Description |
|-----------|-------------|
| `addLayer` | Add a layer |
| `deleteLayer` | Delete a layer (requires `confirm: true`) |
| `moveLayer` | Move a layer |
| `renameLayer` | Rename a layer |
| `setLayerType` | Change a layer's type |
| `distributeToLayers` | Put each symbol instance from a single-span layer on its own layer |
| `insertFrames` | Insert frames |
| `removeFrames` | Remove frames (requires `confirm: true`) |
| `insertKeyframe` | Insert a keyframe |
| `clearKeyframe` | Clear a keyframe |
| `setLabel` | Set a frame label |
| `setSpanLength` | Change the length of a frame span |
| `shiftLayerFrames` | Move one layer's content later without shifting other layers |

#### `edit_tween`

| Operation | Description |
|-----------|-------------|
| `createTween` | Create a motion or classic tween for a named instance |
| `setEase` | Change an existing tween's easing |

#### `edit_library`

| Operation | Description |
|-----------|-------------|
| `createFolder` | Create a folder |
| `moveItem` | Move an item to another folder |
| `renameItem` | Rename an item |
| `deleteItem` | Delete an item (requires `confirm: true`; refuses items in use) |
| `findUsages` | Find direct placements of an item on scene and symbol timelines |
| `createSymbol` | Create an empty movie clip, button, or graphic with a unique name |
| `duplicateItem` | Copy an item with required `newName` |
| `listUnused` | List unused items |
| `getLinkage` | Read an item's AS3 linkage settings (Flash/AS3 only) |
| `setLinkage` | Update one or more AS3 linkage settings and return their read-back values (Flash/AS3 only) |

## Environment variables

| Name                          | Description                                  | Default               |
|-------------------------------|----------------------------------------------|-----------------------|
| `ANIMATE_MCP_TIMEOUT_MS`      | Execution timeout                            | 30000                 |
| `ANIMATE_MCP_RUNS_DIR`        | Working directory                            | `~/.animate-mcp/runs` |
| `ANIMATE_MCP_LAUNCH_COMMAND`  | Custom command to open the `.jsfl` file      | OS default            |
| `ANIMATE_MCP_PROCESS_PATTERN` | Custom process pattern to detect Animate     | OS default            |

## Bug reports

Please open an [issue](https://github.com/gekkyo/animate-mcp/issues) with your Animate version, OS, steps to reproduce and error messages.

## Development

    npm install && npm run build
    npm test

Client config: `node /path/to/animate-mcp/server/dist/index.js` (stdio).

### Manual smoke test (real Animate)

1. Start Animate with a document open.
2. Run `run_jsfl` with `fl.trace('hi'); 'ok'`. `hi` appears in the Output panel and the tool returns `"ok"`. Animate comes to the front (known behavior).
3. Run `get_document_info`. It returns name, size, frame rate and timeline names.
4. Close all documents and run `get_document_info`. It returns "No document open".
5. Quit Animate and run `run_jsfl`. It returns "Animate not running".
6. With a saved AS3 document open, run `publish`. It returns `ok: true` with empty `errors`. Add a syntax error and run it again to see it in `errors`.
7. Run `capture_frame`. It returns a PNG image and its saved path.
8. Unverified: behavior while a modal dialog is open.

Scripted versions of steps 6–7 and tool checks: run `npm run build`, then `node server/scripts/smoke-publish.mjs`, `smoke-capture-frame.mjs`, `smoke-edit-elements.mjs`, `smoke-edit-library.mjs`, `smoke-edit-text.mjs`, and `smoke-import-document-properties.mjs` with Animate available. `node server/scripts/smoke-test-movie.mjs` creates and closes a disposable AS3 FLA; it leaves the Test Movie Player open for you to close manually. `smoke-document-ops.mjs` (AS3) and `smoke-canvas.mjs` (HTML5 Canvas) each create, exercise and close a disposable saved FLA.

## License

[MIT License](LICENSE)
