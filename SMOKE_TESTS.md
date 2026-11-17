# Real-Animate tests

## Run

Start Animate on a Mac. **Manually save and close open documents**, then run from the repository root. Also close existing Test Movie Players before prompt tests. Do not interact with Animate during a run. Real-Animate tests do not run in CI.

| Scope | Command | Model billing |
| --- | --- | --- |
| Smoke | `npm run build && npm run smoke` | No |
| Prompt tests | `npm run verify:prompt -- --allow-paid` | Yes |
| Both | `npm run verify:all -- --allow-paid` | Yes |

Prompt tests give natural-language instructions to an AI and verify the resulting operations in real Animate. They default to an authenticated Claude CLI. To use Codex, prefix the command with `PROMPT_E2E_PROVIDER=codex`. Model selection and billing follow the CLI configuration. `canvas` also needs Chrome.

**Codex isolation is not proven equivalent to Claude's restricted mode.** A read-only sandbox is requested, but native tools and user-level instructions may remain available. Review and approve the risks before running.

## Results and safety

- **Evidence:** `summary.json` and individual logs in `verification-runs/<run-ID>/`. Smoke also writes `smoke-report.json`. Review CLI output before sharing.
- **Stopping:** Each scenario runs once, sequentially, without retries. Stop after three consecutive failures or an Animate exit, restart, unresponsive state, or document cleanup failure. Combined runs do not proceed to prompt tests after a smoke failure.
- **Cleanup:** User documents are never closed automatically. Close any remaining Test Movie Player manually.
- **`testmovie`:** Included in prompt tests. Cleanup closes all Players. The harness checks for an empty document session, but you must manually confirm that no existing Players are open.
- **Verdicts:** SKIP and NOT_RUN do not mean verified. Check their reasons.

In an empty session, smoke `canvas` and `document-ops` each use a temporary saved baseline FLA to check that another open document is preserved. Smoke `publish` creates and publishes its own AS3 FLA and checks its SWF output. Owned documents are closed by their exact returned URI; cleanup failures stop the batch.

## Nonpaid harness tests

These use neither real Animate nor a model.

```sh
npm run test:verification
npm run test:prompt-e2e
```

<details>
<summary>Individual runs and output paths</summary>

- Smoke subset: `npm run smoke -- capture-frame edit-text` (build first).
- One prompt-test scenario (paid, explicit approval required; build first):

  ```sh
  RUN_PROMPT_E2E=1 PROMPT_E2E_SCENARIO=layer node server/verification/prompt-e2e/runner.mjs
  ```

- Scenarios: `layer` / `stage` / `script` / `investigate` / `text` / `tween` / `instance` / `symbol` / `inspect` / `library` / `capture` / `assets` / `publish` / `testmovie` / `canvas`.
- Close existing Players before standalone `testmovie` too. GreenSock installation is not covered.
- Output directory: `VERIFICATION_RUN_DIR=/path/to/dir`. Smoke report only: `SMOKE_REPORT=/path/to/report.json`.
- The old `verify:readme`, `test:readme-e2e`, and `README_*E2E*` environment variables are no longer supported. Update your commands to the new names. Historical diagnostics and run evidence are not moved or deleted.
- Scripts: `server/verification/smoke/scenarios/`. Most use disposable FLAs. **`smoke-publish.mjs <name.fla>...` publishes the named existing documents; without arguments it creates an owned disposable FLA.**

</details>

<details>
<summary>Preflights, diagnostics, and fixture maintenance</summary>

Run `npm run build` first.

- **Codex connection preflight (no model or Animate):**
  `PROMPT_E2E_SCENARIO=stage node server/verification/prompt-e2e/runner.mjs --codex-preflight`
  Checks config parsing, handshake, and allowlists using a temporary HOME and fake MCP. Does not use normal Codex config or authentication, or prove write approval.
- **Real-Animate fixture preflight (no model):**
  `PROMPT_E2E_SCENARIO=capture node server/verification/prompt-e2e/runner.mjs --fixture-preflight`
  Uses empty Animate to verify a disposable FLA and frame-12 PNG pixels. Other scenarios can also be selected.
- **Entrance dispatch:** With a disposable AS3 document, save `[{"tool":"get_status"}]` as `steps.json`, then run `node server/verification/smoke/scenarios/smoke-run.mjs --entrances steps.json`. Does not test client approval dialogs.
- **Persistent diagnostics:** `~/.animate-mcp/prompt-e2e-diagnostics/diagnostics.jsonl` (private permissions, rolling 64 KiB). Records categorical results, exit codes, and the CLI version probed in an isolated environment. `PROMPT_E2E_DIAGNOSTICS=1` adds allowlisted counters and enums. Raw CLI output, credentials, and MCP URLs are not recorded.
- **Input recording:** `SMOKE_RECORD_DIR=/path/to/dir` writes full tool inputs to local JSONL, including text and JSFL. Use only nonconfidential disposable data. No automatic uploads.
- **Shape updates:** `node server/verification/smoke/lib/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>` updates result shapes while preserving reviewed arguments. Excludes `run_jsfl`; tools without reviewed fixtures fail.
- **Codex limits:** Only the dedicated MCP `execute_write` entrance is preapproved; document and scenario restrictions are enforced server-side. Write approval is live-verified, but full isolation is not. Unlike Claude, there is no turn-count cap; the harness times out after five minutes.

</details>

<details>
<summary>Manual checks</summary>

1. With a document open, execute `fl.trace('hi'); 'ok'` via `run_jsfl` → Output panel shows `hi`, return value is `"ok"`. Animate comes to the front.
2. `execute_readonly` → `get_document_info` → name, size, frame rate, and timeline names.
3. Manually save and close documents, then repeat → `"No document open"`.
4. Quit Animate, then call `run_jsfl` → `"Animate not running"`.

</details>
