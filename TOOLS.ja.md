# ツール一覧詳細

[English](TOOLS.md) | 日本語

## 公開している MCP ツール

| MCP ツール | 用途 | 呼び出し例 |
|------------|------|------------|
| `search_tools` | 操作のスキーマ・説明・注意点を検索 | `{"query":"publish"}` |
| `execute_readonly` | 読み取り専用の操作を実行 | `{"name":"get_status","arguments":{}}` |
| `execute_write` | それ以外の操作を実行（読み取り専用の操作は拒否） | `{"name":"publish","arguments":{}}` |
| `run_jsfl` | JSFL を直接実行（入口経由では実行不可・個別に禁止可能） | 下の一覧を参照 |

許可・権限ルールは `execute_readonly` / `execute_write` 単位です。許可前に内部の `name` と `arguments` を確認してください。`execute_write` の「常に許可」は、ほかの書き込み系操作にも適用されます。「読み取り専用」はドキュメントの内容やファイルを変更しないという意味です。`inspect_timeline` と `audit_document` は実行中にタイムラインやプレイヘッドを一時的に切り替え、終了後に元へ戻します。

## 操作一覧

次の操作は独立した MCP ツールではなく、`execute_readonly` / `execute_write` の `name` に指定して実行します。ただし `run_jsfl` は直接呼ぶ MCP ツールで、注意点のためにここへ載せています。

