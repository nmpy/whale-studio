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
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=30
```

| パラメータ | 必須理由 |
|---|---|
| **port `6543`** | Transaction Pooler (Supavisor)。serverless 向け = transaction-mode で短命接続を多重化 |
| **`pgbouncer=true`** | Prisma の prepared statement を無効化。PgBouncer (Supavisor も同) は transaction mode で prepared statement を共有できないため、これがないと `prepared statement "sX" does not exist` で落ちる |
| **`connection_limit=1`** | Lambda インスタンスごとに Prisma 内部 pool を 1 接続に制限。複数だと Transaction Pooler の `max_client_conn` を圧迫 |
| **`pool_timeout=30`** | Prisma 内部 pool で空き接続待ちのタイムアウト (秒)。default 10 → 30 でバースト耐性向上 |

#### Migrate (= ローカル Terminal one-off)
**Session Pooler (port 5432) を一時的に使う:**

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

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
5. Vercel → Deployments → 最新 production deploy → Redeploy
6. READY 後、`https://app.whale-studio.app/oas` 等で 200 確認 + runtime logs で `EMAXCONNSESSION` / `PrismaClientInitializationError` / `prepared statement does not exist` が出ていないこと

#### 秘匿情報の扱い
- DB password / DATABASE_URL の **値そのもの**はチャット / commit / log には絶対に貼らない
- Claude 等 AI とのやり取りでは **「伏字版」で構造のみ共有**
- ローカル開発で `.env` / `.env.local` に書く場合も git ignore 済みであることを必ず確認
- 過去にチャットや log に漏洩した可能性がある場合は password rotation を実施
