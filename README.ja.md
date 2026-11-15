<div align="center">

# animate-mcp

AI エージェントから Adobe Animate を操作するための MCP サーバー。

[English](README.md) | 日本語

[変更履歴](CHANGELOG.md)

[![CI](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/gekkyo/animate-mcp/actions/workflows/ci.yml)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/animate-mcp)](https://www.npmjs.com/package/animate-mcp)
[![license MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## 概要

`animate-mcp` は、Claude CodeやCodexなどのAIエージェントからAdobe Animateを直接操作できるMCPサーバーです。

AIに自然な言葉で指示するだけで、フレームスクリプトの編集やアニメーションの操作、繰り返し作業の自動化ができます。

シーンやライブラリシンボルの構造・スクリプトを読み取り、既存の内容を理解したうえで編集できるほか、レイヤーやフレーム、トゥイーン、インスタンスのプロパティ、ライブラリ内のアセットなど、幅広い操作に対応しています。さらに、ドキュメントのパブリッシュやフレームのPNG画像取得も可能です。

## 主な機能

- シーン・ライブラリシンボルの構造とフレームスクリプトの読み込み・編集
- レイヤー、キーフレーム、インスタンス、テキスト、トゥイーンの確認・編集
- ライブラリの整理、素材の取り込み、シンボルの作成・配置、ステージ設定
- 使われていないライブラリ項目・中身のないキーフレーム等のチェック
- AS3／HTML5 Canvas の Publish、AS3 のコンパイル診断・Test Movie
- Canvas 出力の Chrome での確認、フレームの PNG 取得・差分比較
- GreenSock-AS3 の導入、任意の JSFL の実行

## 仕組み

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.png">
  <img src="assets/architecture-light.png" alt="Architecture: AI agent, MCP tools, JSFL runner, Adobe Animate and Chrome" width="560">
</picture>

各ツールは JSFL スクリプトを生成して `~/.animate-mcp/runs/` に書き出し、起動中の Animate で開いて実行します。スクリプトは結果を JSON で書き出し、サーバーがそれを読み取ります。実行は直列で、Animate が応答しない場合はタイムアウトします。

## 動作環境

- Node.js
- Adobe Animate（起動しておく必要があります）
- MCP 対応のクライアント（Claude Code、Claude Desktop など）
- Animate 2027 / Mac / Windows

## インストール

### Claude Code

    claude mcp add animate-mcp -- npx -y animate-mcp@latest

### JSON で設定するクライアント（Claude Desktop など）

    {
      "mcpServers": {
        "animate-mcp": {
          "command": "npx",
          "args": ["-y", "animate-mcp@latest"]
        }
      }
    }

## 使い方

1. Animate を起動し、対象の .fla を開きます。
2. エージェントに作業を依頼します。
3. スクリプトを編集する場合は、次の順に動きます。
    1. `export_scripts` が構造と全フレームスクリプトを `~/.animate-mcp/exports/<ドキュメント名>/` に書き出します。
    2. エージェントがファイルを編集します。
    3. `apply_scripts` が Animate に書き戻します。

### プロンプト例

#### スクリプト操作

```text
開いているドキュメントのスクリプトを書き出して、エラーの原因を調べて
```

#### タイムライン確認

```text
シーン1の『キャラ』レイヤーの12フレーム目にあるインスタンスとトゥイーンを確認して
```

#### レイヤーとフレーム編集

```text
シーン1に『背景』レイヤーを追加して、24フレーム分に延ばして
```

#### トゥイーン作成

```text
シーン1の『ボール』インスタンスを1〜24フレームで右へ200px動かし、イーズに backOut（少し行き過ぎて戻る）を使って
```

#### インスタンスのプロパティ編集

```text
シーン1の1フレーム目の『ボール』インスタンスを透明度50%にして、ぼかしフィルターを付けて
```

#### Publish

```text
開いているドキュメントを Publish して、コンパイルエラーを教えて
```

#### フレームの取得

```text
シーン1の12フレーム目を画像で取得して、見た目を教えて
```

#### ライブラリ整理

```text
ライブラリの未使用アイテムを一覧にして
```

#### GreenSock 導入

```text
開いているドキュメントに GreenSock-AS3 を導入して
```

## 利用時のポイント

- 複数のドキュメントを開いている場合は、対象を指定してください。
- Export 後に Animate 側を変更すると、Apply 時に競合を検出します。ライブラリを変更した場合は Apply できません。
- 未反映の編集があると再 Export はできません。破棄してよい場合に限り `force: true` を使ってください。
- タイムライン・トゥイーン・ライブラリを変更した後は、スクリプトを編集・適用する前に再 Export してください。
- レイヤー・フレーム・ライブラリアイテムの削除には `confirm: true` が必要です。使用中のライブラリアイテムは削除できません。
- 保存には `save_document`（上書き時は事前に確認）か Animate の保存操作を使います。`edit_library` の `getLinkage` と `setLinkage` で AS3 のリンケージを読み書きできます。アイテムの名前変更・移動によって、リンケージ名やコード内の文字列参照が自動更新されるわけではありません。
- `edit_elements` はトゥイーン途中のフレームを拒否し、書き込み前に全操作を検証します。`.fla` は保存されません。

## ツール

引数や注意点の詳細は [TOOLS.ja.md](TOOLS.ja.md) を参照してください。

| 分類 | ツール | できること |
|------|--------|------------|
| ドキュメント | `get_document_info` | 名前・サイズ・フレームレート・AS バージョンを確認 |
|  | `open_document` | `.fla` を開く／新規ドキュメントを作成 |
|  | `save_document` | ドキュメントを保存 |
|  | `close_document` | 保存せずにドキュメントを閉じる |
|  | `set_document_properties` | ステージサイズ・フレームレート・背景色を変更 |
|  | `audit_document` | 未使用のライブラリ項目や空キーフレームを一覧化 |
| スクリプト | `export_scripts` | フレームスクリプトと構造をファイルに書き出す |
|  | `apply_scripts` | 編集したスクリプトを Animate に反映 |
| タイムライン・要素 | `inspect_timeline` | レイヤー・キーフレーム・インスタンス・トゥイーンを確認 |
|  | `edit_timeline` | レイヤー・フレーム・キーフレーム・ラベルを編集 |
|  | `edit_tween` | トゥイーンの作成とイージング変更 |
|  | `edit_elements` | シンボルインスタンスの編集・配置 |
|  | `edit_text` | テキストの追加・編集 |
|  | `convert_to_symbol` | 要素をシンボルに変換 |
| ライブラリ | `edit_library` | 整理・使用箇所の検索・AS3 リンケージ編集 |
|  | `import_assets` | 画像・音声をライブラリに取り込む |
| 出力・確認 | `publish` | Publish して Build result を返す |
|  | `read_output` | Output / Compiler Errors パネルを読む |
|  | `test_movie` | AS3 の Test Movie を実行して出力を取得 |
|  | `verify_canvas_output` | Canvas 出力を Chrome で開いてエラーを確認 |
|  | `capture_frame` | フレームまたは範囲を PNG で取得 |
|  | `diff_captures` | キャプチャ PNG 2枚を比較 |
| その他 | `install_greensock` | GreenSock-AS3 を導入 |
|  | `run_jsfl` | 任意の JSFL を実行 |

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
6. 保存済みの AS3 ドキュメントを開いた状態で `publish` を実行します。`ok: true` と空の `errors` が返ります。構文エラーを入れて再実行すると `errors` に出ます。
7. `capture_frame` を実行します。PNG 画像と保存先のパスが返ります。
8. 未確認: モーダルダイアログが開いているときの挙動。

手順 6〜7 と各ツールのスクリプト検証: `npm run build` の後、Animate を起動して `node server/scripts/smoke-publish.mjs`、`smoke-capture-frame.mjs`、`smoke-edit-elements.mjs`、`smoke-edit-library.mjs`、`smoke-edit-text.mjs`、`smoke-import-document-properties.mjs` を実行します。`node server/scripts/smoke-test-movie.mjs` は使い捨ての AS3 FLA を作成・クローズしますが、Test Movie Player は開いたままなので手動で閉じてください。`smoke-document-ops.mjs`（AS3）と `smoke-canvas.mjs`（HTML5 Canvas）は、使い捨ての保存済み FLA を作成して操作し、クローズします。

## ライセンス

[MIT ライセンス](LICENSE)
