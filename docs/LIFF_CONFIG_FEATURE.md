# LIFF表示設定機能

作品ごとにLIFFページの表示内容をノーコードでカスタマイズできる機能。

---

## 1. 変更ファイル一覧

### DB / スキーマ
- `prisma/schema.prisma` — `LiffPageConfig`, `LiffPageBlock` モデル追加 + Work リレーション

### 型定義 / バリデーション
- `src/types/index.ts` — LIFF関連の型追加（9 block settings型 + request/response body型）
- `src/lib/validations/index.ts` — Zodスキーマ追加（block_type別バリデーション + validateBlockSettings関数）

### 共通ユーティリティ
- `src/lib/liff-utils.ts` — `toBlockResponse()`, `toConfigResponse()` — API レスポンス変換（DRY化）

### API ルート
- `src/app/api/works/[workId]/liff-config/route.ts` — GET/PUT
- `src/app/api/works/[workId]/liff-blocks/route.ts` — POST
- `src/app/api/works/[workId]/liff-blocks/[blockId]/route.ts` — PATCH/DELETE
- `src/app/api/works/[workId]/liff-blocks/reorder/route.ts` — POST
- `src/app/api/liff/works/[workId]/route.ts` — GET（公開API、認証不要）

### API クライアント
- `src/lib/api-client.ts` — `liffConfigApi` オブジェクト追加

### カスタムフック
- `src/hooks/useLiffSDK.ts` — LIFF SDK初期化・認証・プロフィール取得を隠蔽
- `src/hooks/useLiffConfig.ts` — LIFF設定管理のステートとハンドラーをカプセル化

### 管理画面
- `src/app/oas/[id]/works/[workId]/liff/page.tsx` — LIFF表示設定ページ（分割済み）
- `src/app/oas/[id]/works/[workId]/page.tsx` — ハブカードに「LIFF表示設定」追加

### コンポーネント（管理画面）
- `src/components/liff/block-type-registry.tsx` — ブロックタイプ統一レジストリ（label/icon/defaultSettings/SettingsForm）
- `src/components/liff/block-settings-forms.tsx` — ブロックタイプごとの設定フォーム（9種類）
- `src/components/liff/LiffConfigHeader.tsx` — 有効/無効トグル + タイトル/説明
- `src/components/liff/LiffBlockItem.tsx` — ブロックアイテム（表示・編集・ON/OFF・削除・DnD）
- `src/components/liff/LiffAddBlockModal.tsx` — ブロック追加モーダル
- `src/components/liff/LiffPreview.tsx` — 管理画面用スマホ幅プレビュー（Tailwind）

### コンポーネント（LIFF表示用）
- `src/components/liff/LiffRenderer.tsx` — LIFF表示用ブロックレンダラー（visibility制御含む）
- `src/components/liff/renderers/index.ts` — barrel export
- `src/components/liff/renderers/FreeTextBlock.tsx`
- `src/components/liff/renderers/StartButtonBlock.tsx`
- `src/components/liff/renderers/ResumeButtonBlock.tsx`
- `src/components/liff/renderers/ProgressBlock.tsx`
- `src/components/liff/renderers/EvidenceListBlock.tsx`
- `src/components/liff/renderers/HintListBlock.tsx`
- `src/components/liff/renderers/CharacterListBlock.tsx`
- `src/components/liff/renderers/ImageBlock.tsx`
- `src/components/liff/renderers/VideoBlock.tsx`

### LIFF表示ページ
- `src/app/liff/work/[workId]/page.tsx` — LIFF表示ページ（useLiffSDKベース）

---

## 2. Prisma schema の追加内容

```prisma
model LiffPageConfig {
  id          String          @id @default(uuid())
  workId      String          @unique @map("work_id")
  isEnabled   Boolean         @default(false) @map("is_enabled")
  title       String?
  description String?
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  blocks      LiffPageBlock[]
  work        Work            @relation(fields: [workId], references: [id], onDelete: Cascade)
  @@map("liff_page_configs")
}

model LiffPageBlock {
  id                      String         @id @default(uuid())
  pageConfigId            String         @map("page_config_id")
  blockType               String         @map("block_type")
  sortOrder               Int            @default(0) @map("sort_order")
  isEnabled               Boolean        @default(true) @map("is_enabled")
  title                   String?
  settingsJson            Json           @default("{}") @map("settings_json") @db.JsonB
  visibilityConditionJson String?        @map("visibility_condition_json")
  createdAt               DateTime       @default(now()) @map("created_at")
  updatedAt               DateTime       @updatedAt @map("updated_at")
  pageConfig              LiffPageConfig @relation(fields: [pageConfigId], references: [id], onDelete: Cascade)
  @@index([pageConfigId])
  @@index([sortOrder])
  @@index([blockType])
  @@map("liff_page_blocks")
}
```

Work モデルに `liffPageConfig LiffPageConfig?` リレーション追加済み。

---

## 3. Migration 内容の要約

- `liff_page_configs` テーブル: work_id (UNIQUE), is_enabled, title, description, timestamps
- `liff_page_blocks` テーブル: page_config_id (FK CASCADE), block_type, sort_order, is_enabled, title, settings_json (JSONB), visibility_condition_json, timestamps
- インデックス: page_config_id, sort_order, block_type
- `prisma db push` で適用済み

---

## 4. 追加 API 一覧と I/O

### 管理用（認証必須）

