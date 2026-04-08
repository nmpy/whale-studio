# LINE 遷移先URL設定（destination）機能

作品ごとに再利用可能な遷移先URL定義を管理する機能。

---

## destination とは

「リッチメニュー」「画像メッセージ」「カードメッセージ」など、
複数の場所から同じ遷移先URLを参照したいときに使う **再利用可能なURL定義** です。

各 destination は `key` を持ち、作品内で一意に識別できます。
LINE に設定する最終URL（resolved URL）は destination の設定から自動生成されます。

### LIFF表示設定との違い

| | LIFF表示設定 | 遷移先URL設定 |
|---|---|---|
| 管理対象 | LIFFページ **内のコンテンツ**（ブロック構成） | LIFFページ **へのリンクURL** |
| 主な用途 | 「何を表示するか」 | 「どこから飛ばすか」 |
| ページ | `/oas/[id]/works/[workId]/liff` | `/oas/[id]/works/[workId]/destinations` |

---

## 1. 追加/変更ファイル一覧

### DB
- `prisma/schema.prisma` — `LineDestination` モデル追加 + Work リレーション

### 型定義 / バリデーション
- `src/types/index.ts` — `DestinationType`, `LiffTargetType`, `LineDestination`, `CreateLineDestinationBody`, `UpdateLineDestinationBody`
- `src/lib/validations/index.ts` — `createDestinationSchema`, `updateDestinationSchema`（superRefine で type 別バリデーション）

### URL生成ユーティリティ
- `src/lib/destination-url-builder.ts` — `resolveDestinationUrl()`, `resolveDestinationUrlFromApi()` — server/client 両対応
- `src/lib/destination-utils.ts` — `toDestinationResponse()` — API レスポンス変換

### API
- `src/app/api/works/[workId]/destinations/route.ts` — GET / POST
- `src/app/api/works/[workId]/destinations/[destinationId]/route.ts` — PATCH / DELETE

### API クライアント
- `src/lib/api-client.ts` — `destinationApi` 追加

### カスタムフック
- `src/hooks/useDestinations.ts` — 状態管理 + CRUD ハンドラー（useLiffConfig と同パターン）

### コンポーネント
- `src/components/destination/QueryParamsEditor.tsx` — key-value 追加式パラメータ編集UI
- `src/components/destination/DestinationUrlPreview.tsx` — リアルタイム resolved URL プレビュー
- `src/components/destination/DestinationListItem.tsx` — 一覧カード（URL表示・コピー・編集・削除・ON/OFF）
- `src/components/destination/DestinationFormModal.tsx` — 追加/編集モーダル（テンプレート・URLプレビュー付き）

### 管理画面
- `src/app/oas/[id]/works/[workId]/destinations/page.tsx` — 薄いページレイアウト
- `src/app/oas/[id]/works/[workId]/page.tsx` — ハブカード「遷移先URL設定」追加

---

## 2. アーキテクチャ

LIFF 表示設定と同じパターンで責務分離しています。

```
管理画面:
  page.tsx (~100行・薄いレイアウト層)
    ├── useDestinations hook (状態管理・APIコール)
    ├── DestinationListItem (個別カード)
    │   └── resolved URL コピー・ON/OFF・編集・削除
    └── DestinationFormModal (追加/編集モーダル)
        ├── テンプレート選択チップ
        ├── destination_type 別入力フィールド
        ├── QueryParamsEditor (key-value 編集)
        └── DestinationUrlPreview (リアルタイムURL生成)

共通ユーティリティ:
  destination-url-builder.ts (server/client 両方)
  destination-utils.ts (API レスポンス変換)
```

### LIFF機能との対比

| レイヤー | LIFF | Destination |
|---------|------|-------------|
| Hook | `useLiffConfig` | `useDestinations` |
| リスト項目 | `LiffBlockItem` | `DestinationListItem` |
| モーダル | `LiffAddBlockModal` | `DestinationFormModal` |
| プレビュー | `LiffPreview` | `DestinationUrlPreview` |
| 設定フォーム | `BlockSettingsForm` | `QueryParamsEditor` |
| ユーティリティ | `liff-utils.ts` | `destination-utils.ts` + `destination-url-builder.ts` |

---

## 3. DB追加内容

### line_destinations テーブル

