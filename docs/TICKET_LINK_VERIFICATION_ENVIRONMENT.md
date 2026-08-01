# チケット連携 検証環境の構築手順

PR2（whale-studio #599）と PR3（uzupro #71）を、**本番データ・本番OA・本番LIFFを一切使わずに**
実際に動かすための環境構築手順。

実機の確認項目は [`TICKET_LINK_PREVIEW_VERIFICATION.md`](./TICKET_LINK_PREVIEW_VERIFICATION.md) に分離。
本書は「環境を用意するまで」を扱う。

> 手順の大半は Vercel / Supabase / LINE Developers の管理画面操作であり、**ご本人の実施が必要**。
> 接続文字列・APIキー・channel secret・access token をチャットへ貼る必要はない。

---

## 0. 最初にやること（作成ではなく「確認」）

新規リソースを作る前に、**既存環境の有無だけ**を確認してください。秘密情報は不要です。

### 確認A：Supabase

```
ユーザー操作
場所：Supabase ダッシュボード → Projects 一覧
確認する項目：staging / preview / test / development / uzupro / whale を含む Project 名の有無
　　　　　　　あわせて Branching が使えるプランか、停止中 Project があるか
期待結果：再利用できる Project があるか判断できる
秘密情報の扱い：Project 名だけで十分。接続文字列は不要（伏せたスクショでも可）
```

### 確認B：LINE Developers

```
ユーザー操作
場所：LINE Developers Console（＋LINE Official Account Manager）
確認する項目：Provider 一覧 / 同一 Provider 配下の Messaging APIチャネル / LINE Loginチャネル /
　　　　　　　LIFF アプリ一覧（検証・staging・test 用途のもの）/ 紐づく LINE公式アカウント /
　　　　　　　現在の endpoint URL / scope（chat_message.write）/ bot link 設定
期待結果：再利用できる検証環境があるか判断できる
秘密情報の扱い：チャネル名・LIFF 名だけで十分。channel secret / access token は不要
```

**この2点の結果を見てから**、新規作成が必要かを判断します。
用途・所有者・データ内容が不明な Project やチャネルは流用しないでください。

---

## 1. 現在わかっている環境（調査結果）

| 項目 | 状態 |
|---|---|
| Vercel `whale-studio` | Production と Preview が**同一DB**（Preview から本番作品IDを解決できることで実証） |
| whale-studio ticket-link migration | 本番DBへ**適用済み**（2026-07-31 16:48Z） |
| Vercel `whale-studio-staging` | deploy 成功だが **`DATABASE_URL` 未設定**（`Environment variable not found: DATABASE_URL`）。空き枠として利用可能 |
| **staging の固定URL** | **`https://whale-studio-staging.vercel.app`**（実測 200） |
| **staging の Deployment Protection** | **実測でなし**。`/login` が 200、外部APIは アプリ層の 401。認証リダイレクトなし |
| Vercel `uzupro-cms`（team `reiserteam`） | **Vercel MCP から参照不可（403）** → env 構成は**未確認** |
| uzupro ticket-link migration | **未適用**（本番DBへの適用は禁止） |
| 検証用 OA / LINE Login / LIFF | **未確認**（リポジトリからは判断できない。確認B が必要） |
| Supabase staging / preview Project | **未確認**（確認A が必要） |
| Supabase Branching 利用可否 | **未確認** |

---

## 2. 空DBへの migration 方針（重要な訂正）

**新規の空 Supabase Project に「最新 migration 1〜2本だけ」を適用する手順は誤りです。**
ticket-link の migration は既存テーブル（`oas` / `works` / `player_booking` 等）への
列追加・FK 追加を含むため、単独では成立しません。

### 方式A：空DBを構築する（新規 Supabase Project の場合）

```
全 migration を先頭から依存順に適用  →  seed  →  検証用データ作成
```

対象ブランチの `prisma/migrations/` を**すべて**適用します。
PR の migration もそのディレクトリに含まれるため、**別途 1 本だけ適用する工程はありません**。

