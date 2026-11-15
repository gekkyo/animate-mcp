# Animate / JSFL quirks (verified on Animate 2027, macOS)

- `fl.setActiveWindow(doc)` takes effect only after the Run returns. Create/activate in one Run, operate in the next.
- The Compiler Errors panel follows the active document. Tools that read it (`publish`, `test_movie`) activate the chosen document in a separate Run first.
- Save a new document with `fl.saveDocument(doc, fileURI)` (`doc.saveAs` does not exist). Animate normalizes `doc.pathURI` (`file:///Macintosh%20HD/...` on macOS), so never compare it to the URI you passed; use the returned value. Helpers: `createSavedAs3Document`, `closeDocumentByPath` in `server/scripts/smoke-lib.mjs`.
- The Test Movie Player is a window inside Animate. Leave it open for the user to close with its window button. In the prototype, Cmd+W after AppleScript window targeting may have closed a user's FLA. `fl.closeAllPlayerDocuments()` closes all Player windows by API semantics, not just the one launched by a smoke test (not tested here). Close only a disposable FLA by exact `pathURI` with `close(false)`.
- `server/jsfl/timeline/*.jsfl` are concatenated into one IIFE: `layers.jsfl` opens it, `index.jsfl` closes it. New timeline JSFL must not add its own IIFE wrapper. Check `server/src/jsfl-bundle.ts` for the file order.
- The JSFL host has no standard `JSON` global (`JSON is not defined`). Return primitives or delimiter-joined strings from a Run; build JSON on the Node side.
- Animate renames a layer called `static` to `static_idn`. Use another name in tests.
- Direct writes to a tween's middle frame change the start keyframe (classic) or insert a `Motion_X` keyframe (motion). Never write them.
- Direct assignment ignores layer locks. `edit_timeline` and `edit_elements` unlock and restore explicitly.
- `doc.modified` is always undefined; read the window title (a trailing `*`) via AppleScript instead.
- `fl.publishDocument` returns true even on compile errors; read `fl.compilerErrors.save(uri)` after it. See `docs/adr/0003-...`.
- Real-Animate runner for ad-hoc JSFL: `node <tmp>/run.mjs file.jsfl`. Smoke scripts: `server/scripts/smoke-*.mjs` (shared setup in `smoke-lib.mjs`), run after `npm run build` with the document active in Animate.

## Additional DOM probes (Animate 2027, macOS; AS3 and HTML5 Canvas)

- `doc.addNewText({left, top, right, bottom})` adds a text element and returns `undefined`; the element reports `elementType === "text"`, while `instanceType` is `undefined`. Use `setTextString(str)` / `getTextString()` to replace/read the text. `textRuns[0].characters` also reads/writes the content. Style lives on `textRuns[0].textAttrs` (`size`, `face`, `fillColor`, `bold`, `italic`), and `setTextAttr(name, value)` works. `textType` accepts `static`, `dynamic`, `input` in AS3; Canvas accepts `static`/`dynamic` but rejects `input`. `alignment` accepts `left`/`center`/`right`/`justify`. AS3 only supports `lineType` on `dynamic`/`input` text (set `textType` first): `single line`, `multiline`, and `multiline no wrap`; setting or reading `lineType` on static text throws. Canvas rejects `single line` and accepts the other two on supported text types.
- `doc.importFile(fileURI, true, false)` returns `true` for PNG, WAV and MP3, adds them to the Library (item names retain the extension), and leaves the stage unchanged in both document types. `importFileToLibrary` is not a function on the Document, Library, or `fl` objects tested. A colliding import opens the modal `ライブラリの競合を解決` and blocks the Run; options are `既存のアイテムを置き換えない` (default) / `既存のアイテムを置き換える`, buttons `キャンセル` / `OK`. With the default + OK, the existing item remains and a second item appears as `<name> コピー` (e.g. `proto.png コピー`, `proto.wav コピー`, `proto.mp3 コピー`). Therefore check `doc.library.itemExists(name)` and refuse before calling `importFile`; do not let this modal block a tool Run.
- `doc.library.addNewItem("graphic", name)` returns `true`; the Library item reports `itemType`/`symbolType` `graphic`. `addItemToDocument({x, y}, name)` returns `true`; the stage instance reports `elementType` `instance`, `instanceType` `symbol`. On both AS3 and Canvas, `element.loop` reads/writes (`loop` → `play once`); `element.firstFrame` reads/writes when the graphic has multiple frames (0 → 2 after extending its timeline to 3 frames); `element.symbolType` reads/writes `graphic`. `element.swapElement` is not a function.
- In AS3 and Canvas, `width`, `height`, `frameRate`, and `backgroundColor` read/write and persist after `fl.saveDocument` and reopen. Resizing 550×400 to 640×360 left a stage instance at `x=50,y=60` unchanged. `library.duplicateItem(name)` returns `true` and names the copy `<name> コピー` in this locale; rename with `library.renameItem(newName, oldName)` (argument order is new name first). Usage can be found by scanning each timeline's layers/frames/elements and reading `element.libraryItem.name`; `library.editItem(symbolName)` enters a symbol timeline and its instances are found the same way.
- The swap API is `doc.swapElement(libraryItemName)`, not `element.swapElement`. In both AS3 and Canvas, select an instance with `doc.selection = [element]`; this adds to the current selection rather than replacing it, so call `doc.selectNone()` first to avoid swapping other selected instances. A successful call returns `undefined`, replaces the Library item, preserves x/y, scale, rotation, `loop`, and `firstFrame`, and leaves the old element reference valid (`oldElement === rereadElement` stayed true). Assigning `element.libraryItem = libraryItem` also swaps successfully and preserves those values. A nonexistent name throws `swapElement: 引数番号 1 は無効です。` without changing the instance; selecting a text element throws `「swapElement」には、範囲の選択が必要です。` and leaves the text unchanged. No modal appeared for success or these errors.

## Isolated Canvas Publish smoke

`server/scripts/smoke-isolated-publish.mjs` creates and saves a new HTML5 Canvas document in a fresh `os.tmpdir()` directory, adds a graphic Library item, publishes there, records the output file listing and `fl.compilerErrors` availability, then closes without saving and removes the directory. It refuses to run unless Animate is already running. Run with `npm run build && node server/scripts/smoke-isolated-publish.mjs`.

Verified on Animate 2027, macOS: `fl.compilerErrors` exists (`object`) and its `save` member is a `function`, but the Canvas `publish` tool reports `compilerOutput: "not_checked"` (compile errors remain unverified). Publish produced `<FLA stem>.html` and `<FLA stem>.js` alongside the saved FLA; no images directory appeared in this empty document. Exact listing from the run:

```text
RECOVER_animate-mcp-isolated-publish-hXHKlo.fla
animate-mcp-isolated-publish-hXHKlo.fla
animate-mcp-isolated-publish-hXHKlo.html
animate-mcp-isolated-publish-hXHKlo.js
```
