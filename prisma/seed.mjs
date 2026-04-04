// prisma/seed.mjs
// Plan マスタ・初期データを投入する seed スクリプト。
//
// 実行方法:
//   npm run db:seed
//   # または直接: node prisma/seed.mjs
//
// 冪等性: upsert で何度実行しても安全。

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding plans...");

  // ── tester プラン ──────────────────────────────────────────
  const tester = await prisma.plan.upsert({
    where:  { name: "tester" },
    update: {},          // 既存なら変更しない
    create: {
      name:         "tester",
      displayName:  "テスタープラン",
      maxWorks:     1,   // 1 作品まで
      maxPlayers:   -1,  // プレイヤー数無制限
      priceMonthly: 0,   // 無料
      isActive:     true,
    },
  });
  console.log(`  ✓ tester  (id=${tester.id.slice(0, 8)}…)`);

  // ── editor プラン ──────────────────────────────────────────
  const editor = await prisma.plan.upsert({
    where:  { name: "editor" },
    update: {},
    create: {
      name:         "editor",
      displayName:  "editorプラン",
      maxWorks:     -1,     // 無制限
      maxPlayers:   -1,     // 無制限
      priceMonthly: 9800,   // 月額 9,800 円
      isActive:     true,
    },
  });
  console.log(`  ✓ editor  (id=${editor.id.slice(0, 8)}…)`);

  console.log("✅  Seeding complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
