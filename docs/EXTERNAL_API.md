# Whale Studio 外部連携 API（read + Live ticket-link mint）

外部システム（ウズプロ / ESCAPE.ID 等）から Whale Studio の **作品・フェーズ情報** と **管理/Live(Staff) 画面へのリンク** を取得し、加えて **予約完了メール用の専用 LIFF URL を発行（mint）** するための API。

- **ステータス**: read は本番稼働中（PR #574 + PR #575）。write（Live ticket-link mint）は Live ticket-link Phase 1/2 で追加。
- **範囲**: **読み取り系・リンク取得系**（works / phases / phase-links）＋ **Live ticket-link mint**（write・別キー `WHALE_EXTERNAL_WRITE_API_KEY`）。
  プレイヤー進行状態の変更 / フェーズ移動 / LINE 送信は **行わない**。
- ベースパス: `/api/external/v1`
- 本番ホスト: `https://app.whale-studio.app`

> ⚠️ このドキュメントに **API キーの実値・OA のシークレット類（channel secret / access token / lineOaId / owner key / DATABASE_URL 等）は一切書かない**こと。値は Vercel env / 安全な経路でのみ共有する。

---

## エンドポイント一覧

read API はすべて `GET`・`x-whale-api-key` ヘッダー必須。加えて write の mint API（`POST`）がある。
成功レスポンスは既存慣習の `{ "success": true, "data": ... }` エンベロープ。**payload キーは camelCase**。

| メソッド | パス | 用途 | 照合キー |
|---|---|---|---|
| GET | `/api/external/v1/works` | allowlist 内 OA の **active 作品**一覧 | `WHALE_EXTERNAL_API_KEY`（read） |
| GET | `/api/external/v1/works/:workId/phases` | 指定作品のフェーズ一覧（非 global のみ） | `WHALE_EXTERNAL_API_KEY`（read） |
| GET | `/api/external/v1/works/:workId/phase-links` | 作品単位リンク + フェーズ単位 `adminUrl` | `WHALE_EXTERNAL_API_KEY`（read） |
| POST | `/api/external/v1/live/ticket-links` | **[v1 legacy]** Live ticket-link mint（`reservationNumber` / 任意 `ticketId`） | `WHALE_EXTERNAL_WRITE_API_KEY`（write） |
| PUT | `/api/external/v2/live/sessions` | **[v2]** 匿名の公演セッションを冪等 upsert（`externalSessionRef`） | `WHALE_EXTERNAL_WRITE_API_KEY`（write） |
| POST | `/api/external/v2/live/ticket-links` | **[v2]** 匿名予約枠の LIFF URL / トークン **発行**（`externalBookingRef` / `capacity`） | `WHALE_EXTERNAL_WRITE_API_KEY`（write） |
| GET | `/api/external/v2/live/ticket-links` | **[v2]** 匿名予約枠のチケットリンク**状態取得**（PII 非返却） | `WHALE_EXTERNAL_API_KEY`（read） |
| POST | `/api/external/v2/live/ticket-links/revoke` | **[v2]** 匿名予約枠のチケットリンク**失効**（冪等） | `WHALE_EXTERNAL_WRITE_API_KEY`（write） |

> mint（write）はヘッダー名こそ `x-whale-api-key` だが照合先が **read と別の env**。詳細は下記「認証 →（write API 認証）」を参照。
>
> **v1 と v2 は別バージョン**。**v1**（`POST /api/external/v1/live/ticket-links`）は既存クライアント向けに**現行契約・挙動のまま維持**（`reservationNumber` 必須 / 任意 `ticketId`）。**v2** は匿名予約モデル専用（ウズプロCMS が使用）。両者は request/response schema を共有しない。詳細は下記「v1 legacy チケットリンク API」「v2 匿名連携（ウズプロCMS）Live API」。

### GET /api/external/v1/works

allowlist 内 OA の `publishStatus="active"` 作品のみ返す。

```json
{
  "success": true,
  "data": {
    "works": [
      {
        "id": "8887ea5d-21e9-48c9-9bb0-4b957b0e9a70",
        "publicId": "ek80uvru81",
        "oaId": "8500d2ba-7418-4522-...",
        "title": "OPERATION ; BELKISSH",
        "publishStatus": "active",
        "sortOrder": 0,
        "phaseCount": 0
      }
    ]
  }
}
```

