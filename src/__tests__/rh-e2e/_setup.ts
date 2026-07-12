// src/__tests__/rh-e2e/_setup.ts
// E2E 実行前の安全ガード。接続先が本番でない一時ローカルPGであることを強制する。
// DATABASE_URL は呼び出しシェルが .env.test.local から export 済みの前提。
import { beforeAll } from "vitest";

function assertLocalTestDbInline() {
  const url = process.env.DATABASE_URL ?? "";
  const lower = url.toLowerCase();
  const forbidden = ["pooler.supabase.com", "supabase.co", "supabase.in", "amazonaws.com", "aws-0-", "aws-1-", "rds.", "neon.tech"];
  for (const f of forbidden) {
    if (lower.includes(f)) throw new Error(`[e2e-guard] ABORT: DATABASE_URL contains forbidden host fragment "${f}"`);
  }
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    db = (u.pathname || "").replace(/^\//, "").split("?")[0];
  } catch {
    throw new Error("[e2e-guard] ABORT: DATABASE_URL invalid");
  }
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`[e2e-guard] ABORT: host="${host}" not local`);
  if (!/test|release_hardening/i.test(db)) throw new Error(`[e2e-guard] ABORT: db="${db}" not a test db`);
  if (process.env.NODE_ENV !== "test") throw new Error(`[e2e-guard] ABORT: NODE_ENV="${process.env.NODE_ENV}"`);
  // eslint-disable-next-line no-console
  console.log(`[e2e-guard] OK host=${host} db=${db}`);
}

beforeAll(() => {
  assertLocalTestDbInline();
});
