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

`animate-mcp` is a local Model Context Protocol (MCP) server that lets AI agents inspect Adobe Animate documents and edit frame scripts and animations. It uses JSFL, Animate's scripting system, to control Animate directly.

Agents can read scripts and structure from scenes and library symbols, then apply edited scripts through files. They can also edit layers, frames, tweens, and library items.

## Highlights

- AI agents can read frame scripts and structure from scenes and library symbols through files, then apply edited scripts back to Animate.
- Inspect layers, keyframes, instances, and tweens.
- Edit layer and frame structure and labels.
- Create motion and classic tweens with preset or custom Bézier easing.
- Organize library folders and items and find unused items.
- Install GreenSock-AS3 with a prompt.
- Work with ActionScript 3 and HTML5 Canvas, and run arbitrary JSFL.

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
- Save manually in Animate. Renaming or moving a library item does not automatically update linkage names or string references in code.

## Tools

| Tool | What it does | Inputs and caveats |
|------|--------------|--------------------|
| `get_document_info` | Reports the open document's name, dimensions, frame rate, timeline names, ActionScript version, and GreenSock status. | Takes no arguments. |
| `export_scripts` | Exports scene and library-symbol structure and frame scripts, plus `index.md` and each timeline's `structure.md`. | Defaults to `~/.animate-mcp/exports/<document name>/`. Refuses to re-export over unapplied edits; `force: true` discards them. |
| `apply_scripts` | Applies edits to exported scripts in Animate. An empty script file deletes that frame's script. | Pass the export directory as `dir`. Frames changed in Animate are not overwritten. Does not save the `.fla`. |
| `inspect_timeline` | Reads layers, keyframe ranges, and instances and tweens at a specified frame of a scene or library symbol. | `timeline` is a zero-based scene index or library-item path. Frame numbers are one-based; layers can be filtered. |
| `edit_timeline` | Edits layers, frames, keyframes, and labels, and distributes instances across layers. Runs operations in `ops` order. | `deleteLayer` and `removeFrames` require `confirm: true`. `shiftLayerFrames` overwrites the clipboard and may require Undo if it fails partway through. |
| `edit_tween` | Creates motion or classic tweens and changes easing. Supports presets, numeric easing, and four-number custom easing. | The named instance must be alone on its layer. Existing tween spans are not replaced. |
| `edit_library` | Creates folders, moves, renames, and deletes items, and lists unused items. | Deletion requires `confirm: true` and refuses items in use. Linkage names and string references in code are not updated. |
| `install_greensock` | Fetches GreenSock-AS3 12.1.5 from GitHub and places it alongside a saved AS3 document. | Review the [license](https://gsap.com/standard-license/) and pass `confirm: true`. Does not change or save the `.fla`; does not support AS2 or HTML5 Canvas. |
| `run_jsfl` | Executes arbitrary JSFL in Animate and returns the result. Object return values become strings. | Can modify documents and files; ask the user before running code that makes changes. |

### Operations accepted in `ops`

`edit_timeline`, `edit_tween`, and `edit_library` accept the following operations in their `ops` arrays.

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
| `listUnused` | List unused items |

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
