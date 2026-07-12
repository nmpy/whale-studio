// scripts/rh-test/vitest.e2e.config.ts
// リリースハードニング E2E 専用の vitest 設定。
// - 通常の `npm test`（vitest.config.ts・DB不要・prisma モック）とは完全に分離。
// - include は rh-e2e の *.e2e.ts のみ。
// - 実 PrismaClient を docker PG に接続（prisma はモックしない）。DATABASE_URL は
//   呼び出しシェルが .env.test.local から export する前提。setup で接続ガードを再確認。
// - 並行実行による DB 競合を避けるため singleThread（E2E は逐次）。
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/rh-e2e/**/*.e2e.ts"],
    setupFiles: ["src/__tests__/rh-e2e/_setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // E2E は同一 DB を共有するため逐次実行（並行テスト間の干渉防止。concurrency は
    // テスト内部で Promise.all を使って明示的に検証する）。Vitest 4: fileParallelism=false で直列化。
    pool: "forks",
    fileParallelism: false,
  },
});
