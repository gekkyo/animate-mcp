# Coding standards

Biome enforces formatting and basic style; ESLint enforces JSDoc for TypeScript, MJS and JSFL (`npm run lint` runs both). Each JSFL file must parse on its own: shared files hold top-level functions that take `timeline`, `document` or `ctx` as parameters, and only entry files open and close an IIFE. These cover what the checks cannot.

- **Type safety**: use typed shared helpers (e.g. `runPublish`) rather than `as never` casts or calling another tool's `run` with fake arguments; ESLint rejects `as never` except for documented, line-scoped SDK type-erasure boundaries.
- **One source for a helper**: extract duplicated path guards or similar utilities instead of copying them between tools.
- **Least exposure**: a local server or file reader exposes only what the feature needs (allowlisted extensions, no dot-segments, realpath checks); never a whole directory by default.
- **JSFL**: keep it ES3/ES5-compatible with no `JSON` global; key lookup maps by prefixed strings (`'$' + name`), never plain `{}` keys; check `docs/animate-quirks.md` before relying on an Animate API.
- **Read-only tools**: tools that claim `readOnlyHint` must restore every document state they touch and report failure to restore.
- **Tool registration**: update the tool file, its JSFL file if needed, one line in `TOOLS` in `server/src/index.ts`, the README/TOOLS tables (`README.md`, `README.ja.md`, `TOOLS.md`, `TOOLS.ja.md`), and `CHANGELOG.md`. Declare JSFL entry dependencies in a top-of-file `// @requires entry/name, ...` header.
- **Comments**: write them in English. Every named function (including JSFL helpers, test helpers, and smoke-script helpers) gets a JSDoc block: a one-line summary, `@param name Description.` per parameter, and `@returns Description.` unless it returns nothing. Add a short `//` comment only where a reader would struggle: non-obvious regexes, magic numbers, ordering constraints, security guards, Animate quirks, and odd test fixtures. Keep comments accurate when code changes.
- **Unverified Animate behavior**: label guesses as guesses in code, docs and tool output. In code, start the comment with `unverified:` so `grep -rn "unverified:"` lists every guess; never write "verified" in docs for a case you did not run in real Animate.
- **Review evidence**: when reviewing Animate or AIR behavior, identify external assumptions in the diff and check for a real-app/SDK test or an explicit `unverified:` label; a passing mock test is not evidence of runtime behavior.
- **Range operations**: a test for an operation over a frame/layer range includes a case with an element strictly between the endpoints (the fake's default fixtures only have keyframes at the ends).

## What each test layer proves

- **Recording fake** (`server/test/helpers/fake-jsfl.ts`): tool logic only. Asserts the JSFL entry name, vars and how a canned result is validated and shaped. Proves nothing about JSFL itself.
- **`fake-animate.ts`**: the generated Run file executes in a Node VM against a fake Animate. Proves JSFL syntax, `@requires` closure and control flow, not real Animate API behavior.
- **`real-shapes.test.ts`**: replays result shapes recorded from real Animate. Proves the result schemas accept real output, only as fresh as the recording.
- **Smoke scripts and readme-e2e** (`server/verification/`): run in real Animate. The only evidence of Animate/AIR behavior; needs user approval.

Change a tool's logic or schema: recording fake. Change JSFL: also `fake-animate` and `real-shapes`. Change JSFL calling an Animate API, or a new `unverified:` guess: a real-Animate smoke run, or keep the `unverified:` label.