- `phaseCount` は **非 global フェーズ**の件数（`/phases` が返す集合と一致）。

### GET /api/external/v1/works/:workId/phases

```json
{
  "success": true,
  "data": {
    "work": { "id": "...", "publicId": "...", "oaId": "...", "title": "..." },
    "phases": [
      { "id": "...", "key": "intro", "name": "序章", "phaseType": "start", "order": 0, "isActive": true }
    ]
  }
}
```

- `phaseType = "global"` のフェーズ（「全フェーズ共通」コンテナ）は **意図的に除外**する。
- `key` は内部の `phaseKey`（スプレッドシート取込用の安定キー。手動作成データは `null`）。

### GET /api/external/v1/works/:workId/phase-links

```json
{
  "success": true,
  "data": {
    "work": { "id": "...", "oaId": "...", "title": "..." },
    "links": {
      "scenarioUrl":  "https://app.whale-studio.app/oas/{oaId}/works/{workId}/scenario",
      "liveAdminUrl": "https://app.whale-studio.app/oas/{oaId}/live/admin?workId={workId}",
      "liveActorUrl": "https://app.whale-studio.app/oas/{oaId}/live/actor?workId={workId}"
    },
    "phases": [
      { "id": "...", "key": "intro", "name": "序章", "order": 0,
        "adminUrl": "https://app.whale-studio.app/oas/{oaId}/works/{workId}/phases/{phaseId}" }
    ]
  }
}
```

- **`adminUrl` はフェーズ単位**（フェーズ編集画面）。
- **`scenarioUrl` / `liveAdminUrl` / `liveActorUrl` は作品単位**。
  Live/Staff 画面は OA×セッション×参加者スコープで **フェーズ単位 URL を持たない**ため、フェーズ別 Staff URL は生成しない。
- リンクは URL 文字列を返すだけ。**開いた人は従来どおり Supabase Auth + RBAC で保護される**（リンク返却は権限をバイパスしない）。

---

## 認証

read（works / phases / phase-links）と write（Live ticket-link mint）で **キーを分離**する。ヘッダーはどちらも `x-whale-api-key`、照合先の env が異なる。

### read API 認証（works / phases / phase-links）

- 必須ヘッダー: **`x-whale-api-key`**
- サーバは env **`WHALE_EXTERNAL_API_KEY`** と **定数時間比較**する（sha256 ダイジェスト化して長さリークも回避）。
- 既存の Supabase Auth (`withAuth`) / RBAC とは **独立した別系統**。所有関係・既存認証には干渉しない。

| 状態 | レスポンス |
|---|---|
| `WHALE_EXTERNAL_API_KEY` 未設定 | **503**（設定不備 / fail closed。全環境共通） |
| `x-whale-api-key` 欠落 | **401** |
| `x-whale-api-key` 不一致 | **401** |
| 一致 | **200**（allowlist スコープ付き） |

### write API 認証（v1 mint `POST /api/external/v1/live/ticket-links` + v2 write: `PUT/POST /api/external/v2/live/*`）

- 必須ヘッダー: **`x-whale-api-key`**（read と同じヘッダー名）。
- サーバは read とは **別の env `WHALE_EXTERNAL_WRITE_API_KEY`** と **定数時間比較**する。
- **read 用 `WHALE_EXTERNAL_API_KEY` では mint を認証できない**（write キーへ read キーはフォールバックしない）。
- 認証成功後も、対象 OA は下記 `WHALE_EXTERNAL_OA_IDS` allowlist による **認可が引き続き必要**（allowlist 外は存在秘匿の 404）。

| 状態 | レスポンス |
|---|---|
| `WHALE_EXTERNAL_WRITE_API_KEY` 未設定 | **503**（fail closed。設定するまで mint は使えない） |
| `x-whale-api-key` 欠落 | **401** |
| `x-whale-api-key` 不一致（read キーを送った場合を含む） | **401** |
| 一致 かつ allowlist 内 | **200** |

> ⚠️ `WHALE_EXTERNAL_WRITE_API_KEY` は read 用とは **別値**（十分に長いランダム値）。実値はドキュメント / commit / log / PR に **一切書かない**。

---

## 公開対象の制限（allowlist）

