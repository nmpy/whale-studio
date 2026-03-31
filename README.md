# LINE謎解きBot 管理ツール

LINE公式アカウントを使った分岐型・複数エンディングの謎解きゲームを作成・管理する SaaS ツールです。
**1つの OA（公式アカウント）= N 個の作品（シナリオ）** を管理できます。

---

## 技術スタック

| 役割 | 技術 |
|------|------|
| フレームワーク | Next.js 14 (App Router) |
| 言語 | TypeScript |
| データベース（ローカル） | SQLite（Prisma） |
| データベース（本番） | PostgreSQL |
| 認証 | Supabase Auth（開発時はスタブで動作） |
| バリデーション | Zod |

---

## セットアップ手順

### ▶ ローカル開発（SQLite・PostgreSQL 不要）

Node.js 18 以上があれば、PostgreSQL・Supabase の準備なしですぐ起動できます。

```bash
# 1. 依存インストール
npm install

# 2. 環境変数ファイルを作成（中身は変更不要・file:./dev.db がデフォルト）
cp .env.example .env

# 3. SQLite DB を作成してテーブルを生成
npm run db:push

# 4. 開発サーバー起動
npm run dev
```

`http://localhost:3000` を開くと `/oas` に自動遷移します。
データは `prisma/dev.db`（SQLite ファイル）に保存されます。

> **ファイルの使い分け**
> - `.env` — SQLite URL のみ含む安全なファイル。そのままコミット可能。
> - `.env.local` — 本番シークレット（Supabase キーなど）はこちらに。gitignore 済み。
>
> **認証について:** `.env` に Supabase の設定がない場合、開発中は認証スタブが自動で有効になります。ログイン不要でそのまま画面・API を操作できます。

---

### ▶ 本番環境（PostgreSQL）へ切り替える場合

1. `prisma/schema.prisma` の `provider` を変更

   ```prisma
   datasource db {
     provider = "postgresql"   // "sqlite" → "postgresql" に変更
     url      = env("DATABASE_URL")
   }
   ```

2. `.env.local` を設定

   ```env
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
   SUPABASE_SERVICE_ROLE_KEY=xxx
   ```

3. マイグレーションを実行

   ```bash
   npm run db:migrate
   ```

---

## シナリオの作り方（クイックスタート）

```
1. OA を作成（/oas/new）
   → Channel ID / Channel Secret / Access Token を入力

2. 作品を作成（/oas/[id]/works/new）
   → シナリオのタイトルを入力

3. あいさつメッセージを設定（作品編集画面 → あいさつメッセージ）  ← 任意・推奨
   → 未開始ユーザーへの導入文を入力（世界観説明 + 「はじめる」案内が定番）

4. フェーズを追加（作品編集画面 → フェーズ管理）
   ┌─ [開始] 序章           ← 必ず 1 件、開始フェーズを作る
   ├─ [通常] 謎解きパート
   └─ [エンディング] 真相エンド

5. 各フェーズにメッセージを追加（フェーズ編集画面）
   → Bot が送信するセリフ・説明文を入力
   → 1 メッセージ = 1 吹き出し。長い文は複数に分けると読みやすい

6. フェーズに遷移（分岐）を追加
   → 選択肢ラベル（例:「右の扉を開ける」）と遷移先フェーズを設定
   → LINE のクイックリプライボタンとして表示される（表示上限: 4 件）

7. プレイグラウンドでテスト（/playground）
   → ブラウザ上でシナリオを動作確認

8. LINE Webhook を設定して本番接続
```

---

## Google Sheets → LINE リッチメニュー同期

Google Spreadsheet のデータを LINE 公式アカウントのリッチメニューとして反映する機能です。

### シート構成

**RichMenus シート**