| リポジトリ | migration 総数 | 最初 | 最新 |
|---|---|---|---|
| whale-studio（`feat/ticket-link-liff-manual`） | **81** | `0001_init` | `20260801000001_add_ticket_link_manual_flow` |
| uzupro（`feat/ticket-link-uzu-pro-sync`） | **39** | `20260711182144_init_auth` | `20260801200000_add_whale_ticket_link_sync` |

**空DBでは pending が全件になるのが正常です。**
「pending が 1 本だけなら適用」というゲートは、**既存スキーマを持つDB**にのみ適用してください。

#### 空DBへ全 migration を適用できるか

- **whale-studio: 可能**。`CREATE EXTENSION` は無し。DB 関数 `gen_unique_public_id(target_table)` は
  migration（`20260514120000_add_public_id`）が `CREATE OR REPLACE FUNCTION` で作るため、
  全適用すれば揃います。trigger は無し。
- **uzupro: 可能**。`CREATE EXTENSION` / `CREATE FUNCTION` / `CREATE TRIGGER` は**いずれも無し**。
- UUID は Prisma の `@default(uuid())`（アプリ側生成）で、`pgcrypto` 等の追加拡張は不要。

> ⚠️ 未検証: 実際に空DBへ 81 本 / 39 本を通した実績はありません。
> 途中で失敗した場合はその時点で停止し、失敗した migration 名を控えてください。

### 方式B：既存スキーマの複製を使う

既存の staging DB 等（スキーマ適用済み・**本番データを含まないもの**）が見つかった場合のみ。

```
既存 migration 適用済みスキーマ  →  差分 migration のみ
```

**本番データを含むDBのコピーは使用しないでください。**

### 推奨

確認A の結果次第です。再利用できる空スキーマ環境が無ければ **方式A**（Supabase 別 Project 新規作成）。
新規 Project 作成には費用が発生する可能性があるため、ご本人の判断で実施してください。

---

## 3. DB はアプリごとに分離する

```
Supabase Project A  →  whale-studio-staging 専用DB
Supabase Project B  →  uzupro-preview 専用DB
```

**両アプリを同じ Supabase DB の `public` schema へ接続しないでください。**
`_prisma_migrations` の共有、migration 名・テーブル名・enum 名の衝突、
一方の migration が他方のスキーマを drift とみなす危険、誤 reset の影響拡大があります。

---

## 4. 必須環境変数の棚卸し

値は記載しません。**名前と用途のみ**です。

### Whale Studio

| 分類 | 環境変数 | 用途 |
|---|---|---|
| 必須：アプリ起動 | `DATABASE_URL` | DB 接続（Transaction Pooler 6543 + 3パラメータ。CLAUDE.md 参照） |
| 必須：ログイン | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth（管理画面ログイン） |
| 必須：ログイン | `SUPABASE_SERVICE_ROLE_KEY` | サーバー側 Supabase 操作 |
| 必須：ログイン | `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` | Auth コールバック・リンク生成の基点 |
| 必須：権限 | `PLATFORM_ADMIN_USER_IDS` | プラットフォームオーナー判定（カンマ区切り userId） |
| 必須：PR2 | `NEXT_PUBLIC_LIFF_ID` | `Oa.liffId` 未設定時のフォールバック |
| 必須：PR3 | `WHALE_EXTERNAL_API_KEY` | 外部API read キー |
| 必須：PR3 | `WHALE_EXTERNAL_WRITE_API_KEY` | 外部API write キー |
| 必須：PR3 | `WHALE_EXTERNAL_OA_IDS` | 対象 OA の allowlist（未設定は deny all） |
| 任意 | `WHALE_EXTERNAL_PUBLIC_BASE_URL` | 外部APIが返すリンクの canonical origin |
| PR4以降 | `OPENAI_API_KEY` / `OPENAI_HELP_AI_MODEL` | OCR / AI 解析 |
| 任意 | `CRON_SECRET` / `ENABLE_SCHEDULED_MESSAGE_WORKER` 等 | 予約配信ワーカー（検証では不要） |
| 任意 | `CLOUDINARY_URL` / `STRIPE_*` / `UPSTASH_*` / `CONTACT_FORM_SLACK_WEBHOOK_URL` | 画像・課金・レート制限・通知 |
| 任意 | `TEST_MODE` / `TEST_LINE_USER_ID` | Webhook をテストユーザーに限定 |
| 任意 | `UZU_PRO_CMS_BASE_URL` | for ウズプロ画面のリンク |

