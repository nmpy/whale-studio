# チケット連携 検証環境の構築手順

PR2（whale-studio #599）と PR3（uzupro #71）を、**本番データ・本番OA・本番LIFFを一切使わずに**
実際に動かすための環境構築手順。

実機の操作手順そのものは [`TICKET_LINK_PREVIEW_VERIFICATION.md`](./TICKET_LINK_PREVIEW_VERIFICATION.md) に分離してある。
本書は「環境を用意するまで」、あちらは「用意できた環境で何を確認するか」を扱う。

> 本書の手順の大半は Vercel / Supabase / LINE Developers の管理画面操作であり、
> **ご本人による実施が必要**。接続文字列・APIキー・channel secret・access token を
> チャットへ貼る必要はない（各管理画面の中だけで設定する）。

---

## 1. 現在利用可能な環境（調査結果）

| 環境 | 状態 |
|---|---|
| Vercel `whale-studio`（team: whalestudio-beta） | 稼働中。**Production / Preview が同一 DB を参照**（Preview から本番作品IDを解決できることで実証済み） |
| Vercel `whale-studio-staging`（同 team） | **デプロイは成功しているが `DATABASE_URL` が未設定**。DB 依存 API は 500（`Environment variable not found: DATABASE_URL`）。**空きステージング枠として利用可能** |
| Vercel `uzupro-cms`（team: reiserteam） | 稼働中。**Vercel MCP から参照不可（403）**のため env 構成は未確認 |
| whale-studio ticket-link migration | 本番DBへ**適用済み**（2026-07-31 16:48Z）。Preview も同一DBのため利用可能 |
| uzupro ticket-link migration | **未適用**（本番DBへの適用は禁止） |
| 検証用 OA / LINE Login チャネル / LIFF | **リポジトリ内に痕跡なし。存在しないものとして扱う** |

## 2. 不足している環境

1. **uzupro の Preview 専用 DB**（最優先）
2. whale-studio staging の `DATABASE_URL` ほか環境変数（任意。Preview で代替可）
3. 検証用 LINE Provider / Messaging APIチャネル(OA) / LINE Login チャネル / LIFF アプリ
4. Preview 間の service-to-service 接続手段（後述の課題あり）

---

## 3. Whale Studio の Preview / Staging 構成

- `whale-studio` プロジェクトの Preview は **Production と同じ DB** を見る。
  ticket-link migration は適用済みなので、**PR #599 の Preview はそのまま動く**。
- `whale-studio-staging` は同じリポジトリの2つ目の Vercel プロジェクトで、
  main への push で Production 相当、PR で Preview がそれぞれ作られる。
  現在 `DATABASE_URL` 未設定のため DB 依存機能は動かない。
- LIFF ID は `Oa.liffId`（OA ごと）→ `NEXT_PUBLIC_LIFF_ID`（env）の順で解決される。
  `Oa.liffEndpointUrl` は**表示用のメモ**で runtime 挙動に影響しない
  （実際の endpoint URL は LINE Developers 側の設定が正）。
- 外部 API の env: `WHALE_EXTERNAL_API_KEY`(read) / `WHALE_EXTERNAL_WRITE_API_KEY`(write) /
  `WHALE_EXTERNAL_OA_IDS`(allowlist) / `WHALE_EXTERNAL_PUBLIC_BASE_URL`。

### 選択肢A（推奨・最短）: `whale-studio` の Preview をそのまま使う

migration 適用済み・DB 接続済みで**追加作業が不要**。ただし本番DBを共有するため、
**検証専用 Work / 検証専用 OA を新規に作り、実在データには触れない**運用が前提。

### 選択肢B: `whale-studio-staging` に専用 DB を用意する

本番DBから完全に分離できるが、Supabase Project の新規作成と全 env の設定が必要
（`DATABASE_URL` のほか Supabase / LINE / 外部API キー一式）。手間は大きい。

---

## 4. UZU Pro の Preview 構成