| 列 | 説明 |
|----|------|
| `richmenu_id` | メニュー識別子（例: RM001） |
| `work_id` | 対象作品 ID（絞り込みキー） |
| `name` | メニュー名（管理用） |
| `template_type` | レイアウト（`3col` / `2col` / `4grid` / `6grid` / `2row` / `3col-2row` / `fullscreen`） |
| `chat_bar_text` | バーに表示するテキスト（例: メニュー） |
| `is_default` | TRUE の場合、全ユーザーのデフォルトとして設定 |
| `image_url` | 背景画像 URL（PNG / JPEG） |
| `visible_phase` | 表示フェーズ（`start` / `playing` / `cleared` / `none`）|

**RichMenuItems シート**

| 列 | 説明 |
|----|------|
| `richmenu_id` | 親メニューの参照 |
| `slot_no` | ボタン番号（1〜N、template_type に合わせた番号） |
| `label` | ボタン表示ラベル（最大 20 文字） |
| `action_type` | `message`（テキスト送信）/ `action`（postback）/ `uri`（URL） |
| `action_value` | 送信テキスト / postback data / URL |
| `is_active` | FALSE の場合はスキップ |

### 環境変数

```env
# .env.local

# 公開スプレッドシート用 API キー（Google Cloud Console で発行）
GOOGLE_SHEETS_API_KEY=AIza...

# 非公開スプレッドシート用（上記の代わりに設定。サービスアカウント鍵 JSON を文字列化）
GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n..."}
```

### 操作手順

1. OA 設定 → 「📊 Sheets 同期」ページを開く（`/oas/[id]/richmenu-sync`）
2. スプレッドシート ID を入力（URL の `/d/` と `/edit` の間の文字列）
3. まず「🔍 ドライランを実行」で設定内容を確認
4. 問題なければ dry_run を OFF にして「📲 LINE に同期する」を実行

### visible_phase — フェーズ連動メニュー切り替え

`visible_phase` を設定したメニューを同期すると、ユーザーがフェーズを進むたびに自動的にリッチメニューが切り替わります。

| visible_phase 値 | 切り替えタイミング |
|-----------------|------------------|
| `start` | 開始フェーズ到達時 |
| `playing` | 通常フェーズへの遷移時 |
| `cleared` | エンディングフェーズ到達時 |
| `none` | 常時（is_default=TRUE と組み合わせて使用） |

---

## リッチメニューエディター（カスタムリッチメニュー）

LINE トーク画面下部のリッチメニューをフレキシブルに設計できます。

| 項目 | 内容 |
|------|------|
| **場所** | OA 設定 → 「🎨 カスタムエディター」（`/oas/[id]/richmenu-editor`） |
| **テンプレート** | 3列 / 2列 / 2×2グリッド / 3列×2行 / 全面1ボタン（コンパクト・フルサイズ両対応） |
| **アクションタイプ** | `message`（テキスト送信）/ `postback`（Webhook 送信）/ `uri`（URL を開く） |
| **サイズ** | コンパクト (2500×843px) / フル (2500×1686px) |
| **背景画像** | 外部 URL を指定するとアップロード時に自動取得して LINE に送信 |
| **適用フロー** | 「保存して LINE 適用」ボタン → DB 保存 → LINE API 登録 → デフォルト設定 |
| **固定メニューとの併用** | `/oas/[id]/richmenu`（固定 3 ボタン）と `/oas/[id]/richmenu-editor`（カスタム）は独立。後から適用した方が有効 |

### 使い方

1. `/oas/[id]/richmenu-editor` を開く
2. 「新規作成」をクリック → デフォルト 3 列レイアウトで作成される
3. テンプレートを選択してレイアウトを決める
4. 各エリアをクリックしてアクション（送信テキスト / postback data / URL）を設定
5. 「💾 保存（下書き）」で保存、「📲 保存して LINE 適用」で LINE に反映

---

## あいさつメッセージ（welcome_message）

