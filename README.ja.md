# animate-mcp

[English](README.md) | 日本語

Adobe Animate で JSFL を実行し、フレーム／シンボルのスクリプトをファイルとして編集できる MCP サーバーです。Adobe とは無関係の非公式ツールです。

## インストール

### 動作環境

- Node.js
- Adobe Animate（起動しておく必要があります）
- 動作確認は Animate 2024 / macOS のみです。他の最近のバージョンでも動く見込みです。Windows は未検証です。

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
- スクリプトのないフレームに追加するには、タイムラインのディレクトリに `as/<フレーム番号>.as`（HTML5 Canvas は `.js`）を作成して `apply_scripts` を実行します。トゥイーン内への追加は拒否されます。
- レイヤーやフレームの構造変更には `edit_timeline` を使います。構造を変更した後は、スクリプトの編集や適用の前に必ず `export_scripts` を再実行してください。レイヤーやフレームの削除には `confirm: true` が必要です。
- 保存したい場合は、Animate 側で手動で保存してください。
- ActionScript 3 と HTML5 Canvas の両ドキュメントに対応しています。

## ツール

| ツール              | 内容                                                                               |
|---------------------|------------------------------------------------------------------------------------|
| `export_scripts`    | タイムライン構造と全フレームスクリプト（シーンとライブラリシンボル）を書き出します |
| `edit_timeline`     | シーンまたはライブラリシンボルのレイヤーとフレームを追加・削除・編集します            |
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
