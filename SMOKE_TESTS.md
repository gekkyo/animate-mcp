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
- **Check the Entrance path:** For a disposable AS3 document, save `[{"tool":"get_status"}]` as `steps.json` and run `node server/verification/smoke/scenarios/smoke-run.mjs --entrances steps.json`. This checks dispatch in Animate, not a client's approval dialog.
- **Record runs:** Set `SMOKE_RECORD_DIR=/path/to/dir` to write JSONL with full tool input values, including text and JSFL. Use only nonconfidential disposable test data. Files stay local and are not uploaded automatically.
- **Refresh shape fixtures:** Run `node server/verification/smoke/lib/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>`. It updates result shapes but keeps each fixture's reviewed sample arguments. The `run_jsfl` fixture is excluded from automatic updates to keep its reviewed shape and runnable safe sample paired; tools without a reviewed fixture fail clearly.

## Individual scripts

The following files live under `server/verification/smoke/`.

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

## README prompt E2E

`server/verification/readme-e2e/` holds a separate harness: it sends README prompts through Claude or Codex CLI and a restricted MCP server to real Animate. Claude remains the default; select Codex explicitly with `README_PROMPT_E2E_PROVIDER=codex`.

- **Nonpaid checks:** `npm run test:readme-e2e` builds the server and runs fixture, file-scope, MCP discovery and fake-CLI tests. It does not launch a real Claude/Codex CLI or Animate, and runs as a separate CI step; `npm test` is unchanged.
- **Codex parser/handshake preflight (no model or Animate):** After `npm run build`, run `README_PROMPT_E2E_SCENARIO=stage node server/verification/readme-e2e/runner.mjs --codex-preflight`. It checks the installed Codex parser against the production `codexArgs` inline config overrides with an inert fake MCP command under fresh temporary `HOME` and `CODEX_HOME` directories, then uses the SDK with the explicit restricted child environment to verify the MCP handshake and entrance allowlist. It does not read normal Codex configuration, require auth, execute Animate tools, or prove tool-write approval.
- **Real-Animate fixture preflight (no model):** Start Animate with no documents open, then run `npm run build` and `README_PROMPT_E2E_SCENARIO=capture node server/verification/readme-e2e/runner.mjs --fixture-preflight`. It creates and closes a disposable FLA, checks the production fixture, invokes only the restricted frame-12 capture path, and verifies the PNG pixels. Other scenarios can be selected with `README_PROMPT_E2E_SCENARIO`; `canvas` also needs Chrome.
- **Persistent diagnostics:** Failure/success metadata is written outside disposable workspaces to `~/.animate-mcp/readme-e2e-diagnostics/diagnostics.jsonl` with private directory/file permissions and rolling 64 KiB retention. Default records contain fixed allowlisted metadata, a categorical failure reason/exit code, and a validated CLI version (or `unavailable`), probed once in an isolated temporary home. Set `README_E2E_DIAGNOSTICS=1` to include additional allowlisted counters and enum fields; raw CLI output, credentials, authentication content, and MCP URLs are never recorded.
- **Real E2E (explicit approval required):** Start Animate with no documents open, authenticate the selected CLI, then run from the repository root:

      npm run build
      RUN_README_PROMPT_E2E=1 README_PROMPT_E2E_SCENARIO=layer node server/verification/readme-e2e/runner.mjs

  For Codex, add `README_PROMPT_E2E_PROVIDER=codex` to the command. It uses the Codex CLI's existing authentication and does not force a model; usage and billing depend on that CLI configuration. Both providers operate on a disposable FLA. Do not interact with Animate while the test runs. Other scenarios are `stage`, `script`, `investigate`, `text`, `tween`, `instance`, `symbol`, `inspect`, `library`, `capture`, `assets`, `publish`, `testmovie`, and `canvas`. GreenSock installation is not covered. `canvas` also needs Chrome.

  **Codex safety is not proven equivalent to Claude's restricted mode.** The harness requests a read-only sandbox and disables several Codex integrations, but native tools may remain available and user-level instructions may still load. Only the dedicated MCP server's `execute_write` entrance is preapproved; document-scope and scenario restrictions remain enforced by that server. Unlike Claude, Codex has no equivalent per-scenario turn-count cap; the harness timeout is five minutes. Live runs have verified this write approval, but isolation is not fully verified. Obtain safety/risk approval before running Codex E2E.
