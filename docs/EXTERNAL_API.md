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
| POST | `/api/external/v1/live/ticket-links` | Live ticket-link **mint**（予約完了メール用の専用 LIFF URL 発行） | `WHALE_EXTERNAL_WRITE_API_KEY`（write） |

> mint（write）はヘッダー名こそ `x-whale-api-key` だが照合先が **read と別の env**。詳細は下記「認証 →（write API 認証）」を参照。

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

### write API 認証（`POST /api/external/v1/live/ticket-links` = Live ticket-link mint）

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

write（mint）例 — read とは **別キー**（`WHALE_EXTERNAL_WRITE_API_KEY`）を使う:

```bash
BASE=https://app.whale-studio.app
read -rs WKEY; echo   # ← Production の WHALE_EXTERNAL_WRITE_API_KEY を貼付（画面非表示）→ Enter

# 予約完了メール用の専用 LIFF URL を発行（body は実装準拠: workId / reservationNumber 必須, ticketId / expiresInDays 任意）
curl -s -X POST "$BASE/api/external/v1/live/ticket-links" \
  -H "x-whale-api-key: ${WKEY}" \
  -H "content-type: application/json" \
  -d '{"workId":"<WORK_ID>","reservationNumber":"<RESERVATION_NUMBER>","ticketId":"<TICKET_ID>"}' | jq
# → 200: { "success": true, "data": { "url": "https://liff.line.me/<liffId>/ticket?t=<token>", "tokenRecordId": "...", "expiresAt": "..." } }

# read キー（$KEY）では mint は 401 / write キー未設定なら 503
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

## 変更履歴

| PR | 内容 |
|---|---|
| **#574** | 外部連携 API 新設（`/works`・`/phases`・`/phase-links`）。`x-whale-api-key` 認証 + `WHALE_EXTERNAL_OA_IDS` allowlist（fail closed）。読み取り専用・DB migration なし。 |
| **#575** | links を canonical `https://app.whale-studio.app` に統一。専用 env `WHALE_EXTERNAL_PUBLIC_BASE_URL`（未設定時 canonical）を導入し、共有 `NEXT_PUBLIC_*` から切り離し。 |
