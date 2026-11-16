# Smoke tests (real Animate)

## Quick start

Start Animate on a Mac, then run this from the repository root. These tests need real Animate and do not run in CI.

    npm run build && npm run smoke

Results are saved in `smoke-report.json`. Confirm that every check passes.

## Manual checks

The scripts cannot verify these:

1. With a document open, run `run_jsfl` with `fl.trace('hi'); 'ok'`. `hi` appears in the Output panel and the tool returns `"ok"`. Animate comes to the front (known behavior).
2. Run `get_document_info` through `execute_readonly`. It returns name, size, frame rate and timeline names.
3. Close all documents and run `get_document_info` through `execute_readonly`. It returns "No document open".
4. Quit Animate and run `run_jsfl`. It returns "Animate not running".

## Optional checks

- **Run a subset:** Specify targets, for example `npm run smoke -- document-ops capture-frame`.
- **Check the Entrance path:** For a disposable AS3 document, save `[{"tool":"get_status"}]` as `steps.json` and run `node server/scripts/smoke-run.mjs --entrances steps.json`. This checks dispatch in Animate, not a client's approval dialog.
- **Record runs:** Set `SMOKE_RECORD_DIR=/path/to/dir` to write JSONL with full tool input values, including text and JSFL. Use only nonconfidential disposable test data. Files stay local and are not uploaded automatically.
- **Refresh shape fixtures:** Run `node server/scripts/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>`. It updates result shapes but keeps each fixture's reviewed sample arguments. The `run_jsfl` fixture is excluded from automatic updates to keep its reviewed shape and runnable safe sample paired; tools without a reviewed fixture fail clearly.

## Individual scripts

Most scripts create a disposable FLA, exercise it and close it without touching your documents. `smoke-publish.mjs` is the exception: it publishes the documents you pass by name.

| Script | Checks | Notes |
| --- | --- | --- |
| `smoke-publish.mjs <name.fla>...` | `publish` | Uses your open documents |
| `smoke-capture-frame.mjs` | `capture_frame` | Disposable FLA |
| `smoke-edit-elements.mjs` | Layer, frame, tween and instance edits | Disposable FLA |
| `smoke-edit-library.mjs` | Library edits | Disposable AS3 FLA |
| `smoke-edit-text.mjs` | `edit_text` | Disposable AS3 and HTML5 Canvas FLAs |
| `smoke-import-document-properties.mjs` | Import and stage settings | Disposable FLA |
| `smoke-document-ops.mjs` | open, save, close | Disposable saved AS3 FLA |
| `smoke-canvas.mjs` | HTML5 Canvas features | Disposable saved FLA |
| `smoke-isolated-publish.mjs` | `publish` and its output | Disposable saved AS3 FLA; Animate must already be running |
| `smoke-verification-tools.mjs` | `audit_document`, `verify_canvas_output`, `capture_frame`, `diff_captures` | Disposable saved FLA |
| `smoke-test-movie.mjs` | `test_movie` | Disposable AS3 FLA; **leaves the Test Movie Player open, so close it manually** |