| カラム | 型 | 備考 |
|--------|------|------|
| id | UUID (PK) | |
| work_id | UUID | Work への FK（CASCADE） |
| key | TEXT | 作品内 unique（work_id + key） |
| name | TEXT | 管理画面表示名 |
| description | TEXT? | 説明 |
| destination_type | TEXT | `liff` / `internal_url` / `external_url` |
| liff_target_type | TEXT? | `work_main` / `custom` |
| url_or_path | TEXT? | 遷移先URLまたはパス |
| query_params_json | JSONB | 追加クエリパラメータ |
| is_enabled | BOOLEAN | デフォルト true |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

## 4. API 一覧

| メソッド | パス | 最低ロール | 説明 |
|----------|------|------------|------|
| GET | `/api/works/[workId]/destinations` | viewer | 一覧取得（resolved_url 含む） |
| POST | `/api/works/[workId]/destinations` | editor | 新規作成（key 重複 → 409） |
| PATCH | `/api/works/[workId]/destinations/[id]` | editor | 更新（key 変更時の重複チェック含む） |
| DELETE | `/api/works/[workId]/destinations/[id]` | editor | 削除 |

---

## 5. destination_type 一覧

| type | 用途 | resolved URL 生成 |
|------|------|-------------------|
| `liff` | LIFF ページ | `https://liff.line.me/{LIFF_ID}?workId={workId}&...` |
| `internal_url` | Whale Studio 内ページ | `{BASE_URL}{path}?...` |
| `external_url` | 外部サイト | ユーザー入力URL |

---

## 6. resolved URL 生成ロジック

`src/lib/destination-url-builder.ts` で一元管理。

### liff
```
https://liff.line.me/{NEXT_PUBLIC_LIFF_ID}?workId={workId}&{query_params}
```

### internal_url
```
{NEXT_PUBLIC_BASE_URL}{url_or_path}?{query_params}
```

### external_url
```
{url_or_path}?{query_params}
```

server からは `resolveDestinationUrl()`、client からは `resolveDestinationUrlFromApi()` を呼ぶ。

---

## 7. 管理画面URL

```
/oas/[id]/works/[workId]/destinations
```

作品ハブから「遷移先URL設定」カードでアクセス。

---

## 8. 使用例

### リッチメニューで使う
1. destination: key=`start`, type=`liff`, params=`{ entry: "richmenu" }`
2. 管理画面で resolved URL をコピー
3. リッチメニューエディタの area actionUri に貼付

### 画像メッセージで使う
1. destination: key=`evidence`, type=`liff`, params=`{ tab: "evidence" }`
2. resolved URL をコピー → 画像メッセージの遷移先URLに設定

### カードメッセージで使う
1. destination: key=`campaign`, type=`external_url`, url=`https://campaign.example.com/`
2. resolved URL をコピー → カードボタンURLに設定

---

## 9. 推奨 key 命名例

| key | 用途 |
|-----|------|
| `start` | 謎解き開始ページ |
| `evidence` | 証拠一覧 |
| `progress` | 進捗確認 |
| `profile` | プロフィール |
| `campaign-xxx` | キャンペーン系 |
| `form-entry` | エントリーフォーム |

---

## 10. 既知の制約

1. destination の使用箇所一覧表示は未実装
2. `custom` LIFFターゲットは型のみ（`work_main` のみ実用）
3. query_params_json の値は文字列のみ
4. LINE画像メッセージのタップアクションはLINE API上は imagemap が必要（将来対応）

---

## 11. 今後の拡張ポイント

1. **リッチメニュー統合** — `DestinationSelect` で候補取得 → area actionUri に設定
2. **使用箇所一覧** — 各 destination がどこで使われているか逆引き
3. **プリセット自動生成** — 作品作成時に start/evidence/progress を自動登録
4. **一括インポート/エクスポート** — JSON での一括操作
5. **クイックリプライ統合** — `action: "url"` の value に destination を選択

---

## 12. メッセージ編集画面との統合（実装済み）

### 対象メッセージ種別
- **画像メッセージ** — タップ遷移先として destination を選択可能
- **カルーセルメッセージ** — 各カードのボタン遷移先として destination を選択可能

### DB変更
Message モデルに追加:
- `tap_destination_id` (nullable, FK → LineDestination, onDelete: SetNull)
- `tap_url` (nullable, 直接URL)

カルーセルカードは JSON（body フィールド）内に `destination_id` を保持可能。

