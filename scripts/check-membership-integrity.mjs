#!/usr/bin/env node
// scripts/check-membership-integrity.mjs
// workspace_members の整合性チェックスクリプト
//
// 実行方法:
//   node scripts/check-membership-integrity.mjs
//
// 検出する問題:
//   1. bypass-admin / dev-user が紐づいた membership レコード
//   2. active な owner が 0 人の OA（workspace）
//   3. bypass-admin のみが owner の OA
//
// 環境変数 DATABASE_URL を参照する（.env から自動読み込み）。

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let hasIssue = false;

  // ── 1. bypass-admin / dev-user の membership ──────────────────────
  console.log("\n=== 1. stub user (bypass-admin / dev-user) の membership ===\n");
  const stubMembers = await prisma.workspaceMember.findMany({
    where: { userId: { in: ["bypass-admin", "dev-user"] } },
    include: { oa: { select: { title: true } } },
  });

  if (stubMembers.length === 0) {
    console.log("  OK: stub user の membership はありません");
  } else {
    hasIssue = true;
    console.log(`  NG: ${stubMembers.length} 件の stub user membership が見つかりました\n`);
    for (const m of stubMembers) {
      console.log(`  - id=${m.id}`);
      console.log(`    userId=${m.userId}  role=${m.role}  status=${m.status}`);
      console.log(`    OA: ${m.oa.title} (${m.workspaceId})`);
      console.log();
    }
    console.log("  修正例:");
    console.log("  UPDATE workspace_members SET user_id = '<実ユーザーID>' WHERE user_id = 'bypass-admin';");
  }

  // ── 2. active owner が 0 人の OA ─────────────────────────────────
  console.log("\n=== 2. active owner が不在の OA ===\n");
  const allOas = await prisma.oa.findMany({
    select: {
      id:    true,
      title: true,
      workspaceMembers: {
        where: { role: "owner", status: "active" },
        select: { userId: true },
      },
    },
  });

  const ownerless = allOas.filter((oa) => oa.workspaceMembers.length === 0);
  if (ownerless.length === 0) {
    console.log("  OK: すべての OA に active owner がいます");
  } else {
    hasIssue = true;
    console.log(`  NG: ${ownerless.length} 件の OA に active owner がいません\n`);
    for (const oa of ownerless) {
      console.log(`  - ${oa.title} (${oa.id})`);
    }
  }

  // ── 3. bypass-admin のみが owner の OA ────────────────────────────
  console.log("\n=== 3. bypass-admin のみが owner の OA ===\n");
  const bypassOnlyOwner = allOas.filter((oa) => {
    const owners = oa.workspaceMembers;
    return owners.length > 0 && owners.every((m) => m.userId === "bypass-admin");
  });

  if (bypassOnlyOwner.length === 0) {
    console.log("  OK: bypass-admin のみが owner の OA はありません");
  } else {
    hasIssue = true;
    console.log(`  NG: ${bypassOnlyOwner.length} 件の OA で bypass-admin のみが owner です\n`);
    for (const oa of bypassOnlyOwner) {
      console.log(`  - ${oa.title} (${oa.id})`);
    }
  }

  // ── サマリー ──────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  if (hasIssue) {
    console.log("⚠️  問題が見つかりました。上記の内容を確認してください。");
    process.exitCode = 1;
  } else {
    console.log("✅  すべてのチェックが正常です。");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