- 対象 OA は env **`WHALE_EXTERNAL_OA_IDS`**（カンマ区切り）で制限する（**最小権限 / allowlist 方式**）。
- **`WHALE_EXTERNAL_OA_IDS` 未設定 or 空 → 空集合（deny all）**。
  「全 active 作品を返す」挙動には **絶対にしない**（= production でも fail closed）。
- allowlist 内 OA の **`publishStatus="active"` 作品のみ**露出する。
- 次はいずれも一律 **404**（存在有無を漏らさない = 存在秘匿）:
  - allowlist 外 OA の作品
  - 非 active（draft / paused）の作品
  - 不在の `workId`

---

## links の base URL 仕様

外部 API が返す links の origin は、専用 env で解決する。

- 優先順:
  1. **`WHALE_EXTERNAL_PUBLIC_BASE_URL`**（外部連携 API 専用の**任意** env。Preview 等で別ドメインを返したい時のみ設定）
  2. 未設定なら既定 **`https://app.whale-studio.app`**（canonical）
- **共有 env `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` には依存しない**。
  これらは LINE 配信 / LIFF / Stripe / consent / 招待リンク等でも使われるため、外部 API のリンクだけ canonical に固定して blast radius を外部 API のみに限定している（PR #575）。
- リンク種別:
  - **フェーズ単位**: `adminUrl`
  - **作品単位**: `scenarioUrl` / `liveAdminUrl` / `liveActorUrl`

---

## 返す情報 / 返さない情報

### 返す（非機密のみ）

| リソース | フィールド |
|---|---|
| Work | `id`, `publicId`, `oaId`, `title`, `publishStatus`, `sortOrder`, `phaseCount` |
| Phase | `id`, `key`, `name`, `phaseType`, `order`, `isActive` |
| Link | `scenarioUrl`, `liveAdminUrl`, `liveActorUrl`（作品単位） / `adminUrl`（フェーズ単位） |

### 返さない（select とホワイトリストマッピングで構造的に除外）

- puzzle の正解、transition の条件、message の本文
- `startTrigger` / `startKeyword` / `resumeSummary` / `welcomeMessage`
- LINE userId、予約番号 / 購入者名 / ticketId 等の個人情報
- OA の `channelSecret` / `channelAccessToken` / `lineOaId` / `ownerKey`
- LiveSession / LiveTeam / LiveParticipant の個人情報・状態

---

## env 一覧

| env | 必須 | 未設定時の挙動 | 用途 |
|---|---|---|---|
| `WHALE_EXTERNAL_API_KEY` | **必須** | **503**（fail closed） | **read** API（works / phases / phase-links）の `x-whale-api-key` 照合キー。十分に長いランダム値。 |
| `WHALE_EXTERNAL_WRITE_API_KEY` | **write 利用時 必須** | **503**（fail closed。mint のみ） | **write** API（Live ticket-link mint）の照合キー。read 用とは**別値**。read キーへフォールバックしない。 |
| `WHALE_EXTERNAL_OA_IDS` | 実質必須 | **空集合＝何も返さない**（deny all） | 外部公開してよい OA の allowlist（カンマ区切り・read/write 共通）。 |
| `WHALE_EXTERNAL_PUBLIC_BASE_URL` | 任意 | **`https://app.whale-studio.app`**（canonical） | links の base origin。Preview 等で別ドメインを返す時のみ設定。 |

> `WHALE_EXTERNAL_API_KEY` / `WHALE_EXTERNAL_WRITE_API_KEY` の値・OA のシークレット類はドキュメント/commit/log に書かない。

---

## 現在の本番設定

| 項目 | 値 |
|---|---|
| 対象 OA | `8500d2ba-7418-4522-a810-...`（`WHALE_EXTERNAL_OA_IDS`） |
| OA 名 | `OPERATION ; BELLKISH` |
| `WHALE_EXTERNAL_PUBLIC_BASE_URL` | **未設定**（= canonical `https://app.whale-studio.app` にフォールバック） |
| `WHALE_EXTERNAL_API_KEY` | 設定済み（値は非公開） |

> 対象 OA の UUID・名称は非機密のため記載可。フル UUID は Vercel env / 管理画面で確認する。

---

## 既知の状態 / 運用メモ