### URL解決の優先順位
プレビュー・保存・送信の3箇所で統一:
1. `tap_destination_id` あり → destination の resolved_url
2. `tap_url` あり → そのまま使用
3. どちらもなし → 遷移なし

実装: `src/lib/message-destination-utils.ts` の `resolveMessageActionUrl()`

### UI
`TapDestinationSection` コンポーネント:
- segmented control で「保存済みの遷移先を使う」「URLを直接入力する」を切替
- destination モード: `DestinationSelect` で候補選択 + resolved URL 補助表示
- 直入力モード: 従来のURL入力欄

### 後方互換
- 既存データ（destination_id なし、URL直接保存）はそのまま動作
- destination_id = null の場合は tap_url にフォールバック
- 既存フィールドは削除していない

### 追加ファイル
- `src/lib/message-destination-utils.ts` — resolveMessageActionUrl, resolveCarouselButtonUrl, detectTapMode
- `src/components/destination/DestinationSelect.tsx` — 再利用可能な destination セレクト
- `src/components/destination/TapDestinationSection.tsx` — 遷移先設定セクション（segmented control + select + URL入力）

---

## 13. リッチメニューとの統合（実装済み）

### 変更内容
- `RichMenuArea` に `destinationId` (nullable FK → LineDestination) 追加
- リッチメニューエディタの URI action 編集時に segmented control で「保存済みの遷移先を使う」「URLを直接入力」を切替可能
- OA配下の全作品の destination を選択候補に表示
- 保存時に `destination_id` と `action_uri` の両方を保持（destination 選択時は resolved URL を action_uri にも反映）
- 既存の直URL運用はそのまま継続可能

### URL解決の優先順位
1. `destination_id` あり → destination の resolved_url を action_uri に設定
2. `destination_id` なし → action_uri をそのまま使用

---

## 14. クイックリプライとの統合（実装済み）

### 変更内容
- `QuickReplyItem` に `destination_id` (nullable) を追加（JSON内フィールド）
- action="url" のクイックリプライ編集時に TapDestinationSection で destination 選択可能
- `buildQuickReplyFromItems()` に `resolveDestinationUrl` オプションを追加
- action="url" の label と value（URL）を分離（label はボタン表示文、value は遷移先URL）
- 既存の直URL QR はそのまま動作

### LINE payload 解決
```
action="url" の場合:
  1. destination_id → opts.resolveDestinationUrl(id) → uri
  2. value → uri
  3. なし → スキップ
```

---

## 15. destination 使用箇所の逆引き（実装済み）

### API
- `GET /api/works/[workId]/destinations` — 一覧に `usage_count` を含む
- `GET /api/works/[workId]/destinations/[id]/usages` — 使用箇所の詳細

### 検索対象
| usage_type | 説明 | 検索方法 |
|------------|------|----------|
| image_message | 画像メッセージの tapDestinationId | FK |
| carousel_button | カルーセルカードの destination_id | body JSON |
| richmenu_area | リッチメニューエリアの destinationId | FK |
| quick_reply | クイックリプライの destination_id | quickReplies JSON |

### UI表示
- 一覧画面: `使用中 N件` / `未使用` バッジ
- 削除確認: 使用中なら「この遷移先は N 箇所で使われています。本当に削除しますか？」

### ユーティリティ
- `src/lib/destination-usage-utils.ts`
  - `getDestinationUsages(destinationId, workId)` — 使用箇所詳細
  - `getDestinationUsageCounts(workId)` — 全 destination の usage count 一括取得

---

## 16. 既知の制約

1. リッチメニューはOAレベルだが destination は作品レベル — リッチメニュー編集時はOA配下の全作品の destination を表示
2. クイックリプライの destination 解決はサーバー側 buildQuickReplyFromItems に resolver を渡す必要あり
3. usage 逆引きの JSON 走査はメッセージ件数が多い場合パフォーマンスに注意

---

## 17. 今後の拡張候補

1. **Flex Message 統合** — Flex の URI action にも destination 選択
2. **destination テンプレートの自動生成** — 作品作成時に start/evidence/progress を自動登録
3. **使用箇所からの直接編集リンク** — usage 詳細に各編集画面へのリンク
4. **destination の使用禁止** — 使用中の destination を削除不可にする（設定次第）
5. **一括インポート/エクスポート** — JSON での一括操作
