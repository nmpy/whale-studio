// scripts/diag-ending-inbound.mjs
// エンディング phase aee7b3c9 への「あらゆる inbound 経路」を洗う（READ-ONLY）。
//   RELINK_DATABASE_URL="$(pbpaste)" node scripts/diag-ending-inbound.mjs
//
// diag-ending-reach.mjs は Transition/QR target_phase/puzzle correctNextPhase を見たが、
// ここでは追加で「aee7b3c9 外のメッセージ → aee7b3c9 のメッセージ」を指す
//   - nextMessageId（cross-phase chain link）
//   - freeInputNextMessageId（自由入力応答が ending へ）
//   - QR target_message_id / response_message_id（QR が ending message へジャンプ）
// を全 work から検出する。これらが 0 なら「ending は本当に到達不能」と確定できる。
// findMany のみ。

import { PrismaClient } from "@prisma/client";
const url = process.env.RELINK_DATABASE_URL;
if (!url) { console.error("RELINK_DATABASE_URL 未設定（SELECT 専用）"); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const ENDING = "aee7b3c9";
const cut = (s, n = 40) => (s ?? "").replace(/\n/g, " ").trim().slice(0, n);
const sid = (s) => (s ? String(s).slice(0, 8) : "null");
const parseQr = (j) => { if (!j) return []; try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch { return []; } };

async function main() {
  const ph = await prisma.phase.findFirst({ where: { id: { startsWith: ENDING } }, select: { id: true, name: true, phaseType: true, workId: true } });
  if (!ph) { console.log("ending phase 見つからない"); return; }
  console.log(`\nending phase=${sid(ph.id)} name="${ph.name}" type=${ph.phaseType}`);

  const endingMsgs = await prisma.message.findMany({ where: { phaseId: ph.id }, select: { id: true } });
  const endingIds = new Set(endingMsgs.map((m) => m.id));

  const all = await prisma.message.findMany({
    where: { workId: ph.workId },
    select: { id: true, phaseId: true, nextMessageId: true, freeInputNextMessageId: true, quickReplies: true, body: true, isActive: true },
  });

  console.log(`\n===== aee7b3c9 外 → aee7b3c9 内 への inbound エッジ =====`);
  const hits = [];
  for (const m of all) {
    if (endingIds.has(m.id)) continue; // ending 外のメッセージだけが対象
    if (m.nextMessageId && endingIds.has(m.nextMessageId)) hits.push(`${sid(m.id)}(phase=${sid(m.phaseId)} active=${m.isActive}) --next--> ${sid(m.nextMessageId)}`);
    if (m.freeInputNextMessageId && endingIds.has(m.freeInputNextMessageId)) hits.push(`${sid(m.id)}(phase=${sid(m.phaseId)}) --freeInputNext--> ${sid(m.freeInputNextMessageId)}`);
    for (const q of parseQr(m.quickReplies)) {
      if (q.target_message_id && endingIds.has(q.target_message_id)) hits.push(`${sid(m.id)}(phase=${sid(m.phaseId)}) --QR target "${q.label}"--> ${sid(q.target_message_id)}`);
      if (q.response_message_id && endingIds.has(q.response_message_id)) hits.push(`${sid(m.id)}(phase=${sid(m.phaseId)}) --QR response "${q.label}"--> ${sid(q.response_message_id)}`);
    }
  }
  if (hits.length === 0) console.log("  なし（next / freeInputNext / QR どれも ending 内を指していない）");
  for (const h of hits) console.log(`  - ${h}`);

  // Transition / QR target_phase / puzzle correctNextPhase（再掲・確定用）
  const intoTrans = await prisma.transition.count({ where: { toPhaseId: ph.id } });
  let qrPhase = 0, puzzlePhase = 0;
  for (const m of all) {
    if (m.phaseId && false) { /* noop */ }
  }
  const allMsgs2 = await prisma.message.findMany({ where: { workId: ph.workId }, select: { quickReplies: true, correctNextPhaseId: true } });
  for (const m of allMsgs2) {
    if (m.correctNextPhaseId === ph.id) puzzlePhase++;
    for (const q of parseQr(m.quickReplies)) if (q.target_type === "phase" && q.target_phase_id === ph.id) qrPhase++;
  }
  console.log(`\n===== phase 遷移系（再掲） =====`);
  console.log(`  Transition(to ending)=${intoTrans} / QR target_phase=ending=${qrPhase} / puzzle correctNextPhase=ending=${puzzlePhase}`);

  console.log(`\n===== 結論 =====`);
  const reachable = hits.length > 0 || intoTrans > 0 || qrPhase > 0 || puzzlePhase > 0;
  console.log(reachable
    ? "  ending へ入る経路が存在する（上記）。経路の種類で currentPhase が ending になるか要確認。"
    : "  ★ ending へ入る経路が一切見つからない＝現状到達不能（routing 欠落）。");
  console.log("\n===== 完了（READ-ONLY） =====\n");
}
main().catch((e) => { console.error("ERROR:", (e?.message ?? String(e)).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***REDACTED***")); process.exit(1); }).finally(() => prisma.$disconnect());
