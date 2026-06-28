# Supabase 本番DBリージョン移行手順書 — Sydney → Tokyo

## 目的

Whale Studio の本番 Supabase project を Sydney (`ap-southeast-2`) から Tokyo (`ap-northeast-1`) へ移行する。
日本国内ユーザーが中心のため、エンドユーザーからの API レイテンシを下げ、Vercel (リージョン: `hnd1` 設定予定) との通信距離を短くする。

> Supabase は既存 project のリージョンを直接変更できない。**新規 project を Tokyo に作成 → DB / Auth / Storage をすべて移植 → 環境変数を切り替え → 旧 project を最終削除** の流れで行う。

> ⚠️ **post-incident 訂正サマリ（本手順書の旧版の誤りを反映済み）**
> 移行後の本番障害対応で判明した正値を先に明記する。本文中の古い記述より以下を優先すること:
> - **Vercel runtime の `DATABASE_URL` は Transaction Pooler (port `6543`) を使う**。direct/Session Pooler の `5432` を runtime に使うと `EMAXCONNSESSION` で本番が落ちる（migrate 用途とは別）。
> - 正しい host は **`aws-1-ap-northeast-1.pooler.supabase.com`**（`aws-0` ではない）。fleet 接頭辞・region は Supabase Connect → Transaction pooler の表示値をそのままコピーする。誤ると `tenant/user ... not found` になる。
> - runtime URL には **`?pgbouncer=true&connection_limit=1&pool_timeout=30`** を必ず付与。
> - env 変更の反映は Vercel Dashboard の **Redeploy ではなく fresh deploy（空コミット push）**で行う（Redeploy は旧 env snapshot を再利用し反映されないことがある）。
> - 詳細・正準ルールは `CLAUDE.md` の「Connection strategy」を参照。

---

## 現状

| 項目 | 値 |
|---|---|
| 旧 project リージョン | Sydney / `ap-southeast-2` |
| 新 project リージョン | Tokyo / `ap-northeast-1` |
| Postgres バージョン | 旧 project と一致させる (Supabase Dashboard で確認) |
| 接続方法 | `DATABASE_URL` 経由(Prisma)+ `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`(クライアント / サーバー SDK) |

### コード調査結果

- 環境変数のハードコードは **なし**(README プレースホルダーと test stub のみ)
- `vercel.json` は移行後に **追加済み**(`{ "regions": ["hnd1"] }` = Tokyo function region 固定 + scheduled-messages cron を登録)。本手順書作成時点では存在しなかった。
- GitHub Actions は Slack 通知 1 つだけで、DB / Supabase には接続していない
- Prisma migration は PostgreSQL 専用 (`prisma/migrations/migration_lock.toml` で `provider = "postgresql"` 固定)
- Supabase Storage の bucket `image` を `/api/upload/storage` ルートで使用(LIFF 画像は Cloudinary 経由なので別)

---

## 影響範囲

| カテゴリ | 対象 | 内容 |
|---|---|---|
| DB | Prisma 経由の全テーブル | データ移行が必須。LIFF / 作品 / メッセージ / フェーズ / ユーザー進捗 / locations / checkin / LiffSurveyResponse / LiffPageConfig など全テーブル |
| Auth | Supabase Auth users / sessions | 旧 project の auth.users を新 project に移行。既存セッション cookie は失効(ユーザー再ログインが必要) |
| Storage | bucket `image`(public) | bucket 内の全オブジェクトを移行 |
| 外部連携 | LINE Messaging API webhook | webhook URL は Vercel 上のため Supabase 移行に影響なし。ただし Vercel ENV の `NEXT_PUBLIC_SUPABASE_URL` を切り替えるタイミングで一瞬 5xx になる可能性あり |
| 外部連携 | LIFF endpoint URL | 同上 |
| 外部連携 | Cloudinary | Supabase に依存しないため影響なし |

### 環境変数(リポジトリ調査済み一覧)

