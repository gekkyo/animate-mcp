# animate-mcp

Adobe Animate 2024（macOS）で JSFL を実行する MCP サーバー。

    npm install && npm run build
    npm test

MCP クライアントの設定: `node /path/to/animate-mcp/server/dist/index.js`（stdio）。Animate を起動しておく必要がある。
環境変数: `ANIMATE_MCP_TIMEOUT_MS`（既定 30000）、`ANIMATE_MCP_RUNS_DIR`（既定 `~/.animate-mcp/runs`）。

## 手動スモークテスト（実機の Animate）

1. ドキュメントを開いた状態で Animate を起動する。
2. `fl.trace('hi'); 'ok'` で `run_jsfl` を実行する。出力パネルに `hi` が表示され、ツールは `"ok"` を返す。Animate が前面に出る（既知の挙動）。
3. `get_document_info` を実行する。開いているドキュメントの名前、サイズ、フレームレート、タイムライン名が返る。
4. すべてのドキュメントを閉じて `get_document_info` を実行する。"No document open" が返る。
5. Animate を終了して `run_jsfl` を実行する。"Animate not running" が返る。
6. 未確認: モーダルダイアログが開いているときの挙動。

注: JSFL には `JSON` がないため、`run_jsfl` が返せるのはプリミティブ値のみ。オブジェクトは文字列になる。
