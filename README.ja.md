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

`animate-mcp` は、MCP（Model Context Protocol）対応の AI エージェントから Adobe Animate のドキュメントを調べ、フレームスクリプトやアニメーションを編集するためのローカルサーバーです。JSFL（Animate のスクリプト機能）を利用し、Animate を直接操作します。

シーンやライブラリシンボルのスクリプトと構造を読み取り、スクリプトをファイル経由で書き戻すことができます。レイヤー・フレーム・トゥイーンやライブラリの操作にも対応します。

## 主な機能

- AI エージェントがシーンやライブラリシンボルのフレームスクリプトと構造をファイル経由で読み取り、編集したスクリプトを Animate に書き戻せます。
- レイヤー、キーフレーム、インスタンス、トゥイーンの状態を確認できます。
- レイヤーやフレームの構造、ラベルを編集できます。
- モーション／クラシックトゥイーンを作成し、プリセットやベジェ曲線によるカスタムイーズを設定できます。
- ライブラリのフォルダやアイテムを整理し、未使用アイテムを確認できます。
- GreenSock-AS3 をプロンプトから簡単に導入できます。
- ActionScript 3 と HTML5 Canvas に対応し、任意の JSFL も実行できます。

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
- Animate 上の保存は手動です。ライブラリの名前変更・移動でも、リンケージ名とコード内の文字列参照は自動更新されません。

## ツール

| ツール | できること | 入力・注意点 |
|--------|------------|--------------|
| `get_document_info` | 開いているドキュメントの名前、サイズ、フレームレート、タイムライン名、ActionScript のバージョン、GreenSock の導入状況を確認します。 | 引数は不要です。 |
| `export_scripts` | シーンとライブラリシンボルの構造・フレームスクリプトを書き出し、`index.md` と各タイムラインの `structure.md` も生成します。 | 既定の出力先は `~/.animate-mcp/exports/<ドキュメント名>/`。未適用の編集があると再 Export を拒否します。`force: true` はその編集を破棄します。 |
| `apply_scripts` | 書き出したスクリプトの編集を Animate に反映します。空ファイルはそのフレームのスクリプト削除を意味します。 | Export 先の `dir` を指定します。Animate 側で変更されたフレームは上書きしません。`.fla` は保存しません。 |
| `inspect_timeline` | シーンやライブラリシンボルのレイヤー、キーフレーム範囲、指定フレームのインスタンス・トゥイーンを読み取ります。 | `timeline` は 0 始まりのシーン番号かライブラリアイテムのパス。フレーム番号は 1 始まりで、レイヤーも絞り込めます。 |
| `edit_timeline` | レイヤー・フレーム・キーフレーム・ラベルを編集し、インスタンスをレイヤーに分配します。操作は `ops` の順に実行します。 | `deleteLayer` と `removeFrames` は `confirm: true` が必要です。`shiftLayerFrames` はクリップボードを上書きし、失敗時に Undo が必要な場合があります。 |
| `edit_tween` | モーション／クラシックトゥイーンの作成とイージングの変更を行います。プリセット、数値、4 つの数値によるカスタムイーズに対応します。 | 対象の名前付きインスタンスはレイヤー上で単独である必要があります。既存のトゥイーン範囲は置換しません。 |
| `edit_library` | フォルダ作成、アイテムの移動・名前変更・削除、未使用アイテムの一覧取得を行います。 | 削除は `confirm: true` が必要で、使用中のアイテムは削除できません。リンケージ名やコード内の参照文字列は自動更新しません。 |
| `install_greensock` | 保存済みの AS3 ドキュメントの隣に GreenSock-AS3 12.1.5 を GitHub から取得・配置します。 | [ライセンス](https://gsap.com/standard-license/)の確認後に `confirm: true` が必要です。`.fla` は変更・保存せず、AS2・HTML5 Canvas は対象外です。 |
| `run_jsfl` | 任意の JSFL コードを Animate で実行して結果を返します。オブジェクトの返却値は文字列になります。 | ドキュメントやファイルを変更するコードも実行できます。変更操作の前にユーザーの確認が必要です。 |

### `ops` で指定できる操作

`edit_timeline`、`edit_tween`、`edit_library` は、以下の操作を `ops` に並べて指定できます。

#### `edit_timeline`

| 操作 | 内容 |
|------|------|
| `addLayer` | レイヤーを追加する |
| `deleteLayer` | レイヤーを削除する（`confirm: true` 必須） |
| `moveLayer` | レイヤーを移動する |
| `renameLayer` | レイヤー名を変更する |
| `setLayerType` | レイヤーの種類を変更する |
| `distributeToLayers` | 1 スパンのレイヤーにあるシンボルインスタンスを、それぞれ別のレイヤーに分配する |
| `insertFrames` | フレームを挿入する |
| `removeFrames` | フレームを削除する（`confirm: true` 必須） |
| `insertKeyframe` | キーフレームを挿入する |
| `clearKeyframe` | キーフレームを解除する |
| `setLabel` | フレームラベルを設定する |
| `setSpanLength` | フレームスパンの長さを変更する |
| `shiftLayerFrames` | ほかのレイヤーを動かさず、1 つのレイヤーの内容を後ろへ移動する |

#### `edit_tween`

| 操作 | 内容 |
|------|------|
| `createTween` | 指定インスタンスにモーション／クラシックトゥイーンを作成する |
| `setEase` | 既存トゥイーンのイージングを変更する |

#### `edit_library`

| 操作 | 内容 |
|------|------|
| `createFolder` | フォルダを作成する |
| `moveItem` | アイテムを別のフォルダへ移動する |
| `renameItem` | アイテム名を変更する |
| `deleteItem` | アイテムを削除する（`confirm: true` 必須。使用中は削除不可） |
| `listUnused` | 未使用アイテムを一覧にする |

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
