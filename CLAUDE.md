# Whale Studio — Development Guidelines

## Database & Migration Rules

### Provider
- **Production**: PostgreSQL (Supabase)
- **Local dev**: SQLite (`prisma db push`) or PostgreSQL

### Migration policy
- `prisma/migrations/` は **PostgreSQL 専用**。SQLite 構文を含めないこと。
- `migration_lock.toml` は `provider = "postgresql"` で固定。変更禁止。
- `prisma/migrations_sqlite_backup/` は旧 SQLite migration のバックアップ。本番適用対象ではない。確認後に削除可。

### Schema changes
1. `schema.prisma` を編集
2. `npx prisma migrate dev --name <description>` で PostgreSQL migration を生成
3. 生成された SQL を確認してコミット
4. 本番適用は `npx prisma migrate deploy`

### Local development with SQLite
- `DATABASE_URL="file:./dev.db"` の場合は `npx prisma db push` でスキーマ同期
- `prisma migrate dev` は PostgreSQL 接続時のみ使用すること
- SQLite と migration を混在させないこと

### Seed
- `npx prisma db seed` (= `node prisma/seed.mjs`)

### Connection strategy (Vercel runtime vs migrate)

本プロジェクトは Vercel serverless × Supabase。Pooler の使い分けが必須。
**Session Pooler を Vercel runtime に使うと EMAXCONNSESSION (= session-mode の max clients pool_size 上限) で本番が落ちる**ため、以下のルールを厳守:

#### Vercel runtime (= `DATABASE_URL`)
**Transaction Pooler (port 6543) + 3 つの query string を必須付与:**

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=30
```

> ⚠️ **host の fleet 接頭辞に注意**: 本番 Tokyo project の正しい host は `aws-1-ap-northeast-1.pooler.supabase.com`（`aws-0` ではない）。fleet 接頭辞(`aws-0`/`aws-1`)と region は **Supabase Dashboard → Connect → Transaction pooler に表示される値をそのままコピー**すること。誤った fleet/region を指定すると `FATAL: (ENOTFOUND) tenant/user postgres.<REF> not found` で全 DB クエリが失敗する（= host/fleet 不一致のサイン。tenant 自体は存在する）。

| パラメータ | 必須理由 |
|---|---|
| **port `6543`** | Transaction Pooler (Supavisor)。serverless 向け = transaction-mode で短命接続を多重化 |
| **`pgbouncer=true`** | Prisma の prepared statement を無効化。PgBouncer (Supavisor も同) は transaction mode で prepared statement を共有できないため、これがないと `prepared statement "sX" does not exist` で落ちる |
| **`connection_limit=1`** | Lambda インスタンスごとに Prisma 内部 pool を 1 接続に制限。複数だと Transaction Pooler の `max_client_conn` を圧迫 |
| **`pool_timeout=30`** | Prisma 内部 pool で空き接続待ちのタイムアウト (秒)。default 10 → 30 でバースト耐性向上 |

#### Migrate (= ローカル Terminal one-off)
**Session Pooler (port 5432) を一時的に使う:**

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
```

- **migrate 用途**: port は `5432`(Session Pooler)。host は runtime と同じ `aws-1-ap-northeast-1.pooler.supabase.com`(fleet/region は Connect 画面の値)。**この 5432 URL を Vercel runtime の `DATABASE_URL` に絶対に使わない**(= EMAXCONNSESSION で本番が落ちる)。migrate 用途と runtime 用途を混同しないこと。
- `pgbouncer=true` は付けない (= session mode は prepared statement OK)
- `connection_limit` も不要 (= 単発実行で並列性なし)
- 実行時のみ `DATABASE_URL` を export して `npx prisma migrate deploy`、終わったら `unset`
- Vercel の `DATABASE_URL` (runtime 用) は Transaction Pooler のまま **触らない**

#### Transaction Pooler では DDL が動かない場合がある
- `prisma migrate deploy` 等の DDL 操作は **Session Pooler (5432) でしか安定動作しない**ことがある
- そのため migrate は必ずローカル Terminal から Session Pooler URL で実行する

#### `DIRECT_URL` の扱い
- 本プロジェクトの `schema.prisma` には `directUrl` を**設定していない**
- Vercel に `DIRECT_URL` 環境変数が存在しても Prisma は読まない (= dead config)
- 旧パスワードを残さないため、`DIRECT_URL` は Vercel から **削除**するか、`DATABASE_URL` と同値に揃える

#### DB password rotation 手順
1. Supabase Dashboard → Database → Reset password
2. Supabase Dashboard → Database → Connection string
   - **Transaction pooler** タブ + **「Display password」を ON** にして URL コピー (= `[YOUR-PASSWORD]` placeholder 混入防止)