- `npm run build` は `next build` のみ。migration は `scripts/vercel-build.mjs` が
  **`VERCEL_ENV === "production"` のときだけ** `prisma migrate deploy` を実行する。
  → **Preview では migration が走らない**（＝Preview DB には手動適用が必要）。
- ローカル DB 操作は `npm run db:*`（`scripts/prisma-local.mjs` 経由で localhost のみ許可）。
  raw `npx prisma migrate deploy` は root `.env`（本番）を読むため**使わない**。
- 現状 Preview の `DATABASE_URL` が Production と同一かは **未確認**（Vercel MCP 403）。
  同一である前提で扱い、**分離が確認できるまで Preview で PR3 を動かさない**。

---

## 5. Preview 専用 DB の作成手順（最優先）

### 方式の比較

| 方式 | 費用 | 分離度 | 備考 |
|---|---|---|---|
| **A. Supabase 別 Project** | 無料枠があれば0円。組織の枠を超えると有料 | ◎ 完全分離 | 最も確実。**推奨** |
| B. Supabase Branching | 有料プラン機能（要確認） | ◎ | 利用可否はプラン依存。ダッシュボードで確認が必要 |
| C. 既存 staging DB | 0円 | — | **存在しない**（whale-studio-staging は DB 未設定） |
| D. ローカル PostgreSQL | 0円 | ◎ | Preview では使えないが、**integration テストは動く** |

> ⚠️ 新規 Supabase Project / Branch の作成は**費用が発生する可能性**があるため、
> ご本人の判断で実施してください。こちらでは作成しません。

### ユーザー操作 5-1: Preview 用 DB を作る

```
ユーザー操作
場所：Supabase ダッシュボード
入力する項目：新規 Project 名（例 uzupro-preview）/ リージョン（Tokyo 推奨）/ DB パスワード
設定する値の種類：新規 Project の作成
期待結果：Project が作成され、Connection string を取得できる
秘密情報の扱い：接続文字列・パスワードはダッシュボード内で控える。チャットへ貼らない
```

### ユーザー操作 5-2: Vercel の Preview スコープにだけ env を設定

```
ユーザー操作
場所：Vercel → uzupro-cms → Settings → Environment Variables
入力する項目：DATABASE_URL / DIRECT_URL
設定する値の種類：手順5-1 で取得した Preview 用 DB の接続文字列
　　　　　　　　　DATABASE_URL は Transaction Pooler(6543)、DIRECT_URL は Session Pooler(5432) 相当
Environment Scope：★必ず「Preview」のみにチェック（Production / Development には設定しない）
期待結果：Preview 環境のみ別 DB を参照する
秘密情報の扱い：Vercel 管理画面内でのみ入力
```

```
ユーザー操作
場所：同上
入力する項目：WHALE_STUDIO_API_KEY_TICKET_LINK_READ / WHALE_STUDIO_API_KEY_TICKET_LINK_WRITE
設定する値の種類：Whale Studio 側で発行する Preview 用の read / write APIキー（別々の値）
　　　　　　　　　※ 環境変数名は `WHALE_STUDIO_API_KEY_` で始める必要がある（コード側の制約）
Environment Scope：Preview のみ
期待結果：Connector 設定でこの env 名を指定できる
秘密情報の扱い：Production のキーを流用しない
```

```
ユーザー操作
場所：同上
入力する項目：WHALE_STUDIO_ALLOWED_BASE_URLS
設定する値の種類：接続先 Whale Studio の base URL（Preview / staging の URL）
Environment Scope：Preview のみ
期待結果：Connector の baseUrl 検証を通る（既定は https://app.whale-studio.app のみ許可）
秘密情報の扱い：秘密ではないが Production スコープへは設定しない
```

### ユーザー操作 5-3: PR #71 の Preview を再デプロイ

```
ユーザー操作
場所：Vercel → uzupro-cms → Deployments → PR #71 の最新 Preview
入力する項目：なし（Redeploy）
期待結果：新しい env を読み込んだ Preview が作成される
補足：env 変更を確実に反映するため、Redeploy で反映されない場合は PR ブランチへ空コミットを push する
```