| 変数名 | 用途 | クライアント露出 |
|---|---|---|
| `DATABASE_URL` | Prisma → Supabase PostgreSQL | ❌ サーバーのみ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase SDK のエンドポイント | ✅ ブラウザにも出る |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase SDK anon キー | ✅ ブラウザにも出る |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage アップロード(RLS bypass) | ❌ サーバーのみ |

**使われていない**(コード調査で確認):
- `DIRECT_URL` — Prisma の non-pooled 接続用。Supabase の pooler 経由で migrate するなら追加検討すべきだが現状無し。
- `SUPABASE_JWT_SECRET` — JWT を手動検証する場面がないため未使用。

---

## 事前バックアップ

旧 Sydney project を **削除する前** に、以下を必ず手元に保存しておく。

```bash
# 旧 project の Database タブから接続情報を取得 (Pooler ではなく Direct connection を使う)
OLD_DB_URL="postgresql://postgres.<OLD_REF>:<PWD>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"

# 1) スキーマ + データのフルダンプ
pg_dump --no-owner --no-acl --clean --if-exists \
  --exclude-schema='supabase_*' \
  --exclude-schema='pgsodium*' \
  --exclude-schema='vault' \
  --exclude-schema='realtime' \
  --exclude-schema='_realtime' \
  --exclude-schema='extensions' \
  --exclude-schema='graphql*' \
  --exclude-schema='net' \
  --exclude-schema='pgbouncer' \
  --exclude-schema='storage' \
  -d "$OLD_DB_URL" \
  -f backup_old_$(date +%Y%m%d_%H%M%S).sql

# 2) auth スキーマ単独ダンプ (ユーザー移行用)
pg_dump --no-owner --no-acl --schema=auth \
  -d "$OLD_DB_URL" \
  -f backup_auth_$(date +%Y%m%d_%H%M%S).sql

# 3) storage スキーマ + bucket メタダンプ
pg_dump --no-owner --no-acl --schema=storage \
  -d "$OLD_DB_URL" \
  -f backup_storage_meta_$(date +%Y%m%d_%H%M%S).sql
```

>  ⚠️ Supabase 管理スキーマ(`auth` / `storage` / `realtime` 等)は通常 `pg_dump` のフル出力に含めると restore で衝突する。**`public` だけのデータダンプ + `auth` 単独ダンプ** を分ける方が確実。

>  Supabase CLI を使うなら `supabase db dump --db-url "$OLD_DB_URL" -f backup.sql` でも同等の安全ダンプが取れる。

### Storage オブジェクトの取り出し

bucket `image` の中身は Supabase Storage Mover(beta)か、`supabase storage cp` または curl 経由でローカルへダウンロードしてから新 project に再アップロードする。

```bash
# Supabase CLI v2 系の例 (要 supabase login)
supabase storage download --project-ref <OLD_REF> --recursive image ./storage_backup/
```

---

## メンテナンス中に止めるべきもの

DB / Auth を切り替える間(15〜30分想定)、以下を一時停止する:

1. **LINE Messaging API の webhook URL を一時的に「無効化(空文字)」にする**(Messaging API console)
   - これで友だち送信メッセージは到達せず、後で再開できる
   - 送信側がリトライしないため、一部メッセージは取りこぼし。事前周知すべし
2. **LIFF の Endpoint URL は変更不要**(Vercel のまま)。ただし切替中は LIFF 内 API が 5xx になる可能性あり
3. **Vercel 上の本番デプロイを stop しない**(Preview は維持) — auth は無効化中だが、画面表示は動かしておいたほうが運用しやすい
4. 管理画面ユーザーには「メンテ中ログアウトされます」を Slack / 社内通知

---

## DB dump / restore コマンド例(本番未実行)

### ステップ A: 新 project を Tokyo に作成