※ LINE の channel secret / access token は **env ではなく `Oa` テーブル**に保持します（OA 設定画面から入力）。

### UZU Pro

| 分類 | 環境変数 | 用途 |
|---|---|---|
| 必須：アプリ起動 | `DATABASE_URL` / `DIRECT_URL` | DB 接続（`DIRECT_URL` は migration 用） |
| 必須：ログイン | `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth（セッション・コールバック） |
| 必須：初期データ | `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_NAME` | seed で作る初期管理者 |
| 必須：初期データ | `INITIAL_ORGANIZATION_NAME` / `INITIAL_ORGANIZATION_SLUG` | seed で作る組織 |
| 必須：PR3 | `WHALE_STUDIO_ALLOWED_BASE_URLS` | Connector の baseUrl allowlist（既定は本番URLのみ） |
| 必須：PR3 | `WHALE_STUDIO_API_KEY_TICKET_LINK_READ` | Ticket Link read キー（名前は `WHALE_STUDIO_API_KEY_` 始まり必須） |
| 必須：PR3 | `WHALE_STUDIO_API_KEY_TICKET_LINK_WRITE` | Ticket Link write キー（read と別の値） |
| 任意 | `WHALE_STUDIO_API_KEY_BELLKISH` | 既存 v1 Connector 用 |
| 任意 | `CRON_SECRET` / `SCHEDULER_*` | スケジューラ（検証では不要） |
| 任意 | `PLAYER_WEB_BASE_URL` / `PLAYER_WEB_EVENTS_SECRET` / `MARKETING_*` | 他機能 |

### Vercel でのスコープ

- **uzupro-preview 用**（`DATABASE_URL` / `DIRECT_URL` / `WHALE_STUDIO_*`）→ **Preview スコープのみ**
- **whale-studio-staging 用**（全必須 env）→ `whale-studio-staging` プロジェクトの **Production スコープ**
  （別プロジェクトなので、本番 `whale-studio` には一切影響しません）

---

## 5. 初期ユーザー・seed 手順

DB を作っただけでは管理画面へログインできません。

### Whale Studio staging（Supabase Auth）

```
ユーザー操作
場所：Supabase（Project A）→ Authentication → Users → Add user
入力する項目：検証用メールアドレス / パスワード
期待結果：検証用ログインユーザーができる。userId（UUID）を控える
秘密情報の扱い：パスワードは管理画面内で設定。本番ユーザーはコピーしない
```

```
ユーザー操作
場所：Vercel → whale-studio-staging → Environment Variables
入力する項目：PLATFORM_ADMIN_USER_IDS
設定する値の種類：上で控えた userId
期待結果：そのユーザーがプラットフォームオーナーとして扱われる
```

その後 `npm run db:seed`（Plan マスタ投入）を staging DB に対して実行し、
管理画面から **検証用 OA → 検証用 Work → LIFF ページ** を作成します。
OA 設定で検証用の channelId / channelSecret / channelAccessToken / liffId を入力します。

### UZU Pro Preview（Better Auth）

seed スクリプトが**初期管理者・組織・所属・サンプル Project** を冪等に作ります。

```
ユーザー操作
場所：Vercel → uzupro-cms → Environment Variables（Preview スコープ）
入力する項目：INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD / INITIAL_ADMIN_NAME /
　　　　　　　INITIAL_ORGANIZATION_NAME / INITIAL_ORGANIZATION_SLUG
期待結果：seed 実行時に検証用管理者と組織が作られる
```

seed 実行後、その管理者でログイン → 検証用 Project 作成 → Connector 作成 →
`OPERATION_EXECUTE` を持つロール（admin / pj_owner / operator）で「Whale連携確認」が使えます。
PlayerBooking の検証データは管理画面から手入力するか、ESCAPE.ID 取込画面に架空の Excel を通します。

> **本番ユーザーを Preview DB へコピーしないでください。**

---

## 6. migration の安全な実行方法（訂正）

**root `.env` を退避・差し替える方法は採りません**（本番 `.env` の誤復元・誤接続リスクのため）。

### 推奨：単一コマンドスコープで DB 変数を注入する

Prisma は `.env` を暗黙読込しますが、**すでに process env に設定済みの値が優先**されます。
CLAUDE.md の警告どおり `DATABASE_URL` だけでは不十分なので、**3変数すべて**を同じコマンドで注入します。

```bash
# 実行前に必ず接続先を目視確認（project ref をマスク表示）
DATABASE_URL="$TARGET_URL" node -e 'const u=new URL(process.env.DATABASE_URL);const r=(u.username.split(".")[1]||"");console.log("host:",u.hostname,"port:",u.port,"ref:",r.slice(0,4)+"…"+r.slice(-2))'