---

## 6. Preview DB への migration 適用

`VERCEL_ENV=preview` では自動適用されないため、**手動適用が必要**。

適用対象は次の 1 本のみ。

```
20260801200000_add_whale_ticket_link_sync
```

### 適用前チェック（すべて満たすこと）

- 接続先が **Preview 専用 DB** であり Production DB ではない（ホスト / Project ID を目視確認）
- `prisma migrate status` の pending が**上記1本だけ**
- failed migration が 0 件
- drift なし
- migration SQL が PR #71 の内容と一致
- 対象ブランチ / HEAD が PR #71（`feat/ticket-link-uzu-pro-sync`）と一致
- `git status` が clean

### 適用方法

uzupro の CLAUDE.md により、raw `npx prisma migrate deploy` は root `.env`（本番）を読むため**使わない**。
Preview DB へ適用する正式な口は現状 2 つ。

1. **`.env` を一時退避し、DB系3変数（`DATABASE_URL` / `DIRECT_URL` / `SHADOW_DATABASE_URL`）を
   すべて Preview DB へ向けてから `npm run db:deploy` を実行**。終了後 `.env` を復元する。
   ※ CLAUDE.md の「使い捨てローカル DB」手順に準じた運用。ホストが localhost ではないため
   `npm run db:migrate`（localhost ガード付き）は使えない点に注意。
2. Supabase ダッシュボードの SQL エディタで migration SQL を実行し、
   `_prisma_migrations` へ手動記録する — **非推奨**（履歴の手動編集は禁止事項）。

> どちらも本書の想定ではご本人の実施が必要。禁止事項: Production DB への適用 /
> `prisma db push` / `migrate reset` / `_prisma_migrations` の手動変更 / 想定外 pending を含む deploy。

---

## 7. 検証用 OA・LINE Login チャネル・LIFF の作成

現状、リポジトリ内に検証用 LINE 環境の痕跡はない。**新規作成が必要**（こちらでは作成しない）。

### 構成（重要）

```
検証用 Provider
├─ Messaging API チャネル（＝検証用 OA）… channelId / channelSecret / channelAccessToken
└─ LINE Login チャネル                  … これに LIFF アプリをぶら下げる
   └─ LIFF アプリ                        … LIFF ID = {LINE LoginチャネルID}-{サフィックス}
```

PR2 の strict 認証は、アクセストークンの `client_id` と
**`Oa.liffId` から導出した LINE Login チャネル ID** の一致を検証する。
そのため **LIFF は必ず検証用 OA と同じ Provider 配下の LINE Login チャネル**に作ること。

### ユーザー操作 7-1〜7-4

```
ユーザー操作
場所：LINE Developers Console
入力する項目：新規 Provider（例 Whale Studio Verification）
期待結果：検証専用の Provider ができる
秘密情報の扱い：なし
```

```
ユーザー操作
場所：LINE Developers Console → 上記 Provider
入力する項目：Messaging API チャネルを新規作成（＝検証用 OA）
設定する値の種類：チャネル名 / 業種など
期待結果：channelId・channel secret・channel access token を取得できる
秘密情報の扱い：値は Vercel の env / Whale Studio の OA 設定画面にだけ入力する
```

```
ユーザー操作
場所：同 Provider
入力する項目：LINE Login チャネルを新規作成
設定する値の種類：チャネル名 / アプリタイプ（ウェブアプリ）
期待結果：LINE Login チャネル ID を取得できる
秘密情報の扱い：なし（チャネルIDは秘密ではない）
```

```
ユーザー操作
場所：LINE Login チャネル → LIFF タブ
入力する項目：LIFF アプリを追加
設定する値の種類：
  - サイズ：Full
  - エンドポイントURL：Whale Studio Preview の /liff（例 https://whale-studio-xxxx.vercel.app/liff）
  - スコープ：profile / openid に加えて ★chat_message.write を有効化
  - ボットリンク機能：On（検証用OAを選択）
期待結果：LIFF ID（{LINE LoginチャネルID}-{サフィックス}）を取得できる
秘密情報の扱い：LIFF ID は秘密ではない
```

