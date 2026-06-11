// scripts/fix-step1-tsujo2-ending-qr.mjs
// Step 1: 通常2(d0613693) 末尾 7f5f1e69 に「手紙を届けに行く」QR を1件追加し、
//         target_type=phase / target_phase_id=aee7b3c9 でエンディングへ遷移できるようにする。
//         ※ ending 内部の next / sortOrder は一切変更しない（Step 2 で別途）。
//
// 既定 DRY-RUN（SELECT のみ）。実適用は APPLY=1 のときだけ。
//   dry-run : RELINK_DATABASE_URL="$(pbpaste)" node scripts/fix-step1-tsujo2-ending-qr.mjs
//   apply   : RELINK_DATABASE_URL="$(pbpaste)" APPLY=1 node scripts/fix-step1-tsujo2-ending-qr.mjs
//
// 三重条件（不成立なら中止・書き込みなし）:
//   1. 7f5f1e69 が存在し phase=通常2(d0613693)・active・本文に「赤いポスト」を含む（対象取り違え防止）
//   2. aee7b3c9 が存在し phaseType="ending"
//   3. 7f5f1e69 に target_phase=aee7b3c9 の QR が未追加（二重追加防止）
// APPLY 時は transaction 内で quickReplies に1件 append → 再 SELECT で追加を検証（不一致なら rollback）。

import { PrismaClient } from "@prisma/client";
const url = process.env.RELINK_DATABASE_URL;
if (!url) { console.error("RELINK_DATABASE_URL 未設定"); process.exit(1); }
const APPLY = process.env.APPLY === "1";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const TAIL = "7f5f1e69", PHASE2 = "d0613693", ENDING = "aee7b3c9";
const LABEL = "手紙を届けに行く";
const sid = (s) => (s ? String(s).slice(0, 8) : "null");
const parseQr = (j) => { if (!j) return []; try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch { return []; } };
async function msgByPrefix(p) { const a = await prisma.message.findMany({ where: { id: { startsWith: p } }, select: { id: true } }); if (a.length !== 1) throw new Error(`message prefix ${p} が一意でない (${a.length})`); return a[0].id; }

async function main() {
  console.log(`\nMODE = ${APPLY ? "APPLY（書き込み）" : "DRY-RUN（読み取りのみ）"}\n`);

  const tailId = await msgByPrefix(TAIL);
  const tail = await prisma.message.findUnique({ where: { id: tailId }, select: { id: true, phaseId: true, isActive: true, body: true, quickReplies: true } });
  const endingPhase = await prisma.phase.findFirst({ where: { id: { startsWith: ENDING } }, select: { id: true, name: true, phaseType: true } });

  const items = parseQr(tail?.quickReplies);
  console.log(`対象: 7f5f1e69=${sid(tail?.id)} phase=${sid(tail?.phaseId)} active=${tail?.isActive} 既存QR=${items.length}件`);
  console.log(`  body="${(tail?.body ?? "").replace(/\n/g, " ").slice(0, 50)}"`);
  console.log(`ending: ${sid(endingPhase?.id)} name="${endingPhase?.name}" type=${endingPhase?.phaseType}`);

  // ── 三重条件 ──
  const cond1 = !!tail && tail.phaseId?.startsWith(PHASE2) && tail.isActive === true && (tail.body ?? "").includes("赤いポスト");
  const cond2 = !!endingPhase && endingPhase.phaseType === "ending";
  const cond3 = !items.some((it) => it.target_type === "phase" && typeof it.target_phase_id === "string" && it.target_phase_id.startsWith(ENDING));
  console.log("\n三重条件:");
  console.log(`  [${cond1 ? "OK" : "NG"}] 1. 7f5f1e69 ∈ 通常2(d0613693)・active・本文に「赤いポスト」`);
  console.log(`  [${cond2 ? "OK" : "NG"}] 2. aee7b3c9 が phaseType=ending`);
  console.log(`  [${cond3 ? "OK" : "NG"}] 3. target_phase=ending の QR が未追加`);
  if (!(cond1 && cond2 && cond3)) { console.error("\n✗ 条件不成立。中止（書き込みなし）。"); process.exit(2); }

  const newItem = {
    label: LABEL,
    action: "text",
    target_type: "phase",
    target_phase_id: endingPhase.id,
    target_message_id: null,
    response_message_id: null,
  };
  const newItems = [...items, newItem];
  console.log("\n変更内容: 7f5f1e69.quickReplies に1件 append");
  console.log(`  + label="${LABEL}" action=text target_type=phase target_phase_id=${sid(endingPhase.id)} target_message_id=null`);
  console.log(`  （既存QR ${items.length}件は保持。ending 内部は変更なし）`);

  if (!APPLY) { console.log("\nDRY-RUN のため書き込みません。問題なければ APPLY=1 で再実行してください。\n"); return; }

  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: tailId }, data: { quickReplies: JSON.stringify(newItems) } });
    const after = await tx.message.findUnique({ where: { id: tailId }, select: { quickReplies: true } });
    const arr = parseQr(after?.quickReplies);
    const ok = arr.some((it) => it.label === LABEL && it.target_type === "phase" && it.target_phase_id === endingPhase.id && !it.target_message_id);
    if (!ok) throw new Error("post-apply: ending 遷移 QR が見つからない → rollback");
    if (arr.length !== items.length + 1) throw new Error(`post-apply: QR 件数 ${arr.length} ≠ ${items.length + 1} → rollback`);
  });
  console.log(`\n✓ APPLY 完了。7f5f1e69 に「${LABEL}」(target_phase=${sid(endingPhase.id)}) を追加。`);
  console.log("  ※ phase キャッシュ TTL=60s。実機確認は ~60秒後 もしくは再デプロイ後に。");
  console.log("  ※ ending 内部（next/sortOrder）は未変更。入場時の一斉送信問題は Step 2 で対応。\n");
}
main().catch((e) => { console.error("ERROR:", (e?.message ?? String(e)).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***REDACTED***")); process.exit(1); }).finally(() => prisma.$disconnect());