3. コピーした URL に `?pgbouncer=true&connection_limit=1&pool_timeout=30` を付与
4. Vercel → Settings → Environment Variables → `DATABASE_URL` を **Production / Preview / Development 全環境**で上書き
5. **fresh deploy で反映する**(= 空コミットを push: `git commit --allow-empty -m "chore: fresh deploy to apply DATABASE_URL" && git push`)。
   - ⚠️ Vercel Dashboard の **Redeploy は使わない**: Redeploy は**直前のデプロイの env snapshot を再利用**するため、更新した `DATABASE_URL` が反映されないことがある(実際に発生済み)。env 変更を確実に取り込むには新しいコミットによる fresh deploy が必要。
6. READY 後、`https://app.whale-studio.app/oas` 等で 200 確認 + runtime logs で `EMAXCONNSESSION` / `PrismaClientInitializationError` / `prepared statement does not exist` / `tenant/user ... not found` が出ていないこと

#### 秘匿情報の扱い
- DB password / DATABASE_URL の **値そのもの**はチャット / commit / log には絶対に貼らない
- Claude 等 AI とのやり取りでは **「伏字版」で構造のみ共有**
- ローカル開発で `.env` / `.env.local` に書く場合も git ignore 済みであることを必ず確認
- 過去にチャットや log に漏洩した可能性がある場合は password rotation を実施

## Vercel 本番デプロイ運用（自動デプロイ不発時の復旧）

Vercel は GitHub App 連携で main への push を検知して本番デプロイを自動発火する。ごく稀に、その
push/deployment webhook の**一過性の配信・処理失敗**で、merge commit の本番デプロイが**作られないことがある**
（実例: PR #554 の squash merge `0c2c912` で 15分以上 GitHub statuses 0件・deploy レコード無し。直前の #553 は
正常デプロイ済み・#554 の branch preview も生成済みだったため git integration 全体の停止ではなく、当該 commit
固有の取りこぼし）。以下の手順で確認・復旧する。

### 1. merge 後の確認（毎回）
- PR merge 後、**1〜2分以内に Vercel の本番 deploy レコードが作成されるか**を確認する。
  - `gh api repos/nmpy/whale-studio/commits/<merge_sha>/status -q '.statuses[]|"\(.context): \(.state)"'`
    に `Vercel – whale-studio` が出るか。
  - もしくは Vercel の deployment 一覧に **main / production の deploy** が当該 sha で現れるか。

### 2. deploy レコードが出ない場合の切り分け（設定不備でないか）
- GitHub commit status / check が付いているか（**0件なら Vercel がデプロイ自体を作っていない**サイン）。
- Vercel deploy list に **main の production deploy** があるか。
- **commit message に skip marker が無いか**（`[skip ci]` / `[vercel skip]` 等）。
- **`vercel.json` に `ignoreCommand` / ignored build step / git 抑制設定が無いか**（現状は `regions`＋`crons` のみで抑制設定なし）。
- （参考）commit author/committer/GPG 属性は原因にならない（正常デプロイした commit と同一プロフィールでも発生し得る）。

### 3. 設定不備が無く「deploy レコード自体が作られていない」場合 → 空コミットで fresh deploy を発火
- **コード変更なしの空コミット**を main に push する（merge 済みコードは既に main にあるので、これで内包した本番デプロイが発火する）。

```
git checkout main && git pull --ff-only origin main
git commit --allow-empty -m "chore: trigger production deploy"
git push origin main
```

- ⚠️ Vercel Dashboard の **Redeploy は使わない**（env snapshot 再利用のため。新しいコミットによる fresh deploy が確実）。

### 4. 空コミット後の必須確認
- deploy **state = READY**
- **aliasError = null**
- **main sha が空コミットを指している**こと
- その空コミットが**対象 PR のコードを内包している**こと（`git merge-base --is-ancestor <pr_merge_sha> main` が true）
- `https://app.whale-studio.app/login` が **200**
- `https://app.whale-studio.app/oas` が unauth で **307 → /login**
- runtime / webhook logs に **error が増えていない**こと（`get_runtime_errors` / logs で確認）

### 5. 位置づけ
- これは**アプリケーションコードの変更ではなく、Vercel GitHub App webhook の一過性取りこぼし時の復旧手順**である。
  設定不備が原因ではないため恒久対応は不要。確証を得たい場合のみ、GitHub → Settings → GitHub Apps → Vercel →
  Advanced → **Recent Deliveries** で当該 push 前後の失敗配信を確認する（`gh` からは GitHub App の配信ログは見えない）。
