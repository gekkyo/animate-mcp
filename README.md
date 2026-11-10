<div align="center">

# animate-mcp

Edit Adobe Animate scripts and timeline structure from an MCP-compatible AI agent.

English | [日本語](README.ja.md)

[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
[![license MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## Overview

`animate-mcp` is a local Model Context Protocol (MCP) server that lets an AI agent control Adobe Animate through JSFL, Animate's scripting system. Unofficial; not affiliated with Adobe.

It exports frame scripts as plain files, lets the agent edit them, and applies them back to Animate. It can also change layer and frame structure and run arbitrary JSFL.

## Highlights

- Export every frame script of scenes and library symbols to files, with a description of the structure.
- Apply edited files back to Animate. Changes made in Animate after Export are detected as conflicts and never overwritten.
- Add a new script to a frame that has none, just by creating a file.
- Add, delete, move, rename, and retype layers (mask, folder, and more).
- Organize library folders and items; create folders, move, rename, delete, or list unused items. Deletion requires confirmation and refuses items in use.
- Insert or remove frames, work with keyframes, set labels, adjust tween length, and shift a layer's start.
- Run arbitrary JSFL and return the result.
- Supports ActionScript 3 and HTML5 Canvas documents.

## Requirements

- Node.js
- Adobe Animate (must be running)
- An MCP-compatible client (Claude Code, Claude Desktop, etc.)
- Verified only on Animate 2024 / macOS. Other recent versions should work. Windows is untested.

## Install

### Claude Code

    claude mcp add animate -- npx -y animate-mcp@latest

### Clients configured with JSON (Claude Desktop, etc.)

    {
      "mcpServers": {
        "animate": {
          "command": "npx",
          "args": ["-y", "animate-mcp@latest"]
        }
      }
    }

## Usage

1. Start Animate and open the target .fla.
2. Ask your agent. Examples:
    - "Export the scripts of the open document and find the cause of the `stageUp` error."
    - "Clean up the button handling in this scene and apply it to Animate."
3. Behind the scenes:
    1. `export_scripts` writes the structure and every frame script to `~/.animate-mcp/exports/<document name>/`.
    2. The agent edits the files.
    3. `apply_scripts` writes them back into Animate.

Notes:

- When several documents are open, specify which one with `document`.
- Changes made in Animate after an Export are detected as conflicts on Apply and are not overwritten.
- Export is refused while unapplied edits exist. Use `force: true` only when it is fine to discard them.
- To add a script to a frame with none, create `as/<frame>.as` in the timeline directory (use `.js` for HTML5 Canvas), then run `apply_scripts`; scripts inside tween spans are refused.
- Use `edit_timeline` for layer and frame structure changes; `shiftLayerFrames` moves one layer's content later without shifting other layers. Always run `export_scripts` again before editing or applying scripts; layer and frame deletions require `confirm: true`.
- Use `edit_library` to organize folders and library items (`createFolder`, `moveItem`, `renameItem`, `deleteItem`, `listUnused`). Re-export with `export_scripts` before `apply_scripts`; `deleteItem` requires `confirm: true` and refuses items in use.
- To save, save manually in Animate.
- Both ActionScript 3 and HTML5 Canvas documents are supported.

## Tools

| Tool                | Description                                                                                  |
|---------------------|----------------------------------------------------------------------------------------------|
| `export_scripts`    | Writes the timeline structure and all frame scripts (scenes and library symbols)             |
| `edit_timeline`    | Adds, removes, moves and edits layers and frames in a scene or library symbol                |
| `edit_library`     | Organizes library folders and items, and lists unused items                                 |
| `apply_scripts`     | Writes edited scripts back into the open document                                            |
| `get_document_info` | Returns name, size, frame rate and timeline names of the open documents                      |
| `run_jsfl`          | Runs arbitrary JSFL and returns the result (primitive values only; objects become strings)   |

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
6. Unverified: behavior while a modal dialog is open.
