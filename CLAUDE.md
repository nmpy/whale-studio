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