1. Supabase Dashboard → Organizations → 該当 org → **New project**
2. Region = **Northeast Asia (Tokyo)** / `ap-northeast-1`
3. Postgres version を旧 project と揃える
4. Database password を強いものに設定(=後の `DATABASE_URL` の `<PWD>` 部分)
5. 作成完了後、project ref(`xxxxxxxxxxxxxxxxxxxx`)と各キーをメモ:
   - `NEXT_PUBLIC_SUPABASE_URL`(= `https://<NEW_REF>.supabase.co`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL`(Settings → Database → Connection string → URI)

### ステップ B: 新 project に Prisma migration を当てる(空 DB に対して)

Whale Studio は Prisma で migration を管理しているので、最も安全なのは **`prisma migrate deploy`**(SQL dump の public スキーマを直接 restore するのではなく)。理由:

- 旧 project にも同じ migration が当たっているはず → スキーマは一致する
- `prisma migrate deploy` は `_prisma_migrations` 履歴を正しく初期化する
- 後で migration を追加するときに整合性を保てる

```bash
# 新 project の Session Pooler URL を一時的に env にセット（migrate 用途・port 5432）
# host は Connect → Session pooler の値。fleet は aws-1（aws-0 ではない）。この URL は Vercel runtime には使わない。
export DATABASE_URL="postgresql://postgres.<NEW_REF>:<PWD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

# migration を順次適用
npx prisma migrate deploy

# Prisma client 再生成 (確認用)
npx prisma generate
```

> ⚠️ Vercel の本番 `DATABASE_URL` はまだ切り替えない(後段で行う)。上記は移行作業者のローカル環境変数のみ書き換える。

### ステップ C: 新 project にデータを流し込む

Prisma migration でスキーマだけ作った後、**データ部分だけ** を旧 project から流し込む。

```bash
# 旧 project から「public スキーマ・データのみ」をダンプ
OLD_DB_URL="postgresql://postgres.<OLD_REF>:<PWD>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
pg_dump --data-only --no-owner --no-acl \
  --schema=public \
  --disable-triggers \
  -d "$OLD_DB_URL" \
  -f data_only.sql

# 新 project に restore（一括 restore 用途・Session Pooler 5432。fleet は aws-1）
NEW_DB_URL="postgresql://postgres.<NEW_REF>:<PWD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
psql -d "$NEW_DB_URL" -f data_only.sql
```

> 万一 FK 違反で止まったら、`SET session_replication_role = 'replica';` を SQL の冒頭に挟むと triggers/constraints を一時停止できる。restore 後に `replica` → `origin` に戻す。

### ステップ D: Auth users を移行

Supabase Auth users の移行は **Dashboard の Migration tool(プレビュー)** か、**`auth` スキーマの一部テーブルだけを手動 copy** で行う。

```bash
# 旧 project から auth.users と auth.identities を export
pg_dump --no-owner --no-acl \
  --table=auth.users \
  --table=auth.identities \
  --data-only \
  -d "$OLD_DB_URL" \
  -f auth_users.sql

# 新 project に restore (auth スキーマがすでに supabase 内部で作られているため、--data-only で OK)
psql -d "$NEW_DB_URL" -f auth_users.sql
```

> ⚠️ users テーブルには `encrypted_password` がハッシュ込みで入っているが、Supabase は同じ project 内のシークレット(JWT secret)で署名検証するため、**新 project では既存のセッション cookie は無効化される**。ユーザーは再ログインが必要。これは事前周知必須。

> ⚠️ OAuth (Google / GitHub) を使っている場合、新 project 側に Provider 設定を **手動で再設定** する必要あり。auth スキーマには ID と email しか残らない。

### ステップ E: Storage オブジェクトを再アップロード

```bash
# 旧 project の bucket image から全オブジェクトをダウンロード
supabase storage download --project-ref <OLD_REF> --recursive image ./storage_backup/

# 新 project に bucket "image" を作成 (Dashboard → Storage → New bucket、public bucket、RLS policy を旧と揃える)
# その後アップロード
supabase storage upload --project-ref <NEW_REF> --recursive ./storage_backup/ image/
```

> 確認: 旧 project の Storage Policy を Dashboard SQL で出力 → 新 project にも同じ policy を貼る:
> ```sql
> SELECT * FROM storage.objects LIMIT 1;
> SELECT * FROM pg_policies WHERE schemaname = 'storage';
> ```

---

## Auth で手動コピーが必要なもの

| 項目 | 場所 | 対応 |
|---|---|---|
| Email template | Dashboard → Authentication → Email Templates | 旧 project の各種テンプレートをコピーして新 project に貼り直し |
| Auth providers (OAuth) | Dashboard → Authentication → Providers | Google / GitHub などの client_id / secret を **再登録**(provider 側のリダイレクト URI も新 ref に変更が必要) |
| Site URL / Redirect URLs | Dashboard → Authentication → URL Configuration | `https://whale-studio.vercel.app`(本番)、Vercel Preview のワイルドカード、開発用 `http://localhost:3000` を再登録 |
| JWT settings | Dashboard → Authentication → Sessions | 旧 project と JWT 有効期限 / refresh policy を揃える |
| SMTP 設定 | Dashboard → Project Settings → Auth → SMTP | カスタム SMTP を使っていれば再設定 |

---

## Storage の確認事項

| 項目 | 確認内容 |
|---|---|
| bucket 名 | `image`(コード上ハードコード)。新 project でも同名で作成 |
| public / private | 旧 project と一致させる(現状: public) |
| RLS policy | `pg_policies WHERE schemaname='storage'` で旧 policy を SQL で出力し、新側にも適用 |
| CORS | Dashboard → Storage → Configuration の CORS allowlist を旧と揃える(本番ドメイン + Vercel Preview + localhost) |
| 既存 public URL | コード内で保存済みのオブジェクト URL(`message.body` 等の JSON 内)は **旧 project の host を含む**。新 project に切り替えると 404 になる。後述の「ロールバック手順」参照 |

> ⚠️ DB に保存された Storage 公開 URL のホスト書き換えが必要。下記 SQL の dry run で件数を確認:
> ```sql
> SELECT COUNT(*) FROM messages WHERE body::text LIKE '%<OLD_REF>.supabase.co%';
> ```

---

## Vercel 環境変数の差し替え項目

Vercel Dashboard → Project Settings → Environment Variables(Production / Preview それぞれ):

| 変数 | 旧値 | 新値 |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.<OLD_REF>:<PWD>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres` (旧 Sydney) | **Transaction Pooler 6543**: `postgresql://postgres.<NEW_REF>:<PWD>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=30`（⚠️ direct/Session の 5432 を runtime に使わない。host fleet は `aws-1`） |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<OLD_REF>.supabase.co` | `https://<NEW_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 旧 anon key | 新 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 旧 service-role key | 新 service-role key |

> ⚠️ `NEXT_PUBLIC_*` は **ビルド時に bundle に焼き付く**。値を差し替えたら **fresh deploy（空コミット push）で反映**する。
> ⚠️ env 反映に **Vercel Dashboard の Redeploy は使わない**: Redeploy は直前デプロイの **env snapshot を再利用**するため、更新した `DATABASE_URL` / `NEXT_PUBLIC_*` が反映されないことがある（実際に発生）。新しいコミットによる fresh deploy が確実。

> 推奨: 先に新 project の値を Preview env に設定 → Preview ブランチで E2E 確認 → Production に同値を反映 → **空コミット push で Production を fresh deploy**。

---

## 動作確認リスト

切替後、以下を本番環境で確認:

### A. 管理画面
- [ ] `/login` ページで Supabase Auth ログインができる
- [ ] ログイン後 `/oas` 一覧が表示される
- [ ] OA 作成・編集・削除が動く
- [ ] 作品作成 / 編集 / メッセージ編集 / フェーズ編集が DB に保存される
- [ ] `/oas/[id]/settings/members` でメンバー一覧が出る
- [ ] `/oas/[id]/works/[workId]/liff` で複数 LIFF ページ一覧が出る
- [ ] LIFF 編集画面で画像アップロード(`/api/upload` Cloudinary)が動く
- [ ] キャラクター作成・編集で画像アップロード(Supabase Storage)が動く
- [ ] フィードバック送信(GAS Webhook)に変化なし

### B. LIFF / LINE
- [ ] LINE Messaging API webhook URL を Messaging API console に再設定し、テスト OA でメッセージ受信
- [ ] テスト OA に friendship → 初回応答が来る
- [ ] LIFF プレイヤー (`/liff/work/[workId]/pages/[liffPageId]`) が表示される
- [ ] LIFF Survey 送信が `liff_survey_responses` テーブルに保存される
- [ ] LIFF Location 履歴が表示される
- [ ] GPS / QR チェックインが `location_visits` テーブルに記録される(`/api/liff/checkin`)
- [ ] Beacon webhook(`/api/internal/beacon`)が動く

### C. Storage
- [ ] キャラクターアイコンアップロードで新 bucket に保存される
- [ ] アップロード後、画面プレビューに即時反映される
- [ ] **旧 URL を持つ既存データ** が表示されないことを確認(対応は後述「DB URL 書き換え」)

### D. パフォーマンス
- [ ] 管理画面の API レイテンシが Sydney 時より下がっている(Network タブで確認、目安 100ms 以上短縮)

---

## DB 保存済みの旧 Storage URL 書き換え

旧 bucket URL が DB のメッセージ JSON 等に残っていると、新 project 切替後に画像が 404 になる。以下を実施:

```sql
-- 1) 件数確認 (本番に対して dry run)
SELECT
  COUNT(*) AS messages_with_old_url
FROM messages
WHERE body::text LIKE '%<OLD_REF>.supabase.co%';

-- 2) 一括書き換え (慎重に。トランザクション内で行う)
BEGIN;
UPDATE messages
SET body = REPLACE(body::text, '<OLD_REF>.supabase.co', '<NEW_REF>.supabase.co')::jsonb
WHERE body::text LIKE '%<OLD_REF>.supabase.co%';
-- 確認後
COMMIT;
-- 問題があれば
-- ROLLBACK;
```

> ✅ 影響範囲は `messages.body` JSON が中心。他に `characters.icon_image_url` / `locations.description` などに保存されている可能性がある場合は `pg_grep` 風に各テーブル確認:
> ```sql
> SELECT table_name FROM information_schema.columns
> WHERE data_type IN ('text','jsonb','json')
>   AND table_schema='public';
> ```

---

## ロールバック手順

### 切替後 30 分以内に問題発覚した場合
1. Vercel の Production env を **旧** Supabase 値に戻して Redeploy(=Vercel Dashboard で Promote a previous deployment)
2. LINE Messaging API webhook URL を元に戻す(変更していない場合は不要)
3. **旧 project には書き込みを継続していた可能性があるか** を確認 → ある場合は新 → 旧 で差分マージが必要(=切替時間内は旧 project にも書き込みが届かないよう、ステップ A の作業前に「メンテナンス画面」または「LINE webhook 無効化」で書き込み停止しておくのが理想)

### 切替後数日経って問題発覚した場合
- 旧 project を **削除せず保持** している前提(下記チェックリスト参照)
- 新 project で発生した差分データを `pg_dump --data-only` で抽出して旧 project に restore → 旧 project に戻す
- Auth users の追加分も手動でマージ

---

## 旧 Supabase project を削除する前のチェックリスト

最低 **1 週間** は旧 project を保持しておく。削除前に:

- [ ] 新 project で 7 日間問題なく運用できている
- [ ] 上記「動作確認リスト」が全項目 PASS
- [ ] DB の row count が新旧で一致(主要テーブルだけでも):
  ```sql
  SELECT
    (SELECT COUNT(*) FROM oas) AS oas,
    (SELECT COUNT(*) FROM works) AS works,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COUNT(*) FROM phases) AS phases,
    (SELECT COUNT(*) FROM characters) AS characters,
    (SELECT COUNT(*) FROM liff_page_configs) AS liff_pages,
    (SELECT COUNT(*) FROM liff_page_blocks) AS liff_blocks,
    (SELECT COUNT(*) FROM location_visits) AS visits,
    (SELECT COUNT(*) FROM checkin_attempts) AS attempts,
    (SELECT COUNT(*) FROM liff_survey_responses) AS surveys;
  ```
- [ ] Storage bucket `image` のオブジェクト数が新旧で一致
- [ ] DB の旧 Storage URL 書き換えが完了している(該当データなし or 全件更新済み)
- [ ] バックアップ SQL ダンプ(public + auth + storage 三種)をローカル + 外部ストレージ(Google Drive など)に保存済み
- [ ] 旧 project の DB password を再生成しておく(誤書き込み防止)
- [ ] Supabase 課金が新 project に切り替わっているか確認(billing)
- [ ] 上記すべて OK の場合のみ Dashboard → Project Settings → General → **Pause project**(まずは pause、削除は更に 1 ヶ月後)

---

## 実際に移行するときの作業順序(人間が実行)

> ⚠️ 本リポジトリ上の `docs/SUPABASE_REGION_MIGRATION_TOKYO` PR では **手順書の作成のみ**。以下は実際に作業する人間が手動で実行する手順。

### Day 0 (前日まで)
1. **新 project を Tokyo に作成**(ステップ A)— DB / Auth キーをメモ
2. **新 project に Prisma migration を流す**(ステップ B、ローカル env のみで)
3. **新 project の Auth providers / Email templates / SMTP / Redirect URLs を旧から手動コピー**
4. **新 project の Storage bucket `image` を作成 + Policy / CORS を旧と揃える**
5. **影響範囲チェック**: DB に旧 Storage URL がある件数を `LIKE` で確認
6. **メンテナンスウィンドウを社内通知**(=ユーザーが再ログインを要求される旨も)

### Day 1 (本番切替日、推奨は深夜 1〜2 時)
7. **LINE Messaging API webhook URL を一時的に空にする**(=書き込み停止)
8. **旧 project から最新 dump を取得**(ステップ A のバックアップ + ステップ C のデータダンプ)
9. **新 project にデータ流し込み**(ステップ C)
10. **新 project に Auth users を流し込み**(ステップ D)
11. **Storage オブジェクトを新 bucket に再アップロード**(ステップ E)
12. **DB 内の旧 Storage URL を新 URL に書き換え**
13. **Vercel 環境変数を新 project の値に差し替え + fresh deploy（空コミット push）**(Production)。Dashboard の Redeploy は env snapshot を再利用するため使わない。`DATABASE_URL` は Transaction Pooler 6543 / `aws-1-ap-northeast-1` を使用
14. **LINE Messaging API webhook URL を再設定**(URL は同じだが Save し直して webhook 検証を再走らせる)
15. **動作確認リストを順に PASS**

### Day 1 + 7
16. データ件数突合 + 1 週間運用問題なし → 旧 project を **Pause** にする

### Day 1 + 30 (1 ヶ月後)
17. 完全に旧 project を **Delete** する

---

## 未実施事項(本 PR では実行していない)

- 本番 DB への書き込み / dump / restore
- Vercel 環境変数の更新
- Vercel 本番 Redeploy
- 新 Supabase project の作成
- 旧 project への破壊的操作

本 PR の範囲は **手順書の作成と、コード調査の記録のみ**。以下も本 PR で同時に提案:

### 提案 A: `vercel.json` 追加(別 PR 推奨)

現状 `vercel.json` が存在しないため、Vercel Functions のリージョンは抽選(主に `iad1`)。Tokyo Supabase との通信距離を最小化するため:

```json
{
  "regions": ["hnd1"]
}
```

ただし、これは Tokyo 移行と **同時** に入れるのが望ましい(=移行前は Sydney との通信距離が悪化する可能性)。本 PR では含めず、Day 1 のステップ 13(Vercel env 差し替え)と同じデプロイで入れることを推奨。

### 提案 B: `.env.example` の Supabase 変数追記(本 PR で同時に行う)

現状 `.env.example` には `DATABASE_URL` と `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` のみ記載で、`SUPABASE_SERVICE_ROLE_KEY` が抜けている。本 PR で補足コメントを追加する。

---

## 参考リンク

- Supabase Docs: [Migrating between projects](https://supabase.com/docs/guides/platform/migrating-and-upgrading-projects)
- Supabase Docs: [Database Backups](https://supabase.com/docs/guides/platform/backups)
- Supabase CLI: [`supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- Vercel Docs: [Functions Region Configuration](https://vercel.com/docs/functions/configuring-functions/region)