- 対象 work **`OPERATION ; BELKISSH`** は現在、**非 global フェーズが 0 件**。
  存在するのは `global`「全フェーズ共通」フェーズ 1 件のみで、これは外部 API で意図的に除外している。
  → そのため現状 `/works` の `phaseCount` は 0、`/phases`・`/phase-links` の `phases` は空配列になる（**仕様どおり**。API のバグではない）。
- **CMS で start / normal / ending 等の非 global フェーズを作成すれば、`/phases`・`/phase-links` に自動で反映される**。
  外部 API は都度 DB を読むため、**再デプロイは不要**（作成後すぐ反映。`adminUrl` も付与される）。
- **将来 D.O.T 等を外部連携対象に追加する場合**は、`WHALE_EXTERNAL_OA_IDS` に **カンマ区切りで UUID を追記** → **fresh deploy**（空コミット push）で反映する。
  - Vercel Dashboard の Redeploy は env snapshot を再利用するため使わない（新しいコミットによる fresh deploy が確実 — CLAUDE.md 運用ルール参照）。

---

## 影響しない領域（設計上の保証）

本 API は新規の読み取り専用ルート追加のみで、以下には**一切関与しない**:

- DB schema / Prisma migration（**migration なし**。既存フィールドを read するだけ）
- webhook / LINE runtime
- phase transition
- puzzle answer judgment
- scheduled messages
- 共有 env（`NEXT_PUBLIC_*`）・LINE 配信 / LIFF / Stripe / consent / 招待リンク

---

## 動作確認 curl 例

> API キーは環境変数やプロンプトで受け取り、**実値をコマンド履歴/ログに残さない**こと（例では `read -rs` を使用）。

```bash
BASE=https://app.whale-studio.app
read -rs KEY; echo   # ← Production の x-whale-api-key を貼付（画面非表示）→ Enter

# 正常系（200）: allowlist 内 active 作品一覧
curl -s -H "x-whale-api-key: $KEY" "$BASE/api/external/v1/works" | jq

# フェーズ一覧 / リンク（WORK_ID は上の結果から）
WID=<WORK_ID>
curl -s -H "x-whale-api-key: $KEY" "$BASE/api/external/v1/works/$WID/phases" | jq
curl -s -H "x-whale-api-key: $KEY" "$BASE/api/external/v1/works/$WID/phase-links" | jq '.data.links'

unset KEY
```

write 例 — read とは **別キー**（`WHALE_EXTERNAL_WRITE_API_KEY`）を使う:

```bash
BASE=https://app.whale-studio.app
read -rs WKEY; echo   # ← Production の WHALE_EXTERNAL_WRITE_API_KEY を貼付（画面非表示）→ Enter

# [v1 legacy] 既存クライアント向け（reservationNumber 必須 / 任意 ticketId）。契約・挙動は据え置き。
curl -s -X POST "$BASE/api/external/v1/live/ticket-links" \
  -H "x-whale-api-key: ${WKEY}" -H "content-type: application/json" \
  -d '{"workId":"<WORK_ID>","reservationNumber":"<RESERVATION_NUMBER>","ticketId":"<TICKET_ID>"}' | jq

# [v2] ① 公演セッションを同期（匿名 externalSessionRef。氏名/メール等は送らない）
curl -s -X PUT "$BASE/api/external/v2/live/sessions" \
  -H "x-whale-api-key: ${WKEY}" -H "content-type: application/json" \
  -d '{"workId":"<WORK_ID>","externalSessionRef":"uzu-session-20260817-1800","startsAt":"2026-08-17T18:00:00+09:00","endsAt":"2026-08-17T21:00:00+09:00"}' | jq

# [v2] ② 匿名予約枠の専用 LIFF URL を発行（capacity は 2 / 4 のみ）
curl -s -X POST "$BASE/api/external/v2/live/ticket-links" \
  -H "x-whale-api-key: ${WKEY}" -H "content-type: application/json" \
  -d '{"workId":"<WORK_ID>","externalSessionRef":"uzu-session-20260817-1800","externalBookingRef":"uzu-booking-01JXYZ","capacity":4}' | jq
# → 200: { "success": true, "data": { "externalSessionRef": "...", "externalBookingRef": "...", "url": "https://liff.line.me/<liffId>/ticket?t=<token>", "expiresAt": "..." } }
#   （v2 は内部主キー tokenRecordId / LiveSession.id 等を返さない。以後の操作は externalSessionRef / externalBookingRef で行う）

# [v2] ③ 状態取得（read キー） / ④ 失効（write キー・冪等）
curl -s -H "x-whale-api-key: $KEY" "$BASE/api/external/v2/live/ticket-links?workId=<WORK_ID>&externalSessionRef=uzu-session-20260817-1800&externalBookingRef=uzu-booking-01JXYZ" | jq '.data.link'
curl -s -X POST "$BASE/api/external/v2/live/ticket-links/revoke" \
  -H "x-whale-api-key: ${WKEY}" -H "content-type: application/json" \
  -d '{"workId":"<WORK_ID>","externalSessionRef":"uzu-session-20260817-1800","externalBookingRef":"uzu-booking-01JXYZ"}' | jq

# v2 は個人情報フィールド（reservationNumber/ticketId/email 等）を含めると 400 / read キーで write は 401 / write キー未設定なら 503
unset WKEY
```

