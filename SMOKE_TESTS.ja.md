# スモークテスト（実機の Animate）

## まず実行

Mac で Animate を起動し、リポジトリのルートから実行します。実機が必要なため CI では実行しません。

    npm run build && npm run smoke

結果は `verification-runs/<実行ID>/` に保存されます。smoke は `smoke-report.json` と `summary.json`、README・統合実行は `summary.json` と各シナリオのログを確認してください。PASS だけでなく、FAIL・SKIP・未実行の項目と理由も確認してください。

## 一括実行の入口

用途別に3つの入口を使います。実行前に Animate を起動し、開いているドキュメントは自分で保存して閉じてください。実行中は Animate を操作しないでください。

- **smoke 全件:** `npm run build && npm run smoke`
- **README 実機全件（有料、build 含む）:** `npm run verify:readme -- --allow-paid`
- **両方全件（有料、build → smoke → README）:** `npm run verify:all -- --allow-paid`

README の一括実行には、選択した Claude/Codex CLI の認証と、課金を許可する `--allow-paid` が必要です。既定は Claude です。`npm run test:readme-e2e` は別物で、実機もモデルも使わないハーネステストです。

各シナリオは順番に1回ずつ実行し、自動リトライはしません。3連続失敗または Animate の終了・再起動などの安全問題で停止します。ユーザー文書を自動で閉じることはしません。

README の `testmovie` は、既存の cleanup が無関係な Player も閉じる可能性があるため、一括実行では SKIP します。全件を対象にしても、SKIP を含めてすべてを検証できたことにはなりません。smoke の Test Movie Player が残った場合は手動で閉じてください。

smoke の単独 `publish` は明示した既存 FLA が必要なため、一括実行では SKIP します（使い捨て FLA の `isolated-publish` は実行対象）。`canvas` と `document-ops` も既存文書を必要とするため、空の Animate セッションでは SKIP します。統合実行は smoke が非ゼロ終了した場合、README に進みません。

保存先は `VERIFICATION_RUN_DIR=/path/to/dir`、smoke の集計ファイルだけの保存先は `SMOKE_REPORT=/path/to/report.json` で指定できます。ログには CLI の出力が含まれるため、共有前に内容を確認してください。入口の無課金テストは `npm run test:verification` で実行できます。

## 手動で確認

次の項目はスモークテストのスクリプトだけでは確認できません。

1. ドキュメントを開いた状態で `fl.trace('hi'); 'ok'` を `run_jsfl` で実行します。出力パネルに `hi` が表示され、ツールは `"ok"` を返します。Animate が前面に出ます（既知の挙動）。
2. `execute_readonly` から `get_document_info` を実行します。名前、サイズ、フレームレート、タイムライン名が返ります。
3. すべてのドキュメントを閉じて `execute_readonly` から `get_document_info` を実行します。"No document open" が返ります。
4. Animate を終了して `run_jsfl` を実行します。"Animate not running" が返ります。

## 必要な場合だけ

- **対象を絞る:** `npm run smoke -- document-ops capture-frame` のように指定できます。
- **Entrance 経由を確認する:** 使い捨ての AS3 ドキュメントで `[{"tool":"get_status"}]` を `steps.json` に保存し、`node server/verification/smoke/scenarios/smoke-run.mjs --entrances steps.json` を実行します。Animate 上の振り分けは確認できますが、クライアントの承認ダイアログは確認できません。
- **実行を記録する:** `SMOKE_RECORD_DIR=/path/to/dir` を設定すると、テキストや JSFL を含むツール入力値全体が JSONL に記録されます。機密情報を含まない使い捨てテストデータだけで使用してください。記録はローカルに保存され、自動アップロードされません。
- **形状フィクスチャを更新する:** `node server/verification/smoke/lib/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>` を実行します。結果形状だけを更新し、レビュー済みのサンプル引数は保持します。`run_jsfl` は安全な実行可能サンプルと形状の組を維持するため自動更新しません。レビュー済みフィクスチャがないツールはエラーになります。

## 個別スクリプト一覧

以下のファイルは `server/verification/smoke/` にあります。

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

