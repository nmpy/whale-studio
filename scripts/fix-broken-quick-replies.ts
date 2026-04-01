#!/usr/bin/env tsx
/**
 * scripts/fix-broken-quick-replies.ts
 *
 * quick_replies カラムに不正な JSON が保存されているレコードを検出し、
 * null にリセットするスクリプト。
 *
 * 実行方法:
 *   npx tsx scripts/fix-broken-quick-replies.ts
 *   npx tsx scripts/fix-broken-quick-replies.ts --dry-run    # 実際には更新しない
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`[fix-broken-quick-replies] 開始 (dry-run=${DRY_RUN})`);

  // quick_replies が NULL でないレコードを全件取得
  const messages = await prisma.message.findMany({
    where: { quickReplies: { not: null } },
    select: { id: true, quickReplies: true, messageType: true, kind: true },
  });

  console.log(`[fix-broken-quick-replies] quick_replies が設定されているレコード: ${messages.length} 件`);

  const broken: { id: string; raw: string }[] = [];
  const valid:  { id: string; count: number }[] = [];

  for (const msg of messages) {
    const raw = msg.quickReplies!;
    let parsed: unknown;
    let isValid = false;

    try {
      parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        isValid = true;
        valid.push({ id: msg.id, count: (parsed as unknown[]).length });
      } else {
        console.warn(`  [非配列] id=${msg.id} type=${msg.messageType} kind=${msg.kind} raw=${raw.slice(0, 80)}`);
      }
    } catch {
      console.warn(`  [不正JSON] id=${msg.id} type=${msg.messageType} kind=${msg.kind} raw=${raw.slice(0, 80)}`);
    }

    if (!isValid) {
      broken.push({ id: msg.id, raw });
    }
  }

  console.log(`\n--- 結果 ---`);
  console.log(`有効: ${valid.length} 件`);
  console.log(`不正: ${broken.length} 件`);

  if (broken.length === 0) {
    console.log("不正な quick_replies レコードはありませんでした。");
    return;
  }

  console.log("\n不正なレコード一覧:");
  for (const b of broken) {
    console.log(`  id=${b.id}  raw="${b.raw.slice(0, 100)}"`);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] 実際には更新しません。--dry-run を外して再実行してください。");
    return;
  }

  // NULL にリセット
  const ids = broken.map((b) => b.id);
  const result = await prisma.message.updateMany({
    where: { id: { in: ids } },
    data:  { quickReplies: null },
  });

  console.log(`\n[fix-broken-quick-replies] ${result.count} 件の quick_replies を null にリセットしました。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