認証・スコープ別:

```bash
BASE=https://app.whale-studio.app

# no header → 401
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/external/v1/works"

# wrong key → 401
curl -s -o /dev/null -w "%{http_code}\n" -H "x-whale-api-key: wrong-key" "$BASE/api/external/v1/works"

# missing / allowlist 外 workId → 404（要・正しいキー）
# curl -s -o /dev/null -w "%{http_code}\n" -H "x-whale-api-key: $KEY" \
#   "$BASE/api/external/v1/works/00000000-0000-0000-0000-000000000000/phases"
```

| ケース | 期待 |
|---|---|
| 正しいキー・allowlist 内・active | 200 |
| ヘッダーなし | 401 |
| キー不一致 | 401 |
| 不在 / allowlist 外 / 非 active の workId | 404 |
| そのデプロイに `WHALE_EXTERNAL_API_KEY` 未反映 | 503（→ fresh deploy が必要なサイン） |

---

## v1 legacy チケットリンク API

`POST /api/external/v1/live/ticket-links` は既存クライアント向けの **legacy 契約**。現行 `origin/main` と**同一の契約・挙動を維持**する（本 PR で変更しない）。

- Request: `{ "workId": "<WORK_ID>", "reservationNumber": "<予約番号>", "ticketId": "<任意>", "expiresInDays": <任意> }`
- Response: `{ "success": true, "data": { "url": "https://liff.line.me/<liffId>/ticket?t=<token>", "tokenRecordId": "...", "expiresAt": "..." } }`
- `reservationNumber` を CSV 由来の `LiveTeam.reservationNumber` と突合する既存モデル。再送は同一 `reservationNumber` の旧・有効トークンを失効してから新規発行。
- **新規のウズプロCMS 連携では使用しない**（v2 を使用）。
- 将来 v1 を廃止する場合も、**別途告知・移行期間を設けてから**行う（本 PR に廃止予定は含まない）。v1 と v2 は request/response schema を共有しない。

---

## プロダクト境界（NATIVE / UZU_PRO）と内部ID 非公開

Whale Studio Live の**低レベルな実行機構**（LiveSession / LiveTeam / LiveTicketLinkToken / LiveParticipant、トークン発行・LIFF・LINE 認証・定員ロック・参加登録）は **2 つのプロダクトで共有**される。両者はレコード単位の `origin` 判別子で明確に分離する:

| origin | プロダクト | 作成経路 | System of Record (SoR) |
|---|---|---|---|
| `NATIVE` | **LIVE for Whale Studio** | native Live 管理 API/UI（`/api/oas/[id]/live/*`） | Whale Studio |
| `UZU_PRO` | **for UZU Pro** | external v2 API（`/api/external/v2/live/*`） | **UZU Pro CMS** |