> ⚠️ **本番の OPERATION ; BELLKISH の OA / LIFF / Work 設定は変更しない**。
> 本番 LIFF の endpoint URL 切り替えによる検証は禁止。

### Vercel Deployment Protection について

Whale Studio の Preview URL は Deployment Protection で保護されている。
LINE アプリ内の LIFF ブラウザからは認証を通せないため、**そのままでは LIFF として開けない可能性が高い**。

```
ユーザー操作
場所：Vercel → whale-studio → Settings → Deployment Protection
入力する項目：Protection Bypass for Automation、または対象 Preview の Protection を一時的に無効化
設定する値の種類：正式なバイパス設定
期待結果：LIFF ブラウザから Preview を開ける
秘密情報の扱い：bypass token は Vercel 内で管理する
注意：恒久的に Protection を外すと Preview が公開状態になる。検証後に戻すこと
```

---

## 8. Whale Studio 側で必要な設定

```
ユーザー操作
場所：Whale Studio 管理画面（Preview） → OA 設定
入力する項目：検証用 OA を新規作成し、channelId / channelSecret / channelAccessToken / liffId を設定
期待結果：Oa.liffId が検証用 LIFF を指す（strict 認証の期待チャネルIDがここから導出される）
秘密情報の扱い：管理画面内でのみ入力
```

```
ユーザー操作
場所：Whale Studio 管理画面（Preview） → 検証用 Work → LIFF 設定 → チケット連携タブ
入力する項目：TICKET_LINK_PREVIEW_VERIFICATION.md の「1. 管理画面での準備」に従って設定
期待結果：帯が「プレイヤーへの公開準備が完了しています」になる
```

```
ユーザー操作
場所：Vercel → whale-studio → Settings → Environment Variables
入力する項目：WHALE_EXTERNAL_API_KEY / WHALE_EXTERNAL_WRITE_API_KEY / WHALE_EXTERNAL_OA_IDS
設定する値の種類：Preview 用に新規発行した read / write キー（別々の値）と、検証用 OA の ID
Environment Scope：Preview のみ
期待結果：uzupro Preview から外部APIを呼べる
秘密情報の扱い：Production のキーを流用しない
```

## 9. UZU Pro 側で必要な設定

```
ユーザー操作
場所：UZU Pro（Preview） → プロジェクト → 連携（Integrations）→ 新規コネクタ
入力する項目：
  - Base URL：Whale Studio Preview の URL
  - OA ID / Work ID：Whale Studio 側の検証用 OA / Work の UUID
  - APIキー環境変数名（v1）：既存のまま
  - Ticket Link 読み取り用APIキー環境変数名：WHALE_STUDIO_API_KEY_TICKET_LINK_READ
  - Ticket Link 書き込み用APIキー環境変数名：WHALE_STUDIO_API_KEY_TICKET_LINK_WRITE
期待結果：プレイヤー画面の「Whale連携確認」ボタンが有効になる
秘密情報の扱い：★キーの値は入力しない（環境変数名のみ）
```

---

## 10. service-to-service 接続の課題（要判断）

uzupro Preview → whale-studio Preview のサーバー間通信は、
**whale-studio 側の Vercel Deployment Protection でブロックされる**見込み。

考えられる対処（いずれもご本人の設定判断が必要）:

1. **Protection Bypass for Automation** を whale-studio で有効化し、
   uzupro 側から `x-vercel-protection-bypass` ヘッダを付ける
   → **コード変更が必要**。今回は勝手に実装しない
2. whale-studio 側の Protection を検証期間だけ無効化する（Preview が公開状態になる点に注意）
3. `whale-studio-staging` に DB と env を設定し、**保護なしの安定 URL** を接続先にする
4. PR #598 をマージして本番APIを使う → **今回は禁止**

