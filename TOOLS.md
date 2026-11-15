# Tools

[English](TOOLS.md) | [日本語](TOOLS.ja.md)

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
| `audit_document` | Read-only suggestions for unused Library items, empty keyframes, and default-looking English/Japanese layer and symbol names. Optional `document` selects an open document by name; otherwise it requires a single open document. | Findings include severity and location and are review heuristics, not proof of defects. Unused items may be referenced by external code; linkage-bearing items are specifically marked as not safe to infer deletion. Direct timeline usage is scanned across scenes and symbols; nested/runtime references are not proven. The tool temporarily visits timelines and restores the prior edit context and selection. |
| `capture_frame` | Returns PNG images of one frame or an inclusive range from the active timeline, including a library symbol being edited. | Specify either `frame` or `range` (not both; an error otherwise). `frame` is 1-based and defaults to the current frame; `range: { start, end, step? }` (1-based, ascending and inclusive; `step` defaults to 1, must be a positive integer, and at most 24 frames are captured). Range results return ordered image/metadata pairs and `structuredContent.captures`. Saves each image under `~/.animate-mcp/captures/<document>/` or `dir`; unsaved documents are supported. The current frame is restored, but changing frames may clear the selection. Stages larger than 2048px on either side are refused, without scaling. |
| `diff_captures` | Compares two existing Capture PNGs and returns a red-highlight difference image plus changed-pixel count, percentage, and bounding box. | Use absolute paths inside `~/.animate-mcp/captures/`; dimensions must match. `tolerance` defaults to 8 and ignores a pixel when every RGBA channel differs by no more than that value. An unchanged image has `boundingBox: null`. A new diff PNG is saved beside the earlier Capture without overwriting existing files. |
| `inspect_timeline` | Reads layers, keyframe ranges, instances, text, and tweens at a specified frame of a scene or library symbol. | `timeline` is a zero-based scene index or library-item path. Frame numbers are one-based; layers can be filtered. Text includes its string and whole-field style. |
| `edit_elements` | Sets symbol-instance transforms, names, color effects, filters, blend modes, visibility, graphic loop/firstFrame, and swaps symbols; or adds a Library item to a timeline. | Set operations use layer and element names or zero-based indexes; `{ op: "add", item, layer, frame, x?, y?, set? }` places a Library item on a named layer at a 1-based frame, creating the layer and extending the timeline if needed. Omitted coordinates default to the stage center. `set.swapSymbol` names an existing Library symbol; `set.loop` and `set.firstFrame` apply only to graphics. Non-instances and tween interiors are refused, and all operations are validated before any write. Supplying `filters` replaces all existing filters; `[]` clears them. Read-back element fields match `inspect_timeline` with added layer/frame/element references. Rotation and skew cannot be set together in one operation. Does not save the `.fla`. |
| `edit_text` | Adds text to a scene or symbol timeline or edits an existing text field. | `timeline` is a scene index or Library path; `ops` contains `{ op: "add", layer, frame, rectangle: { left, top, right, bottom }, text, style? }` or `{ op: "set", layer, frame, element, text?, style? }`. Style can set face, size, fillColor, bold, italic, alignment, textType, and lineType for the whole field. Canvas refuses input and single-line text. No per-character styling; does not save the `.fla`. |
| `import_assets` | Imports images and audio to the Library, not the stage. | `paths` is a nonempty array of absolute PNG/JPEG/GIF/WAV/MP3 file paths. Existing Library names or duplicate input names are refused before importing; no overwrite or auto-rename. `document` is optional; does not save the `.fla`. |
| `set_document_properties` | Sets stage width, height, frame rate, and background color. | Specify at least one of `width`, `height` (integer pixels, 1–3840; 3840 was tested as accepted and is the tool's conservative cap, not a verified Animate maximum), `frameRate` (0.01–120), or `backgroundColor` (`#RRGGBB`). Does not scale or move stage content or save the `.fla`; `document` is optional. |
| `convert_to_symbol` | Converts explicitly addressed elements on one timeline frame into a movie clip, button, or graphic. | Supply a scene or Library timeline, one-based frame, element references, unique symbol name, and optional registration point (center by default). Refuses tween interiors; does not set linkage or save the `.fla`. Use `edit_library`'s `setLinkage` separately for AS3 linkage. |
| `edit_timeline` | Edits layers, frames, keyframes, and labels, and distributes instances across layers. Runs operations in `ops` order. | `deleteLayer` and `removeFrames` require `confirm: true`. `shiftLayerFrames` overwrites the clipboard and may require Undo if it fails partway through. |
| `edit_tween` | Creates motion or classic tweens and changes easing. Supports presets, numeric easing, and four-number custom easing. | The named instance must be alone on its layer. Existing tween spans are not replaced. |
| `edit_library` | Creates folders and symbols, moves, renames, duplicates, and deletes items, finds direct usages, lists unused items, and reads or updates AS3 linkage. | `findUsages` reports direct scene/symbol timeline placements only: `timeline` is a scene index or a symbol path, and sound uses have `element: null`. `createSymbol` requires a unique name and type; `duplicateItem` requires `newName`. `getLinkage` and `setLinkage` support Flash/AS3 documents only. `setLinkage` accepts `exportForAS`, `className`, `baseClass`, and `exportInFirstFrame`, and returns Animate's read-back values. With export disabled, the linkage fields are `{ exportForAS: false, className: "", baseClass: "", exportInFirstFrame: false }`; results also include the item `name`. Setting class/base or enabling first-frame export requires `exportForAS: true`. If `setLinkage` changes a movie clip, graphic, or button's AS3 export or class name, rerun `export_scripts` to refresh linked-class metadata in the export workspace; `apply_scripts` rejects exports with stale linkage. `listUnused` returns Animate's own unused-item list as is; it has not been verified for fonts, bitmaps, sounds, or linkage items, so treat results as candidates, not proof that an item is safe to delete. Deletion requires `confirm: true` and refuses items in use. Moving or renaming does not update code-string references. |
| `install_greensock` | Fetches GreenSock-AS3 12.1.5 from GitHub and places it alongside a saved AS3 document. | Review the [license](https://gsap.com/standard-license/) and pass `confirm: true`. Does not change or save the `.fla`; does not support AS2 or HTML5 Canvas. |
| `run_jsfl` | Executes arbitrary JSFL in Animate and returns the result. Object return values become strings. | Can modify documents and files; ask the user before running code that makes changes. |

## Operations accepted in `ops`

`edit_timeline`, `edit_tween`, and `edit_library` accept the following operations in their `ops` arrays. `edit_elements` accepts `{ layer, frame, element, set }` to update an existing instance, or `{ op: "add", item, layer, frame, x?, y?, set? }` to add a Library item; see its row in the table above.

### `edit_timeline`

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

### `edit_tween`

| Operation | Description |
|-----------|-------------|
| `createTween` | Create a motion or classic tween for a named instance |
| `setEase` | Change an existing tween's easing |

### `edit_library`

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

## Parameters of the edit tools

`edit_timeline`, `edit_tween`, `edit_elements`, and `edit_text` take `timeline` (zero-based scene index or Library item path) and one or more `ops`. `edit_library` takes `ops`. All tools accept an optional `document`. A layer is specified by name and optional zero-based `index`; frame numbers are one-based. Operations run in order and stop at the first failure; `edit_timeline`, `edit_tween`, and `edit_library` return `applied`, `failed`, `skipped`, and `warnings`.

### `edit_timeline`

| Operation | Required arguments | Optional arguments and notes |
|-----------|--------------------|------------------------------|
| `addLayer` | `name` | `type` (`normal`, `mask`, `masked`, `guide`, `folder`), `parent`, `above`, `below` |
| `deleteLayer` | `layer`, `confirm: true` | |
| `moveLayer` | `layer` | `above`, `below`, `parent`, `index` |
| `renameLayer` | `layer`, `name` | |
| `setLayerType` | `layer`, `type` | `parent` |
| `insertFrames` / `removeFrames` | `layer`, `frame`, `count` | `ripple`; `removeFrames` also requires `confirm: true` |
| `insertKeyframe` / `clearKeyframe` | `layer`, `frame` | |
| `setLabel` | `layer`, `frame`, `label` | |
| `setSpanLength` | `layer`, `frame`, `length` (2 or more) | `ripple` |
| `shiftLayerFrames` | `layer`, `offset` (positive integer) | |
| `distributeToLayers` | `layer` | |

Returns the resulting layer list (`name`, `type`, `parent`, `locked`). Tween interiors reject frame insertion, removal, and keyframe changes.

### `edit_tween`

| Operation | Required arguments | Optional arguments and notes |
|-----------|--------------------|------------------------------|
| `createTween` | `layer`, `instance`, `keyframes` (two or more; each has `frame`, and the set has at least one tween property) | `kind` (`motion` by default, or `classic`) |
| `setEase` | `layer`, `frame`, `ease` | |

Keyframe properties: `x`, `dx`, `y`, `dy`, `scaleX`, `scaleY`, `rotation`, `alpha` (0–100), `brightness` (-100–100), `tint` (`{ color, amount }`), `blur`, `glow`, `dropShadow`, and `ease`. `alpha`, `brightness`, and `tint` are mutually exclusive color modes.

`ease` accepts a preset name (`linear`, or `quad`/`cubic`/`quart`/`quint`/`sine`/`expo`/`circ`/`back` with `In`/`Out`/`InOut`), a number from -100 to 100, or four numbers for a custom curve. An object (`default`, `x`, `y`, `rotation`, `scaleX`, `scaleY`, `alpha`, `brightness`, `tint`, `blur`, `glow`, `dropShadow`) sets easing per property.

### `edit_library`

| Operation | Required arguments | Optional arguments and notes |
|-----------|--------------------|------------------------------|
| `createFolder` | `path` | |
| `moveItem` | `item`, `toFolder` (`""` for root) | |
| `renameItem` / `duplicateItem` | `item`, `newName` | |
| `deleteItem` | `item`, `confirm: true` | Cannot delete while in use |
| `createSymbol` | `type` (`movie clip`, `button`, `graphic`), `name` | |
| `findUsages` / `getLinkage` | `item` | |
| `listUnused` | None | |
| `setLinkage` | `item` and at least one of `exportForAS`, `className` (not empty), `baseClass`, `exportInFirstFrame` | |

Name collisions are refused. `newName` and `name` cannot contain `/`; paths use `/` between folders. Results are returned per operation under `results`.

### `edit_elements`

| Operation | Required arguments | Optional arguments and notes |
|-----------|--------------------|------------------------------|
| Update | `layer`, `frame`, `element`, `set` | `layer` and `element` can be a name or zero-based index |
| Add | `op: "add"`, `item`, `layer`, `frame` | `x`, `y`, `set` |

`set` needs at least one field: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `skewX`, `skewY`, `name`, `blendMode`, `visible`, `loop` (`loop`, `play once`, `single frame`), `firstFrame`, `swapSymbol`, `colorEffect`, `filters`.

`colorEffect`: `{ mode: "none" }`, `{ mode: "alpha", alphaPercent }`, `{ mode: "brightness", brightnessPercent }`, `{ mode: "tint", tintColor, tintPercent }`, or `{ mode: "advanced", ... }` with at least one of `redPercent`, `greenPercent`, `bluePercent`, `redAmount`, `greenAmount`, `blueAmount`.

Animate may quantize transform values. Temporary layer unlocks, the selection, and the current frame are restored. Returns `applied` and `elements`; element fields match `inspect_timeline` plus layer/frame/element references.

### `edit_text`

| Operation | Required arguments | Optional arguments and notes |
|-----------|--------------------|------------------------------|
| Add | `op: "add"`, `layer`, `frame`, `rectangle`, `text` | `style` |
| Set | `op: "set"`, `layer`, `frame`, `element` | At least one of `text` or `style` |

`rectangle` is `{ left, top, right, bottom }` with finite numbers and positive width and height; `text` cannot be empty. Missing layers are created, the timeline is extended, and a keyframe is made when needed.

`style` needs at least one field: `face`, `size` (positive), `fillColor` (`#RRGGBB`), `bold`, `italic`, `alignment` (`left`, `center`, `right`, `justify`), `textType` (`static`, `dynamic`, `input`), `lineType` (`single line`, `multiline`, `multiline no wrap`). `lineType` works only on `dynamic` or `input` text. Tween spans and non-text elements are refused.