境界ルール:
- **同一 LINE 公式アカウント（OA）が両方を併用できる**。origin は OA 単位ではなく**実行レコード単位**で由来を明示する（OA を片方へ固定しない）。
- **origin はクライアントから指定できない**。native 作成 = `NATIVE`、external v2 作成 = `UZU_PRO` に API 層で固定し、子（Team/Token/Participant）は親 Session / 発行 token の origin を継承する。`externalSessionRef` 等の有無で origin を推測しない（origin が正本）。
- **native Live 管理 API/UI は `origin=NATIVE` のみを扱う**。UZU_PRO 由来レコードは一覧・詳細・更新・削除・export・actor・子リソースのいずれからも**存在を露出せず 404 相当**（条件 = `oaId 一致 かつ origin=NATIVE`）。Whale Studio の native Live 管理画面を UZU Pro の予約 UI にはしない。
- **external v2 API は `origin=UZU_PRO` のみを扱う**。NATIVE の取得/更新/Team 作成/token 失効はできず、`externalSessionRef`/`externalBookingRef` が偶然一致しても origin を跨いで操作しない（tripwire で境界違反を拒否）。
- UZU_PRO レコードは通常の Live 管理画面に表示しない（プラットフォーム管理者限定の read-only 監視画面は将来の可能性・本 PR では新設しない）。

### 内部ID 非公開と origin 境界

external v2 の**レスポンスは内部主キーを一切返さない**（`LiveSession.id` / `LiveTeam.id` / `LiveParticipant.id` / `LiveTicketLinkToken.id` / `tokenRecordId`）。外部契約で用いる識別子は**匿名参照のみ**: `externalSessionRef` / `externalBookingRef` / `externalPlayerRef`。UZU Pro CMS は自身が正本として持つこれらの参照で全操作を行う。

## v2 匿名連携（ウズプロCMS）Live API

**ウズプロCMS が利用する正式 API**。ウズプロCMS を予約・個人情報の正本とし、Whale Studio へは **匿名参照ID のみ**を渡して LIFF URL / トークンを扱う。氏名・メール・チケットID 等の個人情報は Whale Studio に送信・保存しない。

### 用語

| 語 | 意味 |
|---|---|
| `externalSessionRef` | ウズプロCMS が生成する**匿名の公演参照**（安定 ID）。例: `uzu-session-20260817-1800`。個人情報ではない。 |
| `externalBookingRef` | ウズプロCMS が生成する**匿名の予約枠参照**（安定 ID）。例: `uzu-booking-01JXYZ`。個人情報ではない。 |
| `capacity` | 予約枠の定員。**初期対応は `2` / `4` のみ許可**（他値は 400）。正本は `capacity`（`groupType` 互換 2→two/4→four も併記）。 |

> ⚠️ 以下は **送信してはいけない**（strict schema で未知フィールドは 400 拒否）: `purchaserName` / `name` / `email` / `ticketId` / `reservationNumber` / `purchasedAt` / `ticketType` / 電話番号 / 住所 等の個人情報。

### PUT /api/external/v2/live/sessions（公演セッション冪等 upsert）