| 項目 | 内容 |
|------|------|
| **用途** | まだシナリオを開始していないユーザーが最初に話しかけたとき・「つづきから」を押したが未開始だったときに送信される導入文。作品の世界観説明と「はじめる」開始案内をひとつにまとめるのに向いています。 |
| **設定場所** | 作品編集画面（`/oas/[id]/works/[workId]/edit`）→「あいさつメッセージ」セクション |
| **動作** | 設定されている場合、あいさつ文（1 吹き出し目）と「「はじめる」と送ってください。」（2 吹き出し目）の 2 通を送信します。 |
| **未設定時** | システムデフォルト文「「{作品名}」へようこそ。準備ができたら「はじめる」と送ってください。」にフォールバックします。 |
| **文字数** | 最大 1,000 文字。複数行テキストをそのまま保存できます。 |
| **複製** | 作品を複製すると `welcome_message` も引き継がれます。 |

---

## LINE Webhook — ローカルテスト手順

### 前提
- LINE Developers でチャネル（Messaging API）を作成済み
- 管理画面の OA 設定で Channel ID / Channel Secret / Access Token を入力済み
- 作品を「公開中」ステータスに設定済み

---

### Step 1 — ngrok でローカルサーバーを公開

```bash
# 別ターミナルで開発サーバーを起動
npm run dev

# ngrok でポート 3000 を公開
npx ngrok http 3000
# → https://xxxx-xx-xx-xx-xx.ngrok-free.app のような URL が表示される
```

### Step 2 — OA ID を確認する

1. 管理画面 (`/oas`) で対象 OA の「OA設定」を開く
2. ブラウザの URL から OA ID を取得する
   ```
   http://localhost:3000/oas/[この部分が OA ID]/settings
                              ^^^^^^^^^^^^^^^^^^^^^^
   ```

### Step 3 — LINE Developers で Webhook URL を設定

1. [LINE Developers Console](https://developers.line.biz/) を開く
2. 対象チャネル → 「Messaging API 設定」
3. Webhook URL に以下を入力:
   ```
   https://xxxx.ngrok-free.app/api/line/{OA_ID}/webhook
                                                 ^^^^^^^^
                                                 Step 2 で確認した UUID
   ```
4. 「検証」ボタンをクリック → 「成功」が表示されれば OK
5. Webhook 使用を「オン」に切り替える

### Step 4 — LINE でテスト

1. QR コードから LINE 公式アカウントを友だち追加
2. `はじめる` と送信 → シナリオが開始される
3. 表示された選択肢テキストをそのまま送信 → 次のフェーズに進む

---

---

## テストユーザー限定モード

開発中に **自分の LINE アカウントだけ** で安全に動作確認したい場合、
`TEST_MODE=true` を設定することで特定の userId からのイベントのみ処理できます。

### 設定手順

**1. 自分の LINE userId を確認する**

Webhook URL を設定した状態で、自分の LINE アカウントから何かメッセージを送ります。
開発サーバーのログに以下のように表示されます:

```
[Webhook] text message  userId=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  text="はじめる"
```

この `Uxxx...` の部分が自分の userId です。

**2. `.env.local` に設定する**

```env
TEST_MODE=true
TEST_LINE_USER_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`.env.local` を作成 or 編集し、上記を追記して開発サーバーを再起動してください。

**3. 動作確認**

- 自分のアカウントからメッセージ → 通常通り処理される
- 他のアカウントからメッセージ → 処理がスキップされ、以下がログに出力される:
  ```
  [Webhook] ignored (test mode)  userId=Uyyyyy...
  ```
  LINE へは 200 OK のみ返却（返信なし・DB 更新なし）

### 無効化

```env
TEST_MODE=false
# または TEST_MODE=true のまま TEST_LINE_USER_ID= を空にする
```

> ⚠️ **本番環境では `TEST_MODE=true` を設定しないでください。**
> 設定すると、`TEST_LINE_USER_ID` 以外の全ユーザーが処理されなくなります。

---

### curl でのローカルテスト（署名なし・開発環境のみ）

署名が省略された場合、`NODE_ENV=development` ではスキップされます。

```bash
# シナリオ開始をシミュレート（OA_ID を書き換えて使用）
curl -X POST http://localhost:3000/api/line/{OA_ID}/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Uxxxxx",
    "events": [
      {
        "type": "message",
        "mode": "active",
        "timestamp": 1234567890000,
        "replyToken": "noreply",
        "source": { "type": "user", "userId": "test-user-webhook" },
        "message": { "id": "1", "type": "text", "text": "はじめる" }
      }
    ]
  }'
