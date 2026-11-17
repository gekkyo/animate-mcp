# 実機テスト

## 実行

Mac で Animate を起動し、開いている文書を**手動で保存・終了**してから、リポジトリのルートで実行します。プロンプトテスト前には既存の Test Movie Player も閉じてください。実行中は Animate を操作しないでください。実機テストは CI 対象外です。

| 対象 | コマンド | モデル課金 |
| --- | --- | --- |
| smoke | `npm run build && npm run smoke` | なし |
| プロンプトテスト | `npm run verify:prompt -- --allow-paid` | あり |
| 両方 | `npm run verify:all -- --allow-paid` | あり |

プロンプトテストは、自然言語の指示を AI に渡し、実機 Animate の操作結果を検証します。認証済みの Claude CLI を既定で使い、Codex を使う場合はコマンドの先頭に `PROMPT_E2E_PROVIDER=codex` を付けます。モデル・課金は CLI の設定に従います。`canvas` には Chrome も必要です。

**Codex は Claude と同等の隔離を保証しません。** read-only sandbox を要求しますが、ネイティブツールやユーザー共通の指示が利用される可能性があります。リスクを確認・承認してから実行してください。

## 結果と注意点

- **結果:** `verification-runs/<実行ID>/` の `summary.json` と各ログ。smoke は `smoke-report.json` も出力します。共有前に CLI 出力の内容を確認してください。
- **停止:** 順番に各1回、自動リトライなし。3連続失敗、Animate の終了・再起動・応答不良、文書の後片付け失敗で停止します。統合実行は smoke 失敗時にプロンプトテストへ進みません。
- **後片付け:** ユーザー文書は自動で閉じません。Test Movie Player が残った場合は手動で閉じてください。
- **`testmovie`:** プロンプトテストの実行対象です。cleanup はすべての Player を閉じます。文書が空かどうかは自動確認しますが、既存 Player がないことは手動で確認してください。
- **判定:** SKIP・NOT_RUN は検証済みではありません。理由も確認してください。

文書がないセッションでは、smoke `canvas` と `document-ops` がそれぞれ保存済みの使い捨て基準 FLA を開き、「別文書を保持する」検証を行います。smoke `publish` は専用の AS3 FLA を作成して Publish し、生成された SWF を確認します。所有文書は返却された正確な URI で閉じ、cleanup 失敗時は一括実行を停止します。

## 無課金のハーネステスト

実機・モデルを使わずに実行できます。

```sh
npm run test:verification
npm run test:prompt-e2e
```

<details>
<summary>個別実行・保存先</summary>

- smoke の対象指定: `npm run smoke -- capture-frame edit-text`（事前に build）
- プロンプトテストの単独実行（有料・要承認、事前に build）:

  ```sh
  RUN_PROMPT_E2E=1 PROMPT_E2E_SCENARIO=layer node server/verification/prompt-e2e/runner.mjs
  ```

- シナリオ: `layer` / `stage` / `script` / `investigate` / `text` / `tween` / `instance` / `symbol` / `inspect` / `library` / `capture` / `assets` / `publish` / `testmovie` / `canvas`
- 単独の `testmovie` も実行前に既存 Player を閉じてください。GreenSock のインストールは対象外です。
- 保存先: `VERIFICATION_RUN_DIR=/path/to/dir`。smoke 集計のみ: `SMOKE_REPORT=/path/to/report.json`
- 旧 `verify:readme`・`test:readme-e2e`・`README_*E2E*` 環境変数は廃止しました。新名称へ変更してください。過去の診断ログ・検証証跡は移動・削除しません。
- 個別スクリプト: `server/verification/smoke/scenarios/`。多くは使い捨て FLA を使用します。`smoke-publish.mjs <name.fla>...` は指定した既存文書を Publish するため注意してください。引数なしなら専用の使い捨て FLA を作成します。

</details>

<details>
<summary>事前確認・診断・フィクスチャ更新</summary>

以下は事前に `npm run build` を実行します。

- **Codex 接続確認（モデル・実機不使用）:**
  `PROMPT_E2E_SCENARIO=stage node server/verification/prompt-e2e/runner.mjs --codex-preflight`
  一時 HOME と fake MCP で設定パース・接続・許可リストを確認します。通常の Codex 設定・認証は使わず、書き込み承認の証明にはなりません。
- **実機フィクスチャ確認（モデル不使用）:**
  `PROMPT_E2E_SCENARIO=capture node server/verification/prompt-e2e/runner.mjs --fixture-preflight`
  空の Animate で使い捨て FLA とフレーム12の PNG ピクセルを検証します。他のシナリオも指定可能です。
- **Entrance 経由:** 使い捨て AS3 文書で `[{"tool":"get_status"}]` を `steps.json` に保存し、`node server/verification/smoke/scenarios/smoke-run.mjs --entrances steps.json` を実行。クライアントの承認ダイアログは検証しません。
- **永続診断:** `~/.animate-mcp/prompt-e2e-diagnostics/diagnostics.jsonl`（private 権限・直近64 KiB）。分類済み結果・終了コード・隔離環境で確認した CLI バージョンを保存します。`PROMPT_E2E_DIAGNOSTICS=1` で許可済みカウンター等を追加。CLI 生出力・認証情報・MCP URL は保存しません。
- **入力記録:** `SMOKE_RECORD_DIR=/path/to/dir` でツール入力全体をローカル JSONL に保存します。テキスト・JSFL も含むため、機密情報のない使い捨てデータだけで使用してください。自動送信はしません。
- **形状更新:** `node server/verification/smoke/lib/merge-smoke-shapes.mjs <SMOKE_RECORD_DIR>`。レビュー済み引数を維持し、結果形状だけ更新します。`run_jsfl` は更新対象外。レビュー済みフィクスチャがないツールはエラーになります。
- **Codex の制限:** 専用 MCP の `execute_write` だけを事前承認し、文書・シナリオ制限はサーバー側で適用します。書き込み承認は実機確認済みですが、完全な隔離は未検証です。Claude のような turn 数制限はなく、ハーネスは5分でタイムアウトします。

</details>

<details>
<summary>手動で確認する項目</summary>

1. 文書を開き、`run_jsfl` で `fl.trace('hi'); 'ok'` を実行 → 出力パネルに `hi`、戻り値 `"ok"`。Animate が前面に出ます。
2. `execute_readonly` → `get_document_info` → 名前・サイズ・フレームレート・タイムライン名。
3. 文書を手動で保存・終了して同じツールを実行 → `"No document open"`。
4. Animate を終了して `run_jsfl` → `"Animate not running"`。

</details>