```json
{ "workId": "<WORK_ID>", "externalSessionRef": "uzu-session-20260817-1800",
  "startsAt": "2026-08-17T18:00:00+09:00", "endsAt": "2026-08-17T21:00:00+09:00" }
```
- キー `(oaId, workId, externalSessionRef)` で冪等 upsert。初回 `status=draft`。
- 再送は**日時のみ更新**し status は据え置き（active→draft 降格 / ended 再オープンをしない）。
- レスポンス: `{ "success": true, "data": { "session": { "externalSessionRef", "status", "startsAt", "endsAt" } } }`。**内部主キー `LiveSession.id` は返さない**（外部契約は `externalSessionRef` のみ・[内部ID 非公開](#内部id-非公開と-origin-境界)）。

### POST /api/external/v2/live/ticket-links（発行）

```json
{ "workId": "<WORK_ID>", "externalSessionRef": "uzu-session-20260817-1800",
  "externalBookingRef": "uzu-booking-01JXYZ", "capacity": 4 }
```
- 事前に PUT /sessions で公演セッションを同期しておくこと（未同期は **409**）。
- 1 トランザクションで「匿名 LiveTeam を upsert（個人情報なし）→ 同一予約枠の旧・有効トークンを失効 → 新トークン発行」。
- **再送すると旧 URL は失効し、常に最新 1 件だけが有効**。ウズプロCMS は**返却された最新 URL を正本として保存**すること。
- レスポンス: `{ "success": true, "data": { "externalSessionRef": "...", "externalBookingRef": "...", "url": "https://liff.line.me/<liffId>/ticket?t=<token>", "expiresAt": "..." } }`。**内部主キー（`tokenRecordId` / `LiveTeam.id` / `LiveSession.id`）は返さない**（外部契約は匿名参照のみ・[内部ID 非公開](#内部id-非公開と-origin-境界)）。
- **平文 URL / トークンはログ・一般公開領域へ出さない**（DB は tokenHash のみ・レスポンスに一度だけ載る）。

### GET /api/external/v2/live/ticket-links（状態取得）

`?workId=...&externalSessionRef=...&externalBookingRef=...`

```json
{ "success": true, "data": { "link": {
  "externalSessionRef": "uzu-session-20260817-1800", "externalBookingRef": "uzu-booking-01JXYZ",
  "state": "active", "expiresAt": "2026-08-20T09:00:00.000Z",
  "capacity": 4, "registrationCount": 0, "sessionStatus": "draft" } } }
```
- `state`: `active` / `revoked` / `expired`（有効トークンが無ければ最新履歴から判定）。
- `registrationCount` は対象 team の LiveParticipant 数（登録実装は後続 Phase。現状は通常 0）。
- **平文トークン / tokenHash / LINE UID / 氏名 / メール / ESCAPE.ID チケットID は返さない。**

### POST /api/external/v2/live/ticket-links/revoke（失効）

```json
{ "workId": "<WORK_ID>", "externalSessionRef": "uzu-session-20260817-1800", "externalBookingRef": "uzu-booking-01JXYZ" }
```
- 対象予約枠の有効トークンをすべて失効（**冪等** — 既に失効済みでも 200。`revokedAt` は上書きせず履歴を保持）。
- `oaId` / `workId` を条件に含め、**別 OA・別 work のトークンは失効できない**。LiveTeam / LiveSession / LiveParticipant は削除しない。

### LIFF resolve の解決順（新旧互換）

`/api/liff/tickets/resolve` は、トークンに `liveSessionId` / `teamId` があれば**それを直接解決**（整合性検証: team↔session 一致・oaId 一致・workId 矛盾なし）。無い**旧トークン（#588/#589）のみ** 従来の `reservationNumber` / `ticketId` 照合にフォールバックする。匿名 team は `reservationNumber=null` でも解決可能。resolve は従来どおり**表示専用**（LINE 認証・参加登録はしない）。

---

## 変更履歴

| PR | 内容 |
|---|---|
| **#574** | 外部連携 API 新設（`/works`・`/phases`・`/phase-links`）。`x-whale-api-key` 認証 + `WHALE_EXTERNAL_OA_IDS` allowlist（fail closed）。読み取り専用・DB migration なし。 |
| **#575** | links を canonical `https://app.whale-studio.app` に統一。専用 env `WHALE_EXTERNAL_PUBLIC_BASE_URL`（未設定時 canonical）を導入し、共有 `NEXT_PUBLIC_*` から切り離し。 |
| **匿名連携 Phase 1（v2）** | ウズプロCMS↔Whale Studio の責務境界に沿い、匿名参照（`externalSessionRef` / `externalBookingRef`）+ `capacity` ベースの Live API を **v2 として新設**（PUT `/api/external/v2/live/sessions`、POST/GET `/api/external/v2/live/ticket-links`、POST `/api/external/v2/live/ticket-links/revoke`）。**v1 `POST /live/ticket-links` は現行契約のまま不変**（破壊的変更なし）。v1/v2 は schema 非共有。additive migration（`external_session_ref` / `external_booking_ref` / `capacity` + 索引）。resolve は token の `liveSessionId`/`teamId` 優先・legacy fallback 維持（v1/v2 で分けない）。LINE 認証 / 参加登録 / CMS Webhook は未実装（後続 Phase）。 |
| **origin 判別子（NATIVE / UZU_PRO）** | Live 実行レコード（LiveSession/LiveTeam/LiveTicketLinkToken/LiveParticipant）に `origin LiveOrigin @default(NATIVE)` を additive 追加。native Live 管理 API（16 経路）は `origin=NATIVE` を条件に含め UZU_PRO を 404 相当に、external v2 は全クエリ/書込で `origin=UZU_PRO` を明示。子は親/token の origin を継承（LIFF resolve/link は両 origin を処理し解決 token の origin を Participant に継承）。external v2 レスポンスから内部主キー（`LiveSession.id`/`LiveTeam.id`/`LiveParticipant.id`/`tokenRecordId`）を除去。既存行は default で NATIVE（backfill SQL なし）。破壊的変更・本番 migration・deploy は含まない。 |