```

> **注意:** `replyToken: "noreply"` では実際の LINE 返信は失敗しますが、進行状態の DB 更新は行われます。実際の送受信テストは ngrok 経由で行ってください。

---

### Webhook の動作仕様

| ユーザーの状態 | 入力 | 動作 |
|---|---|---|
| 未開始 | 「はじめる」系 | 開始フェーズから開始 |
| 未開始 | それ以外 | 「はじめると送ってください」 |
| 進行中 | 遷移ラベルと一致 | 次フェーズへ移動 |
| 進行中 | condition キーワードを含む | 次フェーズへ移動 |
| 進行中 | 一致なし | 現在の選択肢を再表示 |
| 進行中 | 「はじめる」系 | シナリオをリセットして再開始 |
| エンディング到達後 | 「はじめる」系 | シナリオを再開始 |
| エンディング到達後 | それ以外 | エンディング到達済みメッセージ |

#### 遷移マッチング優先順位

```
1. transition_id 直接指定（API からのみ）
2. ラベルの完全一致（NFKC 正規化・大文字小文字無視）
3. condition キーワードをユーザー入力が含む
```

#### テキストコマンド一覧

| コマンド | 動作 |
|---------|------|
| `はじめる` `始める` `スタート` `start` `開始` | シナリオを（再）開始 |
| `つづきから` `続きから` `つづき` `continue` `現在` | 現在の進行状態を再表示 |
| `リセット` `最初から` `restart` `reset` | リセットして最初から開始 |

---

## リッチメニュー設定

LINE トークの下部に「はじめる / つづきから / リセット」の 3 ボタンを表示します。

### 前提

- OA の Channel Access Token に **リッチメニューの作成・設定権限** が必要です
  （LINE Developers で「Messaging API」チャネルの Long-lived channel access token または Bot Manager 以上のロール）

### セットアップ手順

```
1. 管理画面の OA 一覧 → 対象 OA の「作品一覧」画面を開く
2. 「📲 リッチメニュー」ボタンをクリック
3. 「リッチメニューを作成・適用」ボタンをクリック
   → LINE API でメニューが自動作成され、全ユーザーに適用されます
4. LINE のトーク画面でボタンが表示されていることを確認
```

### ボタンと postback アクション

| ボタン | postback data | 動作 |
|--------|--------------|------|
| はじめる  | `ACTION:START`    | シナリオを（再）開始 |
| つづきから | `ACTION:CONTINUE` | 現在の進行状態を再表示 |
| リセット  | `ACTION:RESET`    | リセットして最初から開始 |

- ボタンタップ時は **postback イベント** が Webhook に送信されます
- 同時に `displayText` によりチャット上に「はじめる」などのテキストが表示されます
- テキストコマンド（`はじめる` など）も引き続き有効です

### リッチメニュー削除

管理画面の「リッチメニュー設定」→「削除」ボタンで LINE から削除できます。

### 将来的な拡張（フェーズ連動）

現在は OA 全体で共通の固定メニューを使用しています。
将来的にはフェーズごとに異なるリッチメニューを切り替える構造にも対応できます
（`Work.rich_menu_id` フィールドと `applyRichMenuToUser()` API を使用）。

### curl テスト（postback シミュレーション）

```bash
# リッチメニュー「はじめる」タップをシミュレート
curl -X POST http://localhost:3000/api/line/{OA_ID}/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Uxxxxx",
    "events": [
      {
        "type": "postback",
        "mode": "active",
        "timestamp": 1234567890000,
        "replyToken": "noreply",
        "source": { "type": "user", "userId": "test-user-01" },
        "postback": { "data": "ACTION:START" }
      }
    ]
  }'