> 現時点では 3 が最も筋が良い（安定 URL・本番DBと分離・LIFF endpoint にも使える）が、
> Supabase Project の新規作成と env 一式の設定が必要。

---

## 11. PR2 の検証手順

環境が整ったら [`TICKET_LINK_PREVIEW_VERIFICATION.md`](./TICKET_LINK_PREVIEW_VERIFICATION.md) に従う
（管理画面24項目 / LIFF21項目 / 報告ボタン6項目 / 異常系）。

## 12. PR3 の検証手順

Preview DB と Connector が用意できたら以下を確認する。

### Connector 設定
- read / write の環境変数名を保存できる
- 既存 v1 の `secretEnvKey` が維持される
- read か write が未設定だとボタンが disabled で理由が出る
- 環境変数名・秘密値が一般画面に出ない

### 権限
- admin / pj_owner / operator … ボタンが表示され実行できる
- viewer / pj_editor … **ボタンが表示されない**
- Connector なし / 無効 / workId なし … disabled + 理由

### 同期
- 実行中は disabled +「Whale Studioの連携情報を確認しています」
- 二重クリックで2回実行されない
- 部分成功（成功・取込待ち・競合が混在しても全件処理される）
- 予約0件 → 予約データ取込待ち / 1件 → 連携成功 / 複数候補 → 複数候補
- 人数不一致 / キャンセル済み がそれぞれ分類される
- コードネームが `PlayerMember.playerName` へ入る
- **`PlayerMember.lineUserId` / `lineLinkedAt` が変化しない**
- **`PlayerBooking.integrationStatus` が変化しない**
- `PlayerBooking` に代表者 LINE 情報と `whaleTicketLinkId` / `whaleSyncedAt` / `whaleSyncResult` が入る
- ActivityLog が 1 実行 1 件
- 集計9項目と詳細一覧が出る / 予約番号がマスクされる / LINE userId が出ない

### 再送
- Whale 側を一時的に落とす（またはキーを誤設定する）と
  `cmsAppliedAt` あり・`whaleReportedAt` なし・`lastErrorCode=WHALE_REPORT_FAILED` になる
- 復旧後にもう一度実行すると **結果送信だけ**行われ、`PlayerMember` が再更新されない
- 成功後に `whaleReportedAt` が入る

---

## 13. テストデータ（架空値のみ）

実在の購入者・予約・プレイヤーは使わない。

```
Project      ：Preview Verification
予約番号      ：999-001 / 999-002 / 999-003 …
コードネーム   ：TEST-AGENT-1 / TEST-AGENT-2 …
LINE表示名    ：Preview Test User
名前         ：動作確認ユーザー
```

用意するケース: ①予約0件 ②予約1件 ③同一予約番号で複数日時 ④人数一致 ⑤人数不一致
⑥既存 PlayerMember なし ⑦既存あり・名前空 ⑧既存コードネーム一致 ⑨既存コードネーム競合
⑩CMS反映後・Whale未報告 ⑪別 LINE userId 連携済み ⑫キャンセル予約

## 14. 後片付け

- 検証用 Project / 予約 / TicketLink は検証専用環境に閉じるため残置可
- Vercel Deployment Protection を一時的に外した場合は**必ず戻す**
- 検証用 LIFF の endpoint URL を別環境へ向けた場合は元に戻す
- 本番 OA / 本番 Work / 本番 LIFF の設定は最初から触らない

## 15. 本番反映前ゲート

- [ ] whale-studio #598 がマージ済み
- [ ] whale-studio 側外部APIが対象環境へデプロイ済み
- [ ] read / write APIキーが UZU Pro 側へ設定済み
- [ ] 対象 OA が `WHALE_EXTERNAL_OA_IDS` allowlist へ登録済み
- [ ] UZU Pro 側 migration が適用済み（**マージ＝本番デプロイ時に自動適用される点に注意**）
- [ ] 接続確認が成功
- [ ] **Supabase ダッシュボードでバックアップ・PITR 設定を確認済み**
      （whale-studio の migration は未確認のまま適用した。今後の Production DB 変更前は必須）
