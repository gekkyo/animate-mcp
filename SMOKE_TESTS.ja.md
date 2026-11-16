# スモークテスト（実機の Animate）

## まず実行

Mac で Animate を起動し、リポジトリのルートから実行します。実機が必要なため CI では実行しません。

    npm run build && npm run smoke

結果は `smoke-report.json` に保存されます。すべて PASS であることを確認してください。

## 手動で確認

次の項目はスモークテストのスクリプトだけでは確認できません。

1. ドキュメントを開いた状態で `fl.trace('hi'); 'ok'` を `run_jsfl` で実行します。出力パネルに `hi` が表示され、ツールは `"ok"` を返します。Animate が前面に出ます（既知の挙動）。
2. `execute_readonly` から `get_document_info` を実行します。名前、サイズ、フレームレート、タイムライン名が返ります。
3. すべてのドキュメントを閉じて `execute_readonly` から `get_document_info` を実行します。"No document open" が返ります。
4. Animate を終了して `run_jsfl` を実行します。"Animate not running" が返ります。

## 必要な場合だけ

- **対象を絞る:** `npm run smoke -- document-ops capture-frame` のように指定できます。
- **Entrance 経由を確認する:** 使い捨ての AS3 ドキュメントで `[{"tool":"get_status"}]` を `steps.json` に保存し、`node server/scripts/smoke-run.mjs --entrances steps.json` を実行します。Animate 上の振り分けは確認できますが、クライアントの承認ダイアログは確認できません。
- **実行を記録する:** `SMOKE_RECORD_DIR=/path/to/dir` を設定すると、テキストや JSFL を含むツール入力値全体が JSONL に記録されます。機密情報を含まない使い捨てテストデータだけで使用してください。記録はローカルに保存され、自動アップロードされません。
- **形状フィクスチャを更新する:** `node server/scripts/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>` を実行します。結果形状だけを更新し、レビュー済みのサンプル引数は保持します。`run_jsfl` は安全な実行可能サンプルと形状の組を維持するため自動更新しません。レビュー済みフィクスチャがないツールはエラーになります。

## 個別スクリプト一覧

多くのスクリプトは使い捨ての FLA を作成して操作し、クローズします。手持ちのドキュメントには触れません。例外は `smoke-publish.mjs` で、名前を渡したドキュメントを Publish します。

| スクリプト | 確認内容 | 備考 |
| --- | --- | --- |
| `smoke-publish.mjs <name.fla>...` | `publish` | 開いているドキュメントを使用 |
| `smoke-capture-frame.mjs` | `capture_frame` | 使い捨ての FLA |
| `smoke-edit-elements.mjs` | レイヤー・フレーム・トゥイーン・インスタンスの編集 | 使い捨ての FLA |
| `smoke-edit-library.mjs` | ライブラリの編集 | 使い捨ての AS3 FLA |
| `smoke-edit-text.mjs` | `edit_text` | 使い捨ての AS3・HTML5 Canvas FLA |
| `smoke-import-document-properties.mjs` | 素材の取り込み・ステージ設定 | 使い捨ての FLA |
| `smoke-document-ops.mjs` | open・save・close | 使い捨ての保存済み AS3 FLA |
| `smoke-canvas.mjs` | HTML5 Canvas 機能 | 使い捨ての保存済み FLA |
| `smoke-isolated-publish.mjs` | `publish` と出力 | 使い捨ての保存済み AS3 FLA。Animate は事前に起動しておく |
| `smoke-verification-tools.mjs` | `audit_document`・`verify_canvas_output`・`capture_frame`・`diff_captures` | 使い捨ての保存済み FLA |
| `smoke-test-movie.mjs` | `test_movie` | 使い捨ての AS3 FLA。**Test Movie Player は開いたままなので手動で閉じる** |