# 「つづきから」をシミュレート
curl -X POST http://localhost:3000/api/line/{OA_ID}/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Uxxxxx",
    "events": [
      {
        "type": "postback",
        "mode": "active",
        "timestamp": 1234567890000,
        "replyToken": "noreply",
        "source": { "type": "user", "userId": "test-user-01" },
        "postback": { "data": "ACTION:CONTINUE" }
      }
    ]
  }'
```

---

## ディレクトリ構成

```
src/
├── app/
│   ├── api/
│   │   ├── oas/                    # OA CRUD
│   │   ├── works/                  # 作品 CRUD
│   │   ├── characters/             # キャラクター CRUD
│   │   ├── phases/                 # フェーズ CRUD
│   │   ├── transitions/            # 遷移 CRUD
│   │   ├── messages/               # メッセージ CRUD
│   │   ├── runtime/                # シナリオ実行 API
│   │   │   ├── progress/route.ts   # GET  現在の進行状態
│   │   │   ├── start/route.ts      # POST シナリオ開始
│   │   │   ├── advance/route.ts    # POST 次フェーズへ進む
│   │   │   └── reset/route.ts      # POST 進行状態リセット
│   │   └── line/
│   │       └── [oaId]/
│   │           └── webhook/route.ts  # LINE Webhook
│   ├── oas/                        # OA 管理画面
│   ├── playground/                 # シナリオ テスト実行画面
│   └── ...
├── lib/
│   ├── prisma.ts                   # Prisma クライアント シングルトン
│   ├── api-response.ts             # ok/created/badRequest/notFound/serverError
│   ├── auth.ts                     # Supabase Auth ミドルウェア
│   ├── api-client.ts               # フロントエンド向け fetch ラッパー
│   ├── runtime.ts                  # シナリオ実行ヘルパー（matchTransition・buildRuntimeState）
│   ├── line.ts                     # LINE API ヘルパー（署名検証・Reply・メッセージ変換）
│   └── validations/index.ts        # Zod バリデーションスキーマ
└── types/index.ts                  # 共通型定義
```

---

## 主要な画面

| URL | 説明 |
|-----|------|
| `/oas` | OA 一覧 |
| `/oas/new` | OA 新規作成 |
| `/oas/[id]/settings` | OA LINE 接続設定 |
| `/oas/[id]/richmenu` | **リッチメニュー設定**（作成・削除・確認） |
| `/oas/[id]/works` | 作品一覧 |
| `/oas/[id]/works/new` | 作品作成 |
| `/oas/[id]/works/[workId]/edit` | 作品編集 + フェーズ管理 + シナリオフロー概要 |
| `/oas/[id]/works/[workId]/phases/[phaseId]` | フェーズ編集 + メッセージ管理 + 遷移設定 |
| `/oas/[id]/works/[workId]/characters` | キャラクター一覧 |
| `/oas/[id]/works/[workId]/dashboard` | 進行状況ダッシュボード |
| `/playground` | シナリオ テスト実行（API 経由） |

---

## API エンドポイント

管理系 API には `Authorization: Bearer <token>` が必要です（開発時は `dev-token`）。
LINE Webhook は署名検証を使用します（開発時は省略可）。

### 管理 API

| メソッド | パス | 説明 |
|---------|------|------|
| GET/POST | `/api/oas` | OA 一覧・作成 |
| GET/PATCH/DELETE | `/api/oas/:id` | OA 詳細・更新・削除 |
| GET/POST/DELETE | `/api/oas/:id/richmenu` | **リッチメニュー 取得・作成・削除** |
| POST | `/api/works/:id/duplicate` | **作品複製** |
| GET | `/api/dashboard?work_id=` | **進行状況ダッシュボード** |
| GET/POST | `/api/works` | 作品一覧・作成 |
| GET/PATCH/DELETE | `/api/works/:id` | 作品詳細・更新・削除 |
| GET/POST | `/api/phases` | フェーズ一覧・作成 |
| GET/PATCH/DELETE | `/api/phases/:id` | フェーズ詳細・更新・削除 |
| GET/POST | `/api/transitions` | 遷移一覧・作成 |
| GET/PATCH/DELETE | `/api/transitions/:id` | 遷移詳細・更新・削除 |
| GET/POST | `/api/characters` | キャラクター一覧・作成 |
| GET/PATCH/DELETE | `/api/characters/:id` | キャラクター詳細・更新・削除 |
| GET/POST | `/api/messages` | メッセージ一覧・作成 |
| GET/PATCH/DELETE | `/api/messages/:id` | メッセージ詳細・更新・削除 |

### Runtime API（シナリオ実行）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/runtime/progress?line_user_id=&work_id=` | 進行状態取得 |
| POST | `/api/runtime/start` | シナリオ開始 |
| POST | `/api/runtime/advance` | 次フェーズへ進む |
| POST | `/api/runtime/reset` | 進行状態リセット |