| メソッド | パス | 最低ロール | Request | Response |
|----------|------|------------|---------|----------|
| GET | `/api/works/[workId]/liff-config` | viewer | - | `{ config + blocks[] }` |
| PUT | `/api/works/[workId]/liff-config` | editor | `{ is_enabled?, title?, description? }` | `{ config + blocks[] }` |
| POST | `/api/works/[workId]/liff-blocks` | editor | `{ block_type, title?, settings_json?, visibility_condition_json? }` | `{ block }` |
| PATCH | `/api/works/[workId]/liff-blocks/[blockId]` | editor | `{ title?, is_enabled?, settings_json?, visibility_condition_json? }` | `{ block }` |
| DELETE | `/api/works/[workId]/liff-blocks/[blockId]` | editor | - | 204 |
| POST | `/api/works/[workId]/liff-blocks/reorder` | editor | `{ block_ids: string[] }` | `{ blocks[] }` |

### LIFF表示用（認証不要）

| メソッド | パス | Response |
|----------|------|----------|
| GET | `/api/liff/works/[workId]` | 有効ブロックのみ。LIFF無効なら404 |

---

## 5. 実装した block_type 一覧（全9種類）

| block_type | 名称 | settings |
|------------|------|----------|
| `free_text` | フリーテキスト | body, align, emphasis |
| `start_button` | 開始ボタン | label, confirm_message |
| `resume_button` | 再開ボタン | label |
| `progress` | 進捗表示 | display_format, show_denominator |
| `evidence_list` | 証拠リスト | max_display_count, hide_undiscovered, empty_message |
| `hint_list` | ヒントリスト | max_display_count, empty_message |
| `character_list` | キャラクター一覧 | show_icon, show_description |
| `image` | 画像 | image_url, alt, caption |
| `video` | 動画 | video_url, poster_url, caption |

---

## 6. 管理画面の追加箇所

- **作品ハブ** (`/oas/[id]/works/[workId]`): 「LIFF表示設定」カード追加
- **LIFF設定ページ** (`/oas/[id]/works/[workId]/liff`):
  - 有効/無効トグル
  - タイトル・説明入力
  - ブロック一覧（DnD並び替え・上下移動）
  - ブロック編集（インライン展開式）
  - ブロック追加モーダル
  - スマホ幅プレビュー（ローカル編集即反映）

---

## 7. LIFFページのURL

```
/liff/work/[workId]
```

LINE内ブラウザ・外部ブラウザ両対応。外部ブラウザでは注意文を表示。

---

## 8. 既知の制約

- evidence_list / hint_list / progress / character_list はスタブデータ（実際の UserProgress とはまだ未接続）
- LIFF SDK の `@line/liff` パッケージが未インストールの場合、LIFF機能は制限される
- visibility_condition_json は4値の文字列enum（将来の式評価には対応していない）
- 1作品1 LIFFページのみ（複数ページ未対応）

---

## 9. 今後の拡張ポイント

1. **動的データバインディング** — evidence_list / hint_list / progress を UserProgress / Phase から取得
2. **visibility_condition の式評価** — フラグ条件式（`flags.has_key == true`等）への拡張
3. **カスタムブロック** — `custom_html` / `iframe` タイプの追加
4. **テーマ設定** — ページ全体の配色・フォントカスタマイズ
5. **ブロックテンプレート** — よく使う構成を保存・再利用
6. **複数ページ対応** — 1作品に複数のLIFFページ（タブ切り替え等）
7. **block-type-registry への RuntimeRenderer 登録** — preview と runtime の switch 文も registry 化

---

## 10. LINE Developers 側で必要な設定

1. **LIFF アプリの作成**
   - LINE Developers Console > チャネル > LIFF タブ
   - サイズ: `Full`（推奨）
   - エンドポイント URL: `https://<your-domain>/liff/work/{workId}`
   - Scope: `profile`（必須）

2. **環境変数の設定**
   ```
   NEXT_PUBLIC_LIFF_ID=xxxx-xxxxxxxx
   ```

---

## 11. リッチメニューに設定するURL例

```
https://liff.line.me/{liffId}
```

1つのLIFFアプリでworkIdをパスパラメータで分岐する構成。
リッチメニューの area 設定で `actionType: "uri"` として上記URLを指定。
既存のリッチメニューエディタ (`/oas/[id]/richmenu-editor`) で area の actionUri に設定可能。

---

## アーキテクチャ設計

### コンポーネント構成

```
管理画面:
  page.tsx (薄いページ — useLiffConfig + サブコンポーネント組み立て)
    ├── LiffConfigHeader (有効/無効 + タイトル)
    ├── LiffBlockItem[] (個別ブロック — 表示/編集/DnD)
    │   └── BlockSettingsForm → registry.SettingsForm (ブロック種別ごとのフォーム)
    ├── LiffAddBlockModal (追加モーダル)
    └── LiffPreview (スマホ幅プレビュー)

LIFF表示:
  page.tsx (useLiffSDK + データ取得)
    └── LiffRenderer (visibility制御 + sort_order描画)
        └── renderers/FreeTextBlock, StartButtonBlock, ...
```

### ブロックタイプレジストリ

新しい block_type を追加するときは:
1. `src/types/index.ts` — Settings型を追加
2. `src/lib/validations/index.ts` — Zodスキーマを追加
3. `src/components/liff/block-settings-forms.tsx` — フォームコンポーネントを追加
4. `src/components/liff/block-type-registry.tsx` — レジストリに登録
5. `src/components/liff/renderers/` — ランタイムレンダラーを追加
6. `src/components/liff/LiffPreview.tsx` — プレビューを追加
7. `src/components/liff/LiffRenderer.tsx` — ランタイムルーティングを追加
