<div align="center">

# animate-mcp

MCP 対応の AI エージェントから、Adobe Animate のスクリプトとタイムライン構造を編集します。

[English](README.md) | 日本語

[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
[![license MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## 概要

`animate-mcp` は、AI エージェントが Adobe Animate を JSFL（Animate のスクリプト機能）経由で操作できるようにする、ローカルの MCP（Model Context Protocol）サーバーです。Adobe とは無関係の非公式ツールです。

フレームスクリプトをファイルとして書き出し、エージェントが編集して、Animate に書き戻します。レイヤーやフレームの構造変更や、任意の JSFL の実行もできます。

## 主な機能

- シーンとライブラリシンボルの全フレームスクリプトを、構造の説明つきでファイルに書き出します。
- 編集したファイルを Animate に書き戻します。Export 後に Animate 側で変更した箇所は、競合として検出して上書きしません。
- レイヤーの追加・削除・移動・名前変更・種類変更（マスク、フォルダなど）ができます。
- ライブラリのフォルダやアイテム（シンボル、画像、サウンドなど）を整理できます。フォルダ作成、移動、名前変更、削除、未使用アイテム一覧に対応します。削除には確認が必要で、使用中のアイテムは削除できません。
- フレームの挿入・削除、キーフレームの操作、ラベル設定、トゥイーンの長さ調整、レイヤーの開始位置のずらしができます。
- 任意の JSFL を実行して、結果を返します。
- ActionScript 3 と HTML5 Canvas のドキュメントに対応しています。

## 動作環境

- Node.js
- Adobe Animate（起動しておく必要があります）
- MCP 対応のクライアント（Claude Code、Claude Desktop など）
- 動作確認は Animate 2024 / macOS のみです。他の最近のバージョンでも動く見込みです。Windows は未検証です。

## インストール

### Claude Code

    claude mcp add animate -- npx -y animate-mcp@latest

### JSON で設定するクライアント（Claude Desktop など）

    {
      "mcpServers": {
        "animate": {
          "command": "npx",
          "args": ["-y", "animate-mcp@latest"]
        }
      }
    }

## 使い方

1. Animate を起動し、対象の .fla を開きます。
2. エージェントに依頼します。例:
    - 「開いているドキュメントのスクリプトを書き出して、`stageUp` のエラー原因を調べて」
    - 「このシーンのボタン処理を整理して、Animate に反映して」
3. 内部では次の順に動きます。
    1. `export_scripts` が構造と全フレームスクリプトを `~/.animate-mcp/exports/<ドキュメント名>/` に書き出します。
    2. エージェントがファイルを編集します。
    3. `apply_scripts` が Animate に書き戻します。

注意:

- 複数のドキュメントを開いているときは、`document` でどれかを指定してください。
- Export 後に Animate 側で変更した箇所は、Apply で競合として検出され、上書きされません。
- 未反映の編集があると Export は拒否されます。破棄してよい場合のみ `force: true` を使ってください。
- レイヤーやフレームの構造変更には `edit_timeline` を使います。`shiftLayerFrames` は他のレイヤーをずらさず、1つのレイヤーの内容を後ろへ移動します。構造を変更した後は、スクリプトの編集や適用の前に必ず `export_scripts` を再実行してください。レイヤーやフレームの削除には `confirm: true` が必要です。
- ライブラリの整理には `edit_library` を使います（`createFolder`、`moveItem`、`renameItem`、`deleteItem`、`listUnused`）。`apply_scripts` の前に `export_scripts` を再実行してください。`deleteItem` には `confirm: true` が必要で、使用中のアイテムは削除できません。ライブラリが Export 後に変わると Apply は拒否されます。リンケージ名は変更されず、`attachMovie` などコード内の文字列参照も自動では更新されません。
- 保存したい場合は、Animate 側で手動で保存してください。
- ActionScript 3 と HTML5 Canvas の両ドキュメントに対応しています。

## ツール

| ツール              | 内容                                                                               |
|---------------------|------------------------------------------------------------------------------------|
| `export_scripts`    | タイムライン構造と全フレームスクリプト（シーンとライブラリシンボル）を書き出します |
| `edit_timeline`     | シーンまたはライブラリシンボルのレイヤーとフレームを追加・削除・編集します         |
| `edit_library`      | ライブラリのフォルダやアイテムを整理し、未使用アイテム一覧を返します               |
| `apply_scripts`     | 編集したスクリプトを開いているドキュメントに書き戻します                           |
| `get_document_info` | 開いているドキュメントの名前、サイズ、フレームレート、タイムライン名を返します     |
| `run_jsfl`          | 任意の JSFL を実行して結果を返します（プリミティブ値のみ。オブジェクトは文字列）   |

## 環境変数

| 名前                          | 内容                                 | 既定値                |
|-------------------------------|--------------------------------------|-----------------------|
| `ANIMATE_MCP_TIMEOUT_MS`      | 実行タイムアウト                     | 30000                 |
| `ANIMATE_MCP_RUNS_DIR`        | 作業ディレクトリ                     | `~/.animate-mcp/runs` |
| `ANIMATE_MCP_LAUNCH_COMMAND`  | `.jsfl` を開くための独自起動コマンド | OS 既定               |
| `ANIMATE_MCP_PROCESS_PATTERN` | 起動判定用の独自プロセスパターン     | OS 既定               |

## 不具合報告

[Issues](https://github.com/gekkyo/animate-mcp/issues) へお願いします。Animate のバージョン、OS、再現手順、エラーメッセージを添えてください。

## 開発

    npm install && npm run build
    npm test

クライアント設定: `node /path/to/animate-mcp/server/dist/index.js`（stdio）。

### 手動スモークテスト（実機の Animate）

1. ドキュメントを開いた状態で Animate を起動します。
2. `fl.trace('hi'); 'ok'` で `run_jsfl` を実行します。出力パネルに `hi` が表示され、ツールは `"ok"` を返します。Animate が前面に出ます（既知の挙動）。
3. `get_document_info` を実行します。名前、サイズ、フレームレート、タイムライン名が返ります。
4. すべてのドキュメントを閉じて `get_document_info` を実行します。"No document open" が返ります。
5. Animate を終了して `run_jsfl` を実行します。"Animate not running" が返ります。
6. 未確認: モーダルダイアログが開いているときの挙動。
