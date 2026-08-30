// scripts/rh-test/db-guard.mjs
// リリースハードニング E2E 専用: 接続先が「本番でない一時ローカルPG」であることを強制する。
// どれか1つでも満たさなければ即 process.exit(1)（= abort）。
// このガードは seed / migrate / E2E すべての DB 接続前に必ず import して assertLocalTestDb() する。
//
// 表示するのは host と database 名のみ（password/token/完全URLは出さない）。

// 本番として絶対に接続してはいけない既知ホスト断片（Supabase / pooler 等）。
const FORBIDDEN_HOST_FRAGMENTS = [
  "pooler.supabase.com",
  "supabase.co",
  "supabase.in",
  "amazonaws.com",
  "aws-0-",
  "aws-1-",
  "rds.",
  "neon.tech",
  "vercel-storage.com",
];

const REQUIRED_DB_TOKENS = ["test", "release_hardening"];

/** DATABASE_URL を解析し、非機密の {host, port, db} だけ返す（値は出さない）。 */
function parse(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return {
    host: u.hostname,
    port: u.port || "5432",
    db: (u.pathname || "").replace(/^\//, "").split("?")[0],
    protocol: u.protocol,
  };
}

/**
 * 本番でない一時ローカルPGであることを強制。満たさなければ abort。
 * 戻り値: { host, port, db }（表示可能な非機密のみ）。
 */
export function assertLocalTestDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db-guard] ABORT: DATABASE_URL is not set");
    process.exit(1);
  }

  // 生URL全体に対して本番ホスト断片が含まれていないか（parse 前に文字列レベルでも二重チェック）。
  const lower = url.toLowerCase();
  for (const frag of FORBIDDEN_HOST_FRAGMENTS) {
    if (lower.includes(frag)) {
      console.error(`[db-guard] ABORT: DATABASE_URL contains forbidden host fragment "${frag}" (looks like production)`);
      process.exit(1);
    }
  }

  const p = parse(url);
  if (!p) {
    console.error("[db-guard] ABORT: DATABASE_URL is not a valid URL");
    process.exit(1);
  }

  if (!p.protocol.startsWith("postgres")) {
    console.error(`[db-guard] ABORT: protocol is "${p.protocol}" (expected postgresql)`);
    process.exit(1);
  }

  // 1. host は localhost / 127.0.0.1 のみ許可。
  if (p.host !== "localhost" && p.host !== "127.0.0.1") {
    console.error(`[db-guard] ABORT: host="${p.host}" is not localhost/127.0.0.1`);
    process.exit(1);
  }

  // 2. database 名に test / release_hardening を必須。
  const dbLower = p.db.toLowerCase();
  if (!REQUIRED_DB_TOKENS.some((t) => dbLower.includes(t))) {
    console.error(`[db-guard] ABORT: database="${p.db}" does not contain test/release_hardening`);
    process.exit(1);
  }

  // 3. NODE_ENV は test 必須。
  if (process.env.NODE_ENV !== "test") {
    console.error(`[db-guard] ABORT: NODE_ENV="${process.env.NODE_ENV}" (expected "test")`);
    process.exit(1);
  }

  console.log(`[db-guard] OK  host=${p.host}  port=${p.port}  db=${p.db}  NODE_ENV=test`);
  return { host: p.host, port: p.port, db: p.db };
}

// 直接実行された場合はガードだけ走らせて結果を出す。
if (import.meta.url === `file://${process.argv[1]}`) {
  assertLocalTestDb();
}
