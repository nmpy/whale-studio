#!/usr/bin/env npx tsx
/**
 * scripts/cleanup-checkin-attempts.ts
 *
 * CheckinAttempt の retention cleanup スクリプト。
 *
 * 使い方:
 *   npx tsx scripts/cleanup-checkin-attempts.ts                   # 90日前を削除
 *   npx tsx scripts/cleanup-checkin-attempts.ts --days 60         # 60日前を削除
 *   npx tsx scripts/cleanup-checkin-attempts.ts --dry-run         # 削除せず件数だけ表示
 *   npx tsx scripts/cleanup-checkin-attempts.ts --days 30 --dry-run
 *
 * 自動実行:
 *   POST /api/internal/cleanup/checkin-attempts
 *   Authorization: Bearer $CRON_SECRET
 *   Body: { "retentionDays": 90, "dryRun": false }
 *
 * 保持ポリシー:
 *   - デフォルト 90 日
 *   - lat/lng も含めてレコードごと削除
 *   - 1000 件ずつ batch 削除で DB 負荷を抑制
 */

import { cleanupOldAttempts, RETENTION_DAYS } from "../src/lib/checkin-attempt";

function parseArgs() {
  const args = process.argv.slice(2);
  let days = RETENTION_DAYS;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    if (args[i] === "--days" && args[i + 1]) { days = Number(args[i + 1]); i++; }
    if (args[i]?.startsWith("--days=")) days = Number(args[i].split("=")[1]);
  }

  return { days, dryRun };
}

async function main() {
  const { days, dryRun } = parseArgs();

  if (isNaN(days) || days < 1) {
    console.error("Invalid --days value");
    process.exit(1);
  }

  console.log(`[cleanup] CheckinAttempt: ${days}日以前のレコード${dryRun ? "（dry-run: 削除しません）" : "を削除します"}...`);

  const result = await cleanupOldAttempts(days, dryRun);

  console.log(`[cleanup] cutoff: ${result.cutoffDate}`);
  console.log(`[cleanup] ${dryRun ? "削除対象" : "削除済み"}: ${result.deletedCount} 件`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[cleanup] エラー:", err);
  process.exit(1);
});