# 問題なければ 3 変数を同一コマンドで注入して適用
DATABASE_URL="$TARGET_URL" DIRECT_URL="$TARGET_URL" SHADOW_DATABASE_URL="$TARGET_URL" \
  npx prisma migrate deploy
```

- `$TARGET_URL` はシェル変数に**その場で読み込む**（`read -s` 等）。コマンド履歴・ログ・PR へ残さない
- Supabase では DDL が安定する **Session Pooler (5432)** を使う（whale-studio の CLAUDE.md 参照）
- 適用後に `npx prisma migrate status` で `Database schema is up to date!` を確認

### 禁止

- Production DB への適用
- `prisma db push` / `migrate reset` / `migrate resolve`
- `_prisma_migrations` の手動編集
- 想定外 pending を含む `migrate deploy`（※空DBの「全件 pending」は想定内）
- 秘密値をドキュメント・PR・チャットへ記載すること

---

## 7. PR2 を優先する場合の構築順序（推奨）

PR2 の LIFF 実機確認だけなら **uzupro-preview は不要**です。

1. 確認B（LINE Developers に既存の検証環境があるか）
2. 確認A（Supabase に whale-studio staging 用DBがあるか）
3. 無ければ専用 Supabase Project 作成の費用を確認
4. `whale-studio-staging` に**全必須 env** を設定（§4）
5. staging DB へ **全 migration（81本）** を適用（§6）
6. `npm run db:seed` → 検証用ログインユーザー・OA・Work を作成（§5）
7. 検証用 LINE Login チャネル + LIFF を用意（§8）
8. LIFF endpoint URL を **`https://whale-studio-staging.vercel.app/liff`** に設定
9. PR #599 相当のコードを staging へデプロイ
10. [`TICKET_LINK_PREVIEW_VERIFICATION.md`](./TICKET_LINK_PREVIEW_VERIFICATION.md) に従って実機確認

## 8. PR3 を確認する段階の構築順序

1. Supabase Project B（`uzupro-preview`）を用意
2. Vercel `uzupro-cms` の **Preview スコープのみ**に §4 の env を設定
3. PR #71 の Preview を再デプロイ
4. Preview DB へ **全 migration（39本）** を適用（§6）
5. seed 実行 → 検証用 Project・Connector・架空 PlayerBooking を作成
6. Connector の Base URL を **`https://whale-studio-staging.vercel.app`** に設定
7. 「Whale連携確認」を実行して §12 の項目を確認

---

## 9. 検証用 LINE 環境

構成（PR2 の strict 認証がチャネル一致を検証するため、**同一 Provider 配下**が必須）:

```
検証用 Provider
├─ Messaging API チャネル（＝検証用 OA）… channelId / channelSecret / channelAccessToken
└─ LINE Login チャネル
   └─ LIFF アプリ … LIFF ID = {LINE LoginチャネルID}-{サフィックス}
                    endpoint: https://whale-studio-staging.vercel.app/liff
                    scope: profile / openid / ★chat_message.write
                    bot link: On（検証用OAを選択）
```