## README プロンプト E2E

`server/verification/readme-e2e/` は、README の例文を Claude または Codex CLI と制限付き MCP サーバー経由で実機 Animate に渡す、別のハーネスです。既定は Claude です。Codex は `README_PROMPT_E2E_PROVIDER=codex` で明示的に選択します。

- **非課金チェック:** `npm run test:readme-e2e` はサーバーをビルドし、フィクスチャ・ファイル操作制限・MCP探索・偽CLIのテストを実行します。実際の Claude/Codex CLI や Animate は起動しません。CIでは独立ステップで実行し、`npm test` の対象は変更しません。
- **Codex パーサー／ハンドシェイクの事前確認（モデル・Animate 不使用）:** `npm run build` の後、`README_PROMPT_E2E_SCENARIO=stage node server/verification/readme-e2e/runner.mjs --codex-preflight` を実行します。新規の一時 `HOME`／`CODEX_HOME` と、本番 `codexArgs` が生成するインライン設定・無害な fake MCP コマンドでインストール済み Codex のパーサーを確認し、明示的に制限した子プロセス環境で SDK ハンドシェイクと入口の許可リストを確認します。通常の Codex 設定は読み込まず、認証・Animate ツール実行は不要です。設定のパースだけで書き込み承認を証明するものではありません。
- **実機 Animate フィクスチャの事前確認（モデル不使用）:** ドキュメントを開いていない Animate を起動し、`npm run build` の後、`README_PROMPT_E2E_SCENARIO=capture node server/verification/readme-e2e/runner.mjs --fixture-preflight` を実行します。使い捨て FLA を作成・終了し、本番フィクスチャを確認したうえで、制限 MCP 経由のフレーム12キャプチャだけを実行して PNG ピクセルを検証します。`README_PROMPT_E2E_SCENARIO` で他のシナリオも選択できます。`canvas` には Chrome も必要です。
- **永続診断ログ:** 使い捨てワークスペース外の `~/.animate-mcp/readme-e2e-diagnostics/diagnostics.jsonl` に、private 権限・直近64 KiBの保持で結果メタデータを保存します。既定では固定の許可リスト項目、分類済み失敗理由／終了コード、隔離した一時ホームで一度だけ確認する CLI バージョン（検証できない場合は `unavailable`）を記録します。`README_E2E_DIAGNOSTICS=1` を設定すると、追加の許可済みカウンターと列挙値も記録します。CLI の生出力、認証情報、認証内容、MCP URL は記録しません。
- **実機E2E（明示的な承認が必要）:** Animate をドキュメントが開いていない状態にし、選択した CLI の認証を済ませて、リポジトリのルートで実行します。

      npm run build
      RUN_README_PROMPT_E2E=1 README_PROMPT_E2E_SCENARIO=layer node server/verification/readme-e2e/runner.mjs

  Codex を使う場合は、コマンドに `README_PROMPT_E2E_PROVIDER=codex` を追加します。Codex CLI の既存認証を使い、モデルは固定しません。利用量・課金は CLI の設定に依存します。どちらのプロバイダーも使い捨ての FLA を操作します。実行中は Animate を操作しないでください。他のシナリオは `stage`、`script`、`investigate`、`text`、`tween`、`instance`、`symbol`、`inspect`、`library`、`capture`、`assets`、`publish`、`testmovie`、`canvas` です。GreenSock のインストールは対象外です。`canvas` には Chrome も必要です。

  **Codex の安全性が Claude の制限モードと同等とは確認できていません。** ハーネスは read-only sandbox を要求し、一部の Codex 連携機能を無効化しますが、ネイティブツールが利用可能な場合や、ユーザー共通の指示が読み込まれる可能性があります。専用 MCP サーバーの `execute_write` 入口だけを事前承認し、対象ドキュメントとシナリオの制限はサーバー側で維持します。Claude と異なり Codex にはシナリオごとの turn 数上限に相当する機能がなく、ハーネスのタイムアウトは5分です。この書き込み承認は実機で確認済みですが、隔離の完全な検証は未実施です。Codex E2E の実行前に、安全性・リスクの確認と承認を得てください。
