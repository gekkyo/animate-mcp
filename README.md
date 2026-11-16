<div align="center">

<img src="assets/logo.svg" alt="animate-mcp" width="140">

# animate-mcp

An MCP server for operating Adobe Animate from AI agents

English | [日本語](README.ja.md)

[Changelog](CHANGELOG.md)

---

[![CI](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
[![npm downloads](https://img.shields.io/npm/dw/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
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
- Create motion and classic tweens with preset or custom Bézier easing, and shape tweens between raw shapes.
- Organize library folders and items and find unused items.
- Import images and audio, find direct Library usages, create or duplicate symbols, and change stage properties.
- Publish AS3 and HTML5 Canvas documents and get AS3 compile errors and warnings back.
- Read Animate's diagnostic panels and run an AS3 Test Movie to capture compile diagnostics and early Output panel text.
- Capture a frame or range as PNG images.
- Check for unused Library items and empty keyframes.
- Verify Canvas HTML in Chrome and compare captured PNGs.
- Install GreenSock-AS3 with a prompt (saved AS3 documents only; review the license first).
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

#### Editing a script

```text
Add stop() to the frame 1 script in Scene 1 and apply it
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

#### Adding text

```text
Add a text field reading "GAME OVER" in 48 pt bold on frame 30 of the Text layer in Scene 1
```

#### Converting to a symbol

```text
Convert the Ball on frame 1 of Scene 1 into a movie clip named ball_mc
```

#### Editing instance properties

```text
Set the Ball instance on frame 1 of Scene 1 to 50% alpha and add a blur filter
```

#### Changing stage settings

```text
Set the stage to 1280×720 at 30 fps with a black background
```

#### Importing assets

```text
Import /path/to/hero.png and /path/to/bgm.mp3 into the library
```

#### Publishing

```text
Publish the open document and tell me the compile errors
```

#### Running Test Movie

```text
Run Test Movie on the open AS3 document and show the compile errors and early output
```

#### Verifying Canvas output

```text
Verify the Canvas output in Chrome and report any console errors
```

This publishes first and overwrites the outputs. To check existing output only, say "without publishing".

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
Install GreenSock-AS3 into the saved AS3 document (I have reviewed the license)
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

Full inputs and caveats are in [TOOLS.md](TOOLS.md).

| Area | Tool | What it does |
|------|------|--------------|
| Document | `get_document_info` | Show name, size, frame rate, and AS version |
|  | `get_status` | Check Animate response and list open documents |
|  | `open_document` | Open a `.fla` or create a new document |
|  | `save_document` | Save a document |
|  | `close_document` | Close a document without saving |
|  | `set_document_properties` | Set stage size, frame rate, and background color |
|  | `audit_document` | List unused Library items and empty keyframes |
| Scripts | `export_scripts` | Export frame scripts and structure to files |
|  | `apply_scripts` | Apply edited scripts back to Animate |
| Timeline and elements | `inspect_timeline` | Read layers, keyframes, instances, tweens, and optional geometry |
|  | `edit_timeline` | Edit layers, frames, keyframes, and labels |
|  | `edit_tween` | Create tweens and change easing |
|  | `edit_elements` | Edit or place symbol instances |
|  | `edit_text` | Add and edit text fields |
|  | `convert_to_symbol` | Convert elements to a symbol |
| Library | `edit_library` | Organize items, find usages, edit AS3 linkage |
|  | `import_assets` | Import images and audio into the Library |
| Output and verification | `publish` | Publish and return the Build result |
|  | `preflight_publish` | Check publish readiness (including AIR descriptor and icons) without publishing |
|  | `read_output` | Read the Output and Compiler Errors panels |
|  | `test_movie` | Run an AS3 Test Movie and capture compile diagnostics and early output |
|  | `verify_canvas_output` | Open Canvas output in Chrome and check for errors |
|  | `capture_frame` | Capture a frame or range as PNG |
|  | `diff_captures` | Compare two captured PNGs |
|  | `visual_regression` | Save and compare named frame baselines |
| Other | `install_greensock` | Install GreenSock-AS3 (saved AS3 only; license review required) |
|  | `run_jsfl` | Run arbitrary JSFL |

## Environment variables

| Name                          | Description                                  | Default               |
|-------------------------------|----------------------------------------------|-----------------------|
| `ANIMATE_MCP_TIMEOUT_MS`      | Execution timeout                            | 30000                 |
| `ANIMATE_MCP_RUNS_DIR`        | Working directory                            | `~/.animate-mcp/runs` |
| `ANIMATE_MCP_LAUNCH_COMMAND`  | Custom command to open the `.jsfl` file      | OS default            |
| `ANIMATE_MCP_PROCESS_PATTERN` | Custom process pattern to detect Animate     | OS default            |

## How it works

```mermaid
%%{init: {'themeVariables': {'fontSize': '13px'}, 'flowchart': {'nodeSpacing': 30, 'rankSpacing': 30, 'diagramPadding': 8}}}%%
flowchart TB
  Agent(["AI agent<br/>Claude Code / Codex"])
  subgraph Server["animate-mcp (Node.js)"]
    Tools["MCP tools ×27"]
    Bundle["JSFL bundle<br/>server/jsfl/*.jsfl"]
    Runner["Runner<br/>serial + timeout"]
  end
  Files["exports/<br/>scripts + structure.md"]
  Chrome(["Chrome"])
  Animate(["Adobe Animate<br/>(running)"])
  Agent -->|"edit files"| Files
  Agent -->|"MCP stdio"| Tools
  Tools -->|"export / apply"| Files
  Tools -->|"verify_canvas_output"| Chrome
  Tools --> Bundle --> Runner
  Runner -->|"1. open Run.jsfl"| Animate
  Animate -.->|"2. write Result.json"| Runner
```

Each tool builds a JSFL script, writes it to `~/.animate-mcp/runs/`, and opens it in the running Animate. The script writes its result as JSON, which the server reads back. Runs are serialized and time out if Animate does not respond.

## Bug reports

Please open an [issue](https://github.com/gekkyo/animate-mcp/issues) with your Animate version, OS, steps to reproduce and error messages.

## Development

    npm install && npm run build
    npm test

Client config: `node /path/to/animate-mcp/server/dist/index.js` (stdio).

To call one tool on the locally built server (not a separately registered one): `npm run call -- <tool> '<json object>'`, e.g. `npm run call -- get_status '{}'`.

### Smoke tests (real Animate)

Manual checks not covered by the scripts below:

1. With a document open, run `run_jsfl` with `fl.trace('hi'); 'ok'`. `hi` appears in the Output panel and the tool returns `"ok"`. Animate comes to the front (known behavior).
2. Run `get_document_info`. It returns name, size, frame rate and timeline names.
3. Close all documents and run `get_document_info`. It returns "No document open".
4. Quit Animate and run `run_jsfl`. It returns "Animate not running".

Scripted checks: run `npm run build`, then start Animate and run the scripts below as `node server/scripts/<script>`.

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

## License

[MIT License](LICENSE)