既存の検証用環境が確認B で見つかった場合は再利用してください。無い場合のみ新規作成します
（こちらでは作成しません）。

> ⚠️ **本番 OA / 本番 Work の `liffId` / 本番 LIFF の endpoint URL は変更しない。**

---

## 10. service-to-service 接続（実測済み）

**接続先は `https://whale-studio-staging.vercel.app` を推奨**します。

| 確認項目 | 実測結果 |
|---|---|
| Deployment Protection | **なし**（`/login` が 200・認証リダイレクトなし） |
| サーバー間通信 | 可能（外部APIは アプリ層の 401 を返す＝到達している） |
| endpoint の固定性 | **固定**（deployment hash なしの alias が 200） |
| HTTPS | ✅ HSTS 付き |
| base URL allowlist へ追加 | uzupro 側 `WHALE_STUDIO_ALLOWED_BASE_URLS` に設定すれば可 |
| Production データ参照 | **していない**（`DATABASE_URL` 未設定のため。専用DB割当後は Project A を参照） |

Preview の commit URL は Deployment Protection 配下で service-to-service に向きません。
staging の固定 URL を使えば bypass の実装も Protection 解除も不要です。

---

## 11. テストデータ（架空値のみ）

```
Project      ：Preview Verification
予約番号      ：999-001 / 999-002 / 999-003 …
コードネーム   ：TEST-AGENT-1 / TEST-AGENT-2 …
LINE表示名    ：Preview Test User
名前         ：動作確認ユーザー
```

ケース: ①予約0件 ②予約1件 ③同一予約番号で複数日時 ④人数一致 ⑤人数不一致
⑥既存 PlayerMember なし ⑦既存あり・名前空 ⑧既存コードネーム一致 ⑨既存コードネーム競合
⑩CMS反映後・Whale未報告 ⑪別 LINE userId 連携済み ⑫キャンセル予約

## 12. PR3 の検証項目

**Connector 設定**: read/write の環境変数名を保存できる / 既存 v1 の `secretEnvKey` が維持される /
未設定でボタン disabled + 理由 / 環境変数名・秘密値が一般画面に出ない

**権限**: admin・pj_owner・operator は実行可 / **viewer・pj_editor はボタン非表示** /
Connector なし・無効・workId なしは disabled + 理由

**同期**: 実行中 disabled + 進行文言 / 二重クリック防止 / 部分成功 /
予約0件→取込待ち・1件→連携成功・複数→複数候補 / 人数不一致 / キャンセル /
コードネームが `PlayerMember.playerName` へ入る / **`PlayerMember.lineUserId` が変化しない** /
**`PlayerBooking.integrationStatus` が変化しない** / `whale*` 列が入る /
ActivityLog が 1 実行 1 件 / 集計9項目 / 予約番号マスク / LINE userId 非表示

**再送**: Whale 側を落とすと `cmsAppliedAt` あり・`whaleReportedAt` なし・`WHALE_REPORT_FAILED` /
復旧後は**結果送信だけ**行われ `PlayerMember` が再更新されない / 成功後に `whaleReportedAt` が入る

## 13. 後片付け

- 検証用 Project / 予約 / TicketLink は検証専用環境に閉じるため残置可
- 検証用 LIFF の endpoint URL を変更した場合は元に戻す
- 本番 OA / 本番 Work / 本番 LIFF は最初から触らない

## 14. 本番反映前ゲート

- [ ] whale-studio #598 がマージ済み
- [ ] whale-studio 側外部APIが対象環境へデプロイ済み
- [ ] read / write APIキーが UZU Pro 側へ設定済み
- [ ] 対象 OA が `WHALE_EXTERNAL_OA_IDS` allowlist へ登録済み
- [ ] UZU Pro 側 migration が適用済み（**マージ＝本番デプロイ時に自動適用される点に注意**）
- [ ] 接続確認が成功
- [ ] **Supabase ダッシュボードでバックアップ・PITR 設定を確認済み**
      （whale-studio の migration は未確認のまま適用した。今後の Production DB 変更前は必須）