| 操作 | できること | 入力・注意点 |
|--------|------------|--------------|
| `get_document_info` | 開いているドキュメントの名前、サイズ、フレームレート、背景色、タイムライン名、ActionScript のバージョン、GreenSock の導入状況を確認します。 | 引数は不要です。 |
| `get_status` | Animate の応答を確認し、開いているドキュメントとアクティブ文書の名前・パス・種類を返します。 | 引数不要。約5秒以内に応答しない、または起動していない場合は `animate: "not_responding"` を返します。未保存の編集状態は推測しません。 |
| `open_document` | 既存の `.fla` を開くか、Animate の標準サイズ・フレームレートで AS3 / HTML5 Canvas ドキュメントを新規作成します。 | `path`（既存 `.fla`）か `type`（`timeline` / `htmlcanvas`）をどちらか一方指定します。ドキュメント名と保存済みならパスを返します。 |
| `save_document` | 明示的に指定したドキュメントを現在のパスまたは新しいパスに保存します。 | `document`（正確な名前またはパス）が必要です。未保存文書には `path` が必要です。現在のファイルや別の既存ファイルの上書きには、ユーザーへの確認後に `confirm: true` を指定します。アクティブ文書を自動選択しません。 |
| `close_document` | 明示的に指定したドキュメントを保存せず閉じます。 | `document`（正確な名前またはパス）と `discardUnsavedChanges: true` が必要で、未保存の編集は破棄されます。必要なら先に保存してください。アクティブ文書を自動選択せず、Test Movie Player も閉じません。 |
| `export_scripts` | シーンとライブラリシンボルの構造・フレームスクリプトを書き出し、`index.md` と各タイムラインの `structure.md` も生成します。 | 既定の出力先は `~/.animate-mcp/exports/<ドキュメント名>/`。未適用の編集があると再 Export を拒否します。`force: true` はその編集を破棄します。 |
| `apply_scripts` | 書き出したスクリプトの編集を Animate に反映します。空ファイルはそのフレームのスクリプト削除を意味します。 | Export 先の `dir` を指定します。Animate 側で変更されたフレームは上書きしません。`.fla` は保存しません。 |
| `read_output` | 現在の Output / Compiler Errors パネルを生テキストで読み、コンパイラー診断を解析します。 | 読み取り専用です。Animate は出所のドキュメントや実行を示さないため、内容は古いものや混在したものの可能性があります。`compilerDiagnostics.status: "unavailable"` はパネルが空・不完全・未対応のいずれかを示し、コンパイル成功を意味しません。 |
| `test_movie` | 保存済み AS3 ドキュメントを現在メモリー上にある内容で Test Movie 実行します。コンパイルエラー時は Player の起動を中止し、コンパイラー診断と Output パネルの差分を返します。 | `.fla` は保存・Publish・クローズしません。起動した Player は開いたままなので手動で閉じてください。Output パネルは起動から2秒後に一度だけ取得するため、それ以降のメッセージは取得されず、同時出力が混在する場合があります。差分が空でもランタイムエラーがなかった証明にはなりません。 |
| `publish` | AS3 または HTML5 Canvas ドキュメントを Publish し、Build result を返します。 | Publish 設定の出力を上書きします。未保存の編集も Publish されますが、`.fla` は保存しません。`compilerOutput` は解析済みの AS3 出力なら `verified`、空出力を1回再試行しても取得できなければ `unavailable`、Canvas なら `not_checked` です。取得不能・未確認の場合、`errors` が空でもエラーなしとは断定できません。サマリー行がある場合、位置やコードを解析できない診断もメッセージとして返します。Canvas のコンパイルエラーは未検証で、`ok: true` は Publish が実行されたことだけを示します。 |
| `get_air_descriptor` | `*-app.xml` descriptor から AIR アプリ設定、アイコン、extensions、プラットフォーム追加設定を読み取ります。 | `document` または絶対パスの `descriptorPath` を指定します。両方省略できるのは開いている文書が1つの場合だけです。直接パス指定は Animate 不要ですが、descriptor は既存である必要があります。`playerTarget` は document 指定時のみ返します。AIR 設定ダイアログで OK を押すと descriptor が書き換わる可能性があります。 |
| `set_air_descriptor` | 既存の `*-app.xml` descriptor の許可された AIR 設定を編集します。 | `document` または絶対パスの `descriptorPath` を指定し、変更するフィールドだけ渡します。`dryRun: true` は書き込まずに差分を返します。実際の書き込み前に `<descriptor>.bak` を作成・上書きします。`null` は任意項目を削除しますが、`id` と `versionNumber` は削除できません。AIR 設定ダイアログで OK を押すと descriptor が書き換わる可能性があります。 |
| `preflight_publish` | Publish 前に保存パス、文書形式、有効な公開形式、出力候補、ドキュメント監査の指摘を確認します。 | 読み取り専用で保存・コンパイル・Publish・修正はしません。`document` は省略可（開いている文書が1つの場合のみ）。項目ごとに `pass` / `fail` / `unchecked` を返し、コンパイルは常に未確認です。FLA と同じ場所の安全な単純ファイル名だけを存在確認して上書きの可能性を警告します。独自の出力先や曖昧なパス、未保存の編集、実際の Build 結果は確認できません。AIR（Desktop/Android/iOS。公開ターゲットで判別）の文書には `checks.air` も返します。FLA と同じ場所の `<FLA名>-app.xml` が整形式 XML で `<id>` と `<versionNumber>` が空でないこと、宣言した `<icon>` の PNG が存在し寸法が一致すること、iOS は `Assets.car` の存在（中身は未確認）、Android は `mipmap-anydpi-v26/icon.xml` を含む `<resdir>` がなければ警告（adaptive icon）を確認します。descriptor 不在、descriptor フォルダ外のファイル、署名用の証明書・プロビジョニングプロファイルは `unchecked` です。AIR のパッケージ化と実行時の挙動は確認しません。 |
| `verify_canvas_output` | 保存済み HTML5 Canvas ドキュメントを必要に応じて Publish し、インストール済み Chrome で HTML を開いて Browser output とスクリーンショットを返します。 | 既定で Publish を実行し、Publish 設定の出力を上書きします。Publish しない場合は `publish: false`、絶対パス指定には `htmlPath` を使います。既定パスは FLA と同じ場所の `<FLA名>.html` です（Animate 2027 の既定設定で確認済み）が、独自設定と異なる場合があります。Chrome は事前にインストールが必要です。HTML とローカルアセットは HTML のディレクトリだけを loopback サーバーで配信し、既知の Web アセット形式のみを提供します。HTML 内のスクリプトが実行され、外部アセットにはネットワーク接続が必要な場合があります。読み込み時と `observeMs`（既定3000ms）の console error、未捕捉例外、失敗したリクエストを報告します。問題なしでも見た目の正しさや以降のエラーがないことは保証しません。 |
| `audit_document` | 未使用の Library アイテム、空のキーフレーム、英語・日本語の既定らしいレイヤー名／シンボル名を読み取り専用で提案します。任意の `document` で開いているドキュメント名を指定できます。省略時は開いているドキュメントが1つの場合に限り実行します。 | 各指摘に重大度と場所を含みますが、レビュー用のヒューリスティックであり欠陥の証明ではありません。未使用アイテムは外部コードから参照される可能性があり、リンケージ付きアイテムは削除して安全とは判断できないことを明示します。シーンとシンボルの直接使用箇所を調べますが、ネストや実行時参照は保証しません。実行中はタイムラインを一時的に切り替え、元の編集状態と選択を復元します。 |
| `capture_frame` | アクティブなタイムライン（編集中のライブラリシンボルを含む）の1フレームまたは範囲を PNG 画像で返します。 | `frame` と `range` はどちらか一方を指定します（両方はエラー）。`frame` は1始まりで、省略時は現在のフレームです。`range: { start, end, step? }`（1始まり、昇順・終端を含む。`step` は省略時1、正の整数。最大24フレーム）。範囲の結果はフレーム順の画像・メタデータの組で、`structuredContent.captures` にも含まれます。各画像を `~/.animate-mcp/captures/<ドキュメント名>/` または `dir` に保存します。未保存ドキュメントにも対応します。現在のフレームは復元しますが、変更すると選択が解除される場合があります。長辺が2048pxを超えるステージは縮小せずエラーにします。 |
| `diff_captures` | 既存の Capture PNG 2枚を比較し、赤色で差分を示す画像と変更ピクセル数・割合・範囲を返します。 | `~/.animate-mcp/captures/` 内の絶対パスを指定します。画像サイズは同一である必要があります。`tolerance` の既定値は8で、RGBA全チャンネルの差が指定値以下なら変更なしとします。差分なしの場合 `boundingBox` は `null` です。新しい差分 PNG は先の Capture と同じディレクトリに、既存ファイルを上書きせず保存します。 |
| `visual_regression` | 名前付きフレーム基準画像を保存し、新しい Capture と比較します。 | 保存済み FLA が必要です。`action: "save"` / `"compare"`、`name`、必要に応じて `frame` または終端を含む `range`（最大24フレーム）を指定します。基準画像は `~/.animate-mcp/baselines/doc-<保存先パスのハッシュ>/<名前>/` に保存され、別の場所にある同名 FLA と区別します。同じ基準画像の更新には `overwrite: true` が必要です。比較時の各チャンネルの `tolerance` は既定8、`maxChangedPercent` は既定0。フレーム欠落やサイズ不一致は失敗とし、ピクセル差で失敗したフレームに赤色の差分 PNG を作ります。両操作で Capture ファイルを作り、比較時は差分ファイルも作る場合があります。Capture は元のフレームに戻しますが、選択が解除される場合があります。 |
| `inspect_timeline` | シーンやライブラリシンボルのレイヤー、キーフレーム範囲、指定フレームのインスタンス・テキスト・トゥイーンを読み取ります。 | `timeline` は 0 始まりのシーン番号かライブラリアイテムのパス。フレーム番号は 1 始まりで、レイヤーも絞り込めます。テキストの文字列と全体スタイルも返します。`geometry: true` で要素の境界、取得可能なシンボルフレーム数・インスタンス種別を追加します。トゥイーン途中の値には `interpolated: true` を付け、不正確な matrix は省きます。検査時に切り替えたフレームは復元し、幾何情報は既定で無効です。 |
| `edit_elements` | キーフレーム上のシンボルインスタンスを編集・配置します。 | 更新ではレイヤー・要素を名前または 0 始まりの番号で指定します。`{ op: "add", item, layer, frame, x?, y?, set? }` は名前付きレイヤーの 1 始まりのフレームに配置し、必要ならレイヤー・フレームを増やします。座標省略時はステージ中央です。`set.swapSymbol` は既存シンボルに置換し、`set.loop` と `set.firstFrame` はグラフィックのみ設定できます。変形、色効果、フィルター、名前、ブレンド、表示も設定可能です。インスタンス以外とトゥイーン途中は拒否し、書き込み前に全操作を検証します。`filters` は既存を置き換え、`[]` はクリアします。rotation と skew は同時指定できません。`.fla` は保存されません。 |
| `edit_text` | シーンやシンボルのタイムラインにテキストを追加し、既存テキストを編集します。 | `timeline` を指定し、`ops` に `{ op: "add", layer, frame, rectangle: { left, top, right, bottom }, text, style? }` または `{ op: "set", layer, frame, element, text?, style? }` を渡します。`style` はフォント、サイズ、色、太字・斜体、揃え、種類、行形式を全体に設定します。Canvas は入力テキストと単一行を拒否します。文字単位の装飾や `.fla` の保存はしません。 |
| `import_assets` | 画像・音声をステージに配置せずライブラリに取り込みます。 | `paths` に PNG/JPEG/GIF/WAV/MP3 の絶対ファイルパスを1つ以上渡します。同名のライブラリアイテム・入力内重複は取り込み前に拒否します。上書き・自動改名なし。`document` は省略可。`.fla` は保存しません。 |
| `set_document_properties` | ステージの幅・高さ・フレームレート・背景色を変更します。 | `width` / `height`（整数 1〜3840px。3840pxは受け入れ確認済みで、本ツールの保守的な上限。Animate自体の最大値は未確認）、`frameRate`（0.01〜120）、`backgroundColor`（`#RRGGBB`）を1つ以上指定します。配置済みの内容は拡大・移動せず、`.fla` も保存しません。`document` は省略可。 |
| `convert_to_symbol` | タイムラインの同一フレーム上にある指定要素を、ムービークリップ・ボタン・グラフィックのいずれかに変換します。 | シーンまたはライブラリのタイムライン、1 始まりのフレーム、要素参照、一意のシンボル名、必要に応じて基準点（既定は中央）を指定します。トゥイーン途中は拒否します。リンケージの設定や `.fla` の保存はせず、AS3 リンケージには別途 `edit_library` の `setLinkage` を使います。 |
| `edit_timeline` | レイヤー・フレーム・キーフレーム・ラベルを編集し、インスタンスをレイヤーに分配します。操作は `ops` の順に実行します。 | `deleteLayer` と `removeFrames` は `confirm: true` が必要です。`shiftLayerFrames` はクリップボードを上書きし、失敗時に Undo が必要な場合があります。 |
| `edit_tween` | モーション／クラシック／シェイプトゥイーンの作成とイージングの変更を行います。プリセット、数値、4 つの数値によるカスタムイーズに対応します（シェイプトゥイーンは -100〜100 の数値のみ）。 | モーション／クラシックでは対象の名前付きインスタンスがレイヤー上で単独である必要があります。シェイプトゥイーンは両キーフレームが生のシェイプである必要があります。既存のトゥイーン範囲は置換しません。 |
| `edit_library` | フォルダ・シンボルの作成、アイテムの移動・名前変更・複製・削除、直接の使用箇所と未使用アイテムの確認、AS3 リンケージの読み書きを行います。 | `findUsages` はシーン・シンボル上の直接配置のみ返します（`timeline` はシーン番号またはシンボルパス、サウンドの使用は `element: null`）。`createSymbol` は一意の名前と種類、`duplicateItem` は `newName` が必要です。`getLinkage` と `setLinkage` は Flash/AS3 のみ対応します。`setLinkage` は `exportForAS`、`className`、`baseClass`、`exportInFirstFrame` を受け付けます。Export 無効時の値は `{ exportForAS: false, className: "", baseClass: "", exportInFirstFrame: false }`。class/base と first-frame export には `exportForAS: true` が必要です。リンケージを変更したら `export_scripts` を再実行してください。古い Export の `apply_scripts` は拒否されます。`listUnused` は Animate 自身の未使用リストをそのまま返します。フォント・ビットマップ・サウンド・リンケージ付きアイテムでの挙動は未検証のため、結果は候補として扱い、削除して安全な証拠とは見なさないでください。削除は `confirm: true` が必要で、使用中は削除できません。移動・名前変更でコード内の文字列参照は更新されません。 |
| `install_greensock` | 保存済みの AS3 ドキュメントの隣に GreenSock-AS3 12.1.5 を GitHub から取得・配置します。 | [ライセンス](https://gsap.com/standard-license/)の確認後に `confirm: true` が必要です。`.fla` は変更・保存せず、AS2・HTML5 Canvas は対象外です。 |
| `run_jsfl` | 任意の JSFL コードを Animate で実行して結果を返します。オブジェクトの返却値は文字列になります。 | ドキュメントやファイルを変更するコードも実行できます。変更操作の前にユーザーの確認が必要です。 |

## `ops` で指定できる操作

`edit_timeline`、`edit_tween`、`edit_library` は、以下の操作を `ops` に並べて指定できます。`edit_elements` は既存インスタンスの更新に `{ layer, frame, element, set }`、ライブラリアイテム配置に `{ op: "add", item, layer, frame, x?, y?, set? }` を使います。詳しくは上のツール表を参照してください。

### `edit_timeline`

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

### `edit_tween`

| 操作 | 内容 |
|------|------|
| `createTween` | 指定インスタンスにモーション／クラシックトゥイーンを作成する |
| `createShapeTween` | 2つのシェイプキーフレーム間にシェイプトゥイーンを作成する |
| `setEase` | 既存トゥイーンのイージングを変更する |

### `edit_library`

| 操作 | 内容 |
|------|------|
| `createFolder` | フォルダを作成する |
| `moveItem` | アイテムを別のフォルダへ移動する |
| `renameItem` | アイテム名を変更する |
| `deleteItem` | アイテムを削除する（`confirm: true` 必須。使用中は削除不可） |
| `findUsages` | シーン・シンボルのタイムライン上でアイテムの直接配置を探す |
| `createSymbol` | 一意の名前でムービークリップ・ボタン・グラフィックを作成する |
| `duplicateItem` | `newName` を指定してアイテムを複製する |
| `listUnused` | 未使用アイテムを一覧にする |
| `getLinkage` | アイテムの AS3 リンケージ設定を読み取る（Flash/AS3 のみ） |
| `setLinkage` | AS3 リンケージ設定を1つ以上更新し、読み戻し値を返す（Flash/AS3 のみ） |

## 編集ツールの引数

`edit_timeline`・`edit_tween`・`edit_elements`・`edit_text` は `timeline`（0 始まりのシーン番号またはライブラリアイテムのパス）と1件以上の `ops` を受け取ります。`edit_library` は `ops` を受け取ります。すべてのツールで `document` は省略できます。レイヤーは名前と省略可の0始まり `index` で指定し、フレーム番号は1始まりです。操作は順に実行し、最初の失敗で停止します。`edit_timeline`・`edit_tween`・`edit_library` は `applied`・`failed`・`skipped`・`warnings` を返します。

### `edit_timeline`

| 操作 | 必須引数 | 省略可能な引数・注意 |
|------|----------|----------------------|
| `addLayer` | `name` | `type`（`normal`、`mask`、`masked`、`guide`、`folder`）、`parent`、`above`、`below` |
| `deleteLayer` | `layer`、`confirm: true` | |
| `moveLayer` | `layer` | `above`、`below`、`parent`、`index` |
| `renameLayer` | `layer`、`name` | |
| `setLayerType` | `layer`、`type` | `parent` |
| `insertFrames` / `removeFrames` | `layer`、`frame`、`count` | `ripple`。`removeFrames` は `confirm: true` も必要 |
| `insertKeyframe` / `clearKeyframe` | `layer`、`frame` | |
| `setLabel` | `layer`、`frame`、`label` | |
| `setSpanLength` | `layer`、`frame`、`length`（2以上） | `ripple` |
| `shiftLayerFrames` | `layer`、`offset`（正の整数） | |
| `distributeToLayers` | `layer` | |

結果としてレイヤー一覧（`name`、`type`、`parent`、`locked`）を返します。トゥイーン途中ではフレームの挿入・削除・キーフレーム変更を拒否します。

### `edit_tween`

| 操作 | 必須引数 | 省略可能な引数・注意 |
|------|----------|----------------------|
| `createTween` | `layer`、`instance`、`keyframes`（2件以上。各件に `frame`、全体でトゥイーン対象プロパティが1つ以上） | `kind`（既定 `motion`、または `classic`） |
| `createShapeTween` | `layer`、`from`、`to` | `ease`（-100〜100、既定 0）、`blend`（既定 `distributive`、または `angular`） |
| `setEase` | `layer`、`frame`、`ease` | シェイプトゥイーンでは `ease` は -100〜100 の数値 |

`createShapeTween` は `from` と `to` に既存のキーフレームが必要で、どちらも生のシェイプのみを含む必要があります（グループ、描画オブジェクト、インスタンス、テキストは不可）。既存のトゥイーン範囲は置換しません。シェイプヒントには対応していません。

キーフレームのプロパティ：`x`、`dx`、`y`、`dy`、`scaleX`、`scaleY`、`rotation`、`alpha`（0〜100）、`brightness`（-100〜100）、`tint`（`{ color, amount }`）、`blur`、`glow`、`dropShadow`、`ease`。`alpha`・`brightness`・`tint` は同時に使えない色モードです。

`ease` はプリセット名（`linear`、または `quad`／`cubic`／`quart`／`quint`／`sine`／`expo`／`circ`／`back` に `In`／`Out`／`InOut` を付けたもの）、-100〜100の数値、またはカスタムカーブ用の4つの数値を指定します。オブジェクト（`default`、`x`、`y`、`rotation`、`scaleX`、`scaleY`、`alpha`、`brightness`、`tint`、`blur`、`glow`、`dropShadow`）ではプロパティごとに指定できます。

### `edit_library`

| 操作 | 必須引数 | 省略可能な引数・注意 |
|------|----------|----------------------|
| `createFolder` | `path` | |
| `moveItem` | `item`、`toFolder`（ルートは `""`） | |
| `renameItem` / `duplicateItem` | `item`、`newName` | |
| `deleteItem` | `item`、`confirm: true` | 使用中は削除不可 |
| `createSymbol` | `type`（`movie clip`、`button`、`graphic`）、`name` | |
| `findUsages` / `getLinkage` | `item` | |
| `listUnused` | なし | |
| `setLinkage` | `item` と、`exportForAS`・`className`（空不可）・`baseClass`・`exportInFirstFrame` のいずれか1つ以上 | |

名前の衝突は拒否します。`newName` と `name` に `/` は使えず、パスではフォルダ間を `/` で区切ります。結果は操作ごとに `results` で返します。

### `edit_elements`

| 操作 | 必須引数 | 省略可能な引数・注意 |
|------|----------|----------------------|
| 更新 | `layer`、`frame`、`element`、`set` | `layer` と `element` は名前または0始まりの番号 |
| 追加 | `op: "add"`、`item`、`layer`、`frame` | `x`、`y`、`set` |

`set` には1つ以上必要：`x`、`y`、`scaleX`、`scaleY`、`rotation`、`skewX`、`skewY`、`name`、`blendMode`、`visible`、`loop`（`loop`、`play once`、`single frame`）、`firstFrame`、`swapSymbol`、`colorEffect`、`filters`。

`colorEffect`：`{ mode: "none" }`、`{ mode: "alpha", alphaPercent }`、`{ mode: "brightness", brightnessPercent }`、`{ mode: "tint", tintColor, tintPercent }`、または `{ mode: "advanced", ... }`（`redPercent`、`greenPercent`、`bluePercent`、`redAmount`、`greenAmount`、`blueAmount` のうち1つ以上）。

Animate が変形値を丸める場合があります。一時的なレイヤーのロック解除、選択、現在のフレームは復元されます。`applied` と `elements` を返し、要素のフィールドは `inspect_timeline` と同じ内容に、レイヤー・フレーム・要素の参照を加えたものです。

### `edit_text`

| 操作 | 必須引数 | 省略可能な引数・注意 |
|------|----------|----------------------|
| 追加 | `op: "add"`、`layer`、`frame`、`rectangle`、`text` | `style` |
| 設定 | `op: "set"`、`layer`、`frame`、`element` | `text` または `style` の少なくとも一方 |

`rectangle` は `{ left, top, right, bottom }`（有限の数値で幅・高さとも正）、`text` は空不可です。存在しないレイヤーは作成し、タイムラインを延長し、必要ならキーフレームを作ります。

`style` には1つ以上必要：`face`、`size`（正の数）、`fillColor`（`#RRGGBB`）、`bold`、`italic`、`alignment`（`left`、`center`、`right`、`justify`）、`textType`（`static`、`dynamic`、`input`）、`lineType`（`single line`、`multiline`、`multiline no wrap`）。`lineType` は `dynamic` または `input` のテキストにのみ使えます。トゥイーン範囲とテキスト以外の要素は拒否します。
