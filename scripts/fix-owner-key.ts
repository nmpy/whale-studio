#!/usr/bin/env tsx
/**
 * scripts/fix-owner-key.ts
 *
 * 既存 OA の owner_key が NULL のレコードに ADMIN_IDENTITY を設定する。
 * owner 権限の復旧用バックフィルスクリプト。
 *
 * 実行方法:
 *   ADMIN_IDENTITY=<your-supabase-user-id> npx tsx scripts/fix-owner-key.ts
 *   npx tsx scripts/fix-owner-key.ts --dry-run    # 実際には更新しない
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const adminIdentity = process.env.ADMIN_IDENTITY;

  if (!adminIdentity) {
    console.error("❌ ADMIN_IDENTITY 環境変数が設定されていません");
    console.error("   使い方: ADMIN_IDENTITY=<userId> npx tsx scripts/fix-owner-key.ts");
    process.exit(1);
  }

  // 対象レコードを確認
  const targets = await prisma.oa.findMany({
    where: { ownerKey: null },
    select: { id: true, title: true },
  });

  console.log(`📋 owner_key が NULL の OA: ${targets.length} 件`);
  for (const oa of targets) {
    console.log(`   - ${oa.id} (${oa.title})`);
  }

  if (targets.length === 0) {
    console.log("✅ 更新対象なし");
    return;
  }

  if (dryRun) {
    console.log(`🔍 [DRY RUN] ${targets.length} 件を更新予定 (owner_key = ${adminIdentity})`);
    return;
  }

  const result = await prisma.oa.updateMany({
    where: { ownerKey: null },
    data: { ownerKey: adminIdentity },
  });

  console.log(`✅ ${result.count} 件の OA に owner_key を設定しました (value: ${adminIdentity})`);
}

main()
  .catch((e) => {
    console.error("❌ エラーが発生しました:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