### LINE Webhook

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/line/:oaId/webhook` | LINE Messaging API Webhook |

---

## データモデル

```
Oa（LINE公式アカウント設定）
└─ Work（作品・シナリオ）
     ├─ Character（キャラクター）
     ├─ Phase（フェーズ）
     │   ├─ Message（フェーズ内メッセージ）
     │   ├─ Transition（発信遷移） → 遷移先 Phase
     │   └─ UserProgress（このフェーズにいるユーザー）
     └─ UserProgress（ユーザー進行状態）

フェーズ種別:
  start   — 開始フェーズ（1作品1件のみ）
  normal  — 通常フェーズ（遷移を複数設定可能）
  ending  — エンディングフェーズ（発信遷移なし）

フェーズ削除時の連鎖:
  Message.phase_id    → SET NULL（メッセージは残る）
  Transition（from/to）→ CASCADE 削除
  UserProgress.current_phase_id → SET NULL
```

---

## 開発時の認証スタブ

`NEXT_PUBLIC_SUPABASE_URL` が未設定 + `NODE_ENV=development` の場合、
任意の Bearer トークンを受け入れ `dev-user` として扱います。

```bash
# OA 一覧（開発環境）
curl -H "Authorization: Bearer dev-token" http://localhost:3000/api/oas

# シナリオ開始（Runtime API）
curl -X POST http://localhost:3000/api/runtime/start \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{ "line_user_id": "test-user", "work_id": "<WORK_ID>" }'

# 遷移（advance）
curl -X POST http://localhost:3000/api/runtime/advance \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{ "line_user_id": "test-user", "work_id": "<WORK_ID>", "label": "右の扉を開ける" }'
```

---

## 開発用スクリプト

```bash
npm run dev          # 開発サーバー起動（http://localhost:3000）
npm run build        # プロダクションビルド
npm run db:generate  # Prisma Client 生成
npm run db:push      # スキーマをDBに適用（マイグレーションなし・ローカル開発用）
npm run db:migrate   # マイグレーション作成・適用（本番PostgreSQL向け）
npm run db:studio    # Prisma Studio（DB GUI）起動
```

---

## セキュリティ

- `channel_secret` / `channel_access_token` は **OA 一覧 API では返却されません**
- フロント画面では初期状態でマスク表示（`●●●●●●`）
- LINE Webhook は HMAC-SHA256 署名検証を実施（本番では必須）
- 本番環境では必ず Supabase Auth を設定してください

---

## 今後の実装候補

- フェーズ連動リッチメニュー切り替え（フェーズ到達時にメニューを変更）
- Supabase Auth ログイン画面
- 作品のエクスポート・インポート

---

## X分析ツール ダッシュボード

URL: `/x`
対象アカウント: **@nmpy_jp** (`https://x.com/nmpy_jp`)

