# テスト用 LINE OA セットアップ手順
# ── けんぴちゃんに謎解き bot を試してもらうための検証環境

---

## 概要

本プロダクトは **OA ごとに webhook・シナリオ・ユーザーデータがすべて分離** されています。
テスト用に新しい LINE 公式アカウントを1つ作るだけで、本番データと完全に切り離せます。

```
LINE Developer Console
  └── テスト用チャネル（channel_secret / access_token）
          ↓
  管理画面で OA として登録
          ↓
  webhook URL: https://[ngrok].ngrok-free.app/api/line/[oaId]/webhook
          ↓
  ローカル開発サーバー (localhost:3000)
          ↓
  SQLite dev.db（テスト OA のデータのみ操作）
```

---

## STEP 1 — LINE 公式アカウント（テスト用）を作成

### 1-1. LINE Developer Console でチャネルを作成

1. https://developers.line.biz/ja/ を開く
2. 「コンソール」→「新規チャネル作成」→「**Messaging API**」を選択
3. チャネル名: 例 `謎解きBot-テスト` など本番と区別できる名前にする
4. 作成後、以下をコピーしておく:

| 取得先 | 値 |
|---|---|
| 「チャネル基本設定」タブ → チャネルシークレット | `Channel Secret` |
| 「Messaging API 設定」タブ → チャネルアクセストークン（発行ボタン） | `Channel Access Token` |

> **本番 OA とは別のチャネルを作ること。** 同じチャネルを共有すると webhook が混在する。

### 1-2. Webhook 設定は後で行うので今はスキップ

---

## STEP 2 — 管理画面でテスト OA を登録

1. `npm run dev` でローカルサーバーを起動
2. ブラウザで `http://localhost:3000/oas/new` を開く
3. 以下を入力:
   - **アカウント名**: `テスト-けんぴ` など分かりやすい名前
   - **Channel ID**: LINE Developer Console のチャネル ID
   - **Channel Secret**: STEP 1 で取得した値
   - **Channel Access Token**: STEP 1 で取得した値
4. 「登録」を押す → 登録後の URL から `oaId` を控えておく
   - 例: `http://localhost:3000/oas/abc123/works` → `oaId = abc123`

---

## STEP 3 — テスト用シナリオを作成

1. 登録した OA の「作品管理」へ移動 (`/oas/[oaId]/works`)
2. 「+ 作品を追加」でテスト用作品を作成
3. フェーズ・メッセージ・謎を設定して `publishStatus = active` にする

> **ポイント**: `publish_status = draft` のままだと bot が反応しない。

---

## STEP 4 — ngrok でローカルを公開

### 4-1. ngrok を起動（別ターミナルで）

```bash
ngrok http 3000
```

起動すると以下のような URL が表示される:

```
Forwarding  https://xxxx-xxx-xxx-xxx.ngrok-free.app -> http://localhost:3000
```

この `https://xxxx-xxx-xxx-xxx.ngrok-free.app` をコピーしておく。

> **ngrok のセッションは再起動のたびに URL が変わる。**
> 固定したい場合は ngrok の有料プランまたは Cloudflare Tunnel を検討。

### 4-2. ngrok の設定（オプション: 固定サブドメイン）

```bash
# ~/.config/ngrok/ngrok.yml に以下を追加すると --subdomain が使える（有料プラン）
authtoken: YOUR_NGROK_AUTH_TOKEN
```

---

## STEP 5 — Webhook URL を LINE に設定

1. LINE Developer Console → テスト用チャネル → 「Messaging API 設定」タブ
2. 「Webhook URL」に以下を入力:

```
https://[ngrok-url]/api/line/[oaId]/webhook
```

例:
```
https://xxxx-xxx-xxx-xxx.ngrok-free.app/api/line/abc123/webhook
```

3. 「検証」ボタンを押す → `{"ok":true}` が返れば成功
4. 「Webhookの利用」を **ON** にする

---

