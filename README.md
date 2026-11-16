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
- Read and edit AIR application descriptors, with a dry-run diff and backup.

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
- Script editing runs Export → edit → Apply. Re-export after changing Animate following an Export, or after changing the timeline or library.
- Edited `.fla` files are not saved automatically. Use `save_document` or save in Animate.

## Tools

### Public MCP tools

The server exposes these four MCP tools by default:

| MCP tool | Purpose |
|----------|---------|
| `search_tools` | Search operation schemas and caveats |
| `execute_readonly` | Run read-only operations |
| `execute_write` | Run all other operations (read-only operations are rejected) |
| `run_jsfl` | Run JSFL directly (can be denied separately) |

Permissions apply per `execute_readonly` / `execute_write`; “always allow” covers everything under that entrance. Existing permission rules for individual operation names (such as `mcp__animate__publish`) no longer match. See [TOOLS.md](TOOLS.md) for the operations and details.

### Operations

The operations below are not separate MCP tools; pass them as `name` to `execute_readonly` / `execute_write`.

| Area | Operation | What it does |
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
|  | `get_air_descriptor` | Read AIR app settings from an adjacent or explicitly named descriptor |
|  | `set_air_descriptor` | Edit AIR app settings in an adjacent or explicitly named descriptor |
|  | `preflight_publish` | Check publish readiness (including AIR descriptor and icons) without publishing |
|  | `read_output` | Read the Output and Compiler Errors panels |
|  | `test_movie` | Run an AS3 Test Movie and capture compile diagnostics and early output |
|  | `verify_canvas_output` | Open Canvas output in Chrome and check for errors |
|  | `capture_frame` | Capture a frame or range as PNG |
|  | `diff_captures` | Compare two captured PNGs |
|  | `visual_regression` | Save and compare named frame baselines |
| Other | `install_greensock` | Install GreenSock-AS3 (saved AS3 only; license review required) |

## Environment variables

| Name                          | Description                                  | Default               |
|-------------------------------|----------------------------------------------|-----------------------|
| `ANIMATE_MCP_TIMEOUT_MS`      | Execution timeout                            | 30000                 |
| `ANIMATE_MCP_RUNS_DIR`        | Working directory                            | `~/.animate-mcp/runs` |
| `ANIMATE_MCP_LAUNCH_COMMAND`  | Custom command to open the `.jsfl` file      | OS default            |
| `ANIMATE_MCP_PROCESS_PATTERN` | Custom process pattern to detect Animate     | OS default            |

## How it works

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.png">
    <img src="assets/architecture-light.png" alt="Architecture: AI agent, MCP tools, JSFL runner, Adobe Animate and Chrome" width="560">
  </picture>
</div>

Each tool builds a JSFL script, writes it to `~/.animate-mcp/runs/`, and opens it in the running Animate. The script writes its result as JSON, which the server reads back. Runs are serialized and time out if Animate does not respond.

## Bug reports

Please open an [issue](https://github.com/gekkyo/animate-mcp/issues) with your Animate version, OS, steps to reproduce and error messages.

## Development

From the repository root, install dependencies, build, and run the tests:

    npm install && npm run build
    npm test

To register the built server with an MCP client, set its launch command to `node /path/to/animate-mcp/server/dist/index.js`. Replace `/path/to/animate-mcp` with the actual path to this repository.

To try one operation on the built server without registering it with a client, run this from the repository root (`get_status` example):

    npm run -s call -- execute_readonly '{"name":"get_status","arguments":{}}'

For release checks with real Animate, see [Smoke tests](SMOKE_TESTS.md).

## License

[MIT License](LICENSE)