### データの3層構造

ダッシュボードのデータは更新頻度と取得方法によって3種類に分類されています。

| 種別 | 内容 | 更新方法 | 実装場所 |
|------|------|---------|---------|
| **① 固定データ** | 表示名・username・プロフィール文など | コード直接編集 | `lib/mock/x-account.ts` の `X_PROFILE` |
| **② 手動更新データ** | フォロワー数・投稿数・いいね合計など | `updatedAt` と一緒に直接書き換え | `lib/mock/x-account.ts` の `X_MANUAL_STATS` |
| **③ 将来自動化データ** | フォロワー推移グラフ・日別投稿数・投稿一覧 | 現在はモック。将来アーカイブ or API で差し替え | `lib/mock/x-posts.ts` → `lib/services/x-data.ts` |

- **① ②** はページロード時に即時表示（ローディングなし）
- **③** のみ非同期ローディング + スケルトン表示

### ファイル構成

```
src/
  lib/
    types/x.ts                  # 型定義（XProfile / XManualStats / XPost 等）
    mock/x-account.ts           # ① 固定データ・② 手動更新データ（ここを直接編集）
    mock/x-posts.ts             # ③ 将来自動化データのモック（グラフ・投稿一覧）
    services/x-data.ts          # ★ データ取得の差し替えポイント
    importers/x-archive.ts      # Xアーカイブ読み込み scaffold（未実装）
  app/x/page.tsx                # ダッシュボードページ（2フェーズ描画）
  components/x-analytics/       # StatsCards / Charts / PostList / TopPosts / XAccountCard
```

### ② 手動更新データの更新手順

フォロワー数などを手動で更新するときは `src/lib/mock/x-account.ts` を直接編集します。

```ts
export const X_MANUAL_STATS: XManualStats = {
  followersCount: 1543,        // ← 現在のフォロワー数
  followersDayChange: +5,      // ← 前日比
  followersWeekChange: +23,    // ← 7日間の増減
  followingCount: 312,
  totalPostCount: 2847,
  monthlyPostCount: 47,
  monthlyLikeTotal: 1840,
  updatedAt: '2026-03-27',     // ← 更新日を必ず書き換える
};
```

### ③ 将来自動化データの差し替えロードマップ

| フェーズ | 方式 | 実装場所 |
|---------|------|---------|
| **現在** | モックデータ | `lib/mock/x-posts.ts` |
| **Step 1** | Xアーカイブ ZIP アップロード | `lib/importers/x-archive.ts` を実装 |
| **Step 2（任意）** | X API v2 リアルタイム取得 | `lib/services/x-data.ts` の `getAutoData()` を差し替え |

**Step 1 の手順（アーカイブ方式）:**

1. X.com の設定 → 「アカウント」→「データのアーカイブをリクエスト」で ZIP を取得
2. `src/lib/importers/x-archive.ts` の `importFromXArchive()` を実装
   - ZIP 内の `data/tweets.js` を解析して `XPost[]` / `XFollowerPoint[]` に変換
3. `src/lib/services/x-data.ts` の `getAutoData()` を以下のように変更:
   ```ts
   import { importFromXArchive } from '@/lib/importers/x-archive';
   export async function getAutoData() {
     const result = await importFromXArchive(archiveFile);
     return result; // { followerHistory, dailyEngagement, posts }
   }
   ```

**Step 2 の手順（X API v2）:**

1. X Developer Portal でアプリを作成し、Bearer Token を取得
2. `.env.local` に `X_API_BEARER_TOKEN=xxx` を追加
3. `src/lib/services/x-data.ts` の `getAutoData()` を X API v2 fetch に変更
4. コンポーネント・型はそのまま利用可能