## STEP 6 — テストモードを設定（けんぴちゃんのみ反応させる）

### 6-1. けんぴちゃんの LINE userId を取得

テストモード設定前に、けんぴちゃんに一度 bot にメッセージを送ってもらう。
ターミナルのサーバーログに以下のように表示される:

```
[Webhook] text message  userId=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  text="こんにちは"
```

この `Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` が LINE userId。

### 6-2. `.env.local` に設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開いてコメントアウトを外す:

```env
TEST_MODE=true
TEST_LINE_USER_ID="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 6-3. サーバーを再起動

```bash
# Ctrl+C でサーバーを止めてから再起動
npm run dev
```

これでけんぴちゃん以外の LINE ユーザーからのメッセージは無視されるようになる。

---

## STEP 7 — けんぴちゃんに友だち追加してもらう

1. LINE Developer Console → テスト用チャネル → 「Messaging API 設定」
2. 「ボット情報」の QR コードをスクリーンショットで送る、または友だち追加 URL を共有:
   ```
   https://line.me/R/ti/p/@[LINE_OA_ID]
   ```
3. けんぴちゃんが友だち追加後、`はじめる` と送るとシナリオがスタートする

---

## STEP 8 — 管理画面も見せたい場合

管理画面も ngrok 経由で公開できる（同じ ngrok URL を使う）。

```
https://[ngrok-url]/oas
```

> **注意**: ngrok で公開している間は誰でもアクセスできる。
> 共有するときはセッション中のみ URL を教える、または Basic 認証を追加する。

---

## 環境変数まとめ

### `.env`（コミット可・シークレット不可）

```env
DATABASE_URL="file:./dev.db"
```

### `.env.local`（gitignore 済み・シークレット記載可）

```env
# テストモード（けんぴちゃんのみ反応）
TEST_MODE=true
TEST_LINE_USER_ID="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 本番 Supabase Auth（必要になったとき）
# NEXT_PUBLIC_SUPABASE_URL="https://..."
# NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

---

## データ分離の仕組み

| 項目 | 分離方法 |
|---|---|
| 認証情報 | OA ごとに DB に保存（channel_secret / access_token） |
| Webhook | `/api/line/[oaId]/webhook` — OA ID で完全分離 |
| シナリオデータ | `work.oaId` で OA に紐づく → テスト OA のデータのみ操作される |
| ユーザー進行状態 | `user_progress.workId` で作品単位に分離 |
| テストモード | `TEST_LINE_USER_ID` で指定ユーザー以外は無視 |

---

## トラブルシューティング

### bot が反応しない

```bash
# ngrok のログを確認
# ngrok の Web UI: http://localhost:4040
# → webhook リクエストが届いているか確認

# サーバーログで署名エラーを確認
npm run dev
# [Webhook] signature verification failed が出ていれば channel_secret が間違っている
```

### `{"ok":false}` が Webhook 検証で返る

- ngrok が起動しているか確認
- `npm run dev` が起動しているか確認
- URL の oaId が正しいか確認（管理画面の URL から取得）

### テストモードが効かない

- `.env.local` を変更後に `npm run dev` を **再起動** したか確認
- `TEST_LINE_USER_ID` の値に余分なスペースや改行がないか確認
- ログに `testMode=ON` と表示されているか確認

### ngrok URL が変わってしまった

```bash
# ngrok を再起動したら LINE Developer Console の webhook URL を更新する
# 固定 URL が必要な場合は以下を検討:
#   - ngrok 有料プラン（固定サブドメイン）
#   - Cloudflare Tunnel（無料で固定ホスト名）
```

---

## 検証後のクリーンアップ

1. `TEST_MODE=true` を `.env.local` から削除 or `false` に変更
2. ngrok を停止（Ctrl+C）
3. LINE Developer Console の webhook URL をクリア（または本番 URL に戻す）
4. テスト用シナリオデータは DB に残るが本番とは分離されているので影響なし
