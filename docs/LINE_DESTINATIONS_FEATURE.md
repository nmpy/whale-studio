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

1. メッセージ編集画面からの destination 選択UIはまだ未統合（型・API・hookは準備済み）
2. destination の使用箇所一覧表示は未実装
3. `custom` LIFFターゲットは型のみ（`work_main` のみ実用）
4. query_params_json の値は文字列のみ

---

## 11. 今後の拡張ポイント

1. **メッセージ編集画面統合** — `useDestinations` hook で一覧取得 → 選択UI
2. **リッチメニュー統合** — `destinationApi.list()` で候補取得
3. **使用箇所一覧** — 各 destination がどこで使われているか逆引き
4. **プリセット自動生成** — 作品作成時に start/evidence/progress を自動登録
5. **一括インポート/エクスポート** — JSON での一括操作
