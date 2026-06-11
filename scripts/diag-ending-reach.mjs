// scripts/diag-ending-reach.mjs
// 通常1 puzzle 正解(→d0613693)以降、エンディング phase aee7b3c9 までの到達経路を調べる（READ-ONLY）。
//   RELINK_DATABASE_URL="$(pbpaste)" node scripts/diag-ending-reach.mjs
//
// 出力:
//  1) phase d0613693（正解遷移先）の中身＋そこからの遷移手段（Transition / QR target_phase / puzzle correctNextPhase / freeInput）
//  2) phase aee7b3c9（エンディング）の中身・entry head・phase entry 送信通数（buildPhaseMessages 相当・5通超え警告）
//  3) aee7b3c9 へ「入る」経路の逆引き（Transition.toPhase / QR target_phase / puzzle correctNextPhase）
//  4) 2f084123 / d92b7d68 が aee7b3c9 の entry head か
// findMany / findUnique のみ。

import { PrismaClient } from "@prisma/client";
const url = process.env.RELINK_DATABASE_URL;
if (!url) { console.error("RELINK_DATABASE_URL 未設定（SELECT 専用）"); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const D = "d0613693", ENDING = "aee7b3c9";
const cut = (s, n = 44) => (s ?? "").replace(/\n/g, " ").trim().slice(0, n);
const sid = (s) => (s ? String(s).slice(0, 8) : "null");
const parseQr = (j) => { if (!j) return []; try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch { return []; } };
const phaseByPrefix = (p) => prisma.phase.findFirst({ where: { id: { startsWith: p } }, select: { id: true, name: true, phaseType: true, workId: true } });

const MSEL = { id: true, kind: true, sortOrder: true, nextMessageId: true, freeInputEnabled: true, freeInputNextMessageId: true, correctNextPhaseId: true, quickReplies: true, body: true, isActive: true };

function entryHeads(msgs) {
  const referenced = new Set(msgs.map((m) => m.nextMessageId).filter(Boolean));
  return msgs.filter((m) => !referenced.has(m.id)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
// buildPhaseMessages 相当: 各 head から chain を最大5・freeInput 停止で walk。合計通数。
function phaseSendCount(msgs) {
  const byId = new Map(msgs.map((m) => [m.id, m]));
  let total = 0; const per = [];
  for (const h of entryHeads(msgs)) {
    let n = 0, cur = h.id; const seen = new Set();
    while (cur && !seen.has(cur) && n < 5) { seen.add(cur); const m = byId.get(cur); if (!m) break; n++; if (m.freeInputEnabled) break; cur = m.nextMessageId; }
    per.push(`${sid(h.id)}:${n}`); total += n;
  }
  return { total, per };
}

async function dumpPhase(label, prefix) {
  const ph = await phaseByPrefix(prefix);
  console.log(`\n===== ${label} phase ${prefix} =====`);
  if (!ph) { console.log("  見つからない"); return null; }
  console.log(`  id=${sid(ph.id)} name="${ph.name}" type=${ph.phaseType}`);
  const msgs = await prisma.message.findMany({ where: { phaseId: ph.id, isActive: true }, select: MSEL, orderBy: [{ sortOrder: "asc" }] });
  const heads = entryHeads(msgs);
  const { total, per } = phaseSendCount(msgs);
  console.log(`  active=${msgs.length} / entry heads=${heads.length} / phase entry 送信≈${total}通 [${per.join(", ")}]${total > 5 ? "  ⚠️ 5通超（6通目以降 push/未達リスク）" : ""}`);
  for (const m of msgs) {
    const qr = parseQr(m.quickReplies).map((q) => `${q.label}->${q.target_type === "phase" ? "phase:" + sid(q.target_phase_id) : q.target_type === "message" ? "msg:" + sid(q.target_message_id) : "resp:" + sid(q.response_message_id)}`);
    console.log(`   - ${sid(m.id)} kind=${m.kind} sort=${m.sortOrder} head=${heads.includes(m) ? "Y" : "-"} next=${sid(m.nextMessageId)} ` +
      `freeInput=${m.freeInputEnabled} correctNextPhase=${sid(m.correctNextPhaseId)} QR=[${qr.join(" | ")}]\n       body="${cut(m.body)}"`);
  }
  // この phase からの Transition
  const trans = await prisma.transition.findMany({ where: { fromPhaseId: ph.id }, select: { toPhaseId: true, label: true, condition: true, flagCondition: true, isActive: true } });
  console.log(`  Transition(from この phase) = ${trans.length}件`);
  for (const t of trans) console.log(`     → to=${sid(t.toPhaseId)} label="${t.label}" condition=${t.condition ?? "-"} flagCond=${t.flagCondition ?? "-"} active=${t.isActive}`);
  return ph;
}

async function main() {
  const dPhase = await dumpPhase("【正解遷移先】", D);
  const ePhase = await dumpPhase("【エンディング】", ENDING);

  // エンディングへ入る経路の逆引き
  console.log(`\n===== ${ENDING}（エンディング）へ入る経路の逆引き =====`);
  if (ePhase) {
    const intoTrans = await prisma.transition.findMany({ where: { toPhaseId: ePhase.id }, select: { fromPhaseId: true, label: true, condition: true, isActive: true } });
    console.log(`  Transition(to エンディング) = ${intoTrans.length}件`);
    for (const t of intoTrans) console.log(`   - from=${sid(t.fromPhaseId)} label="${t.label}" condition=${t.condition ?? "-"} active=${t.isActive}`);

    const workId = ePhase.workId;
    const all = await prisma.message.findMany({ where: { workId, isActive: true }, select: { id: true, phaseId: true, correctNextPhaseId: true, quickReplies: true, kind: true } });
    const qrInto = [], puzzleInto = [];
    for (const m of all) {
      if (m.correctNextPhaseId && ePhase.id.startsWith(m.correctNextPhaseId.slice(0, 8)) && m.correctNextPhaseId === ePhase.id) puzzleInto.push(m);
      for (const q of parseQr(m.quickReplies)) if (q.target_type === "phase" && q.target_phase_id === ePhase.id) qrInto.push({ m, label: q.label });
    }
    console.log(`  QR target_phase=エンディング = ${qrInto.length}件`);
    for (const x of qrInto) console.log(`   - msg=${sid(x.m.id)} phase=${sid(x.m.phaseId)} QR "${x.label}"`);
    console.log(`  puzzle correctNextPhase=エンディング = ${puzzleInto.length}件`);
    for (const m of puzzleInto) console.log(`   - msg=${sid(m.id)} phase=${sid(m.phaseId)} kind=${m.kind}`);
    if (intoTrans.length === 0 && qrInto.length === 0 && puzzleInto.length === 0) console.log("  ★ エンディングへ入る経路が見つからない（到達不能の疑い）");
  }

  // 2f084123 / d92b7d68 が aee7b3c9 entry head か
  console.log("\n===== 2f084123 / d92b7d68 の素性 =====");
  if (ePhase) {
    const msgs = await prisma.message.findMany({ where: { phaseId: ePhase.id, isActive: true }, select: MSEL });
    const heads = new Set(entryHeads(msgs).map((m) => m.id));
    for (const pre of ["2f084123", "d92b7d68"]) {
      const m = msgs.find((x) => x.id.startsWith(pre));
      console.log(`  ${pre}: ${m ? `phase=${sid(ePhase.id)} head=${heads.has(m.id) ? "YES(=phase entryで送信)" : "no"} next=${sid(m.nextMessageId)}` : "この phase に無い"}`);
    }
  }
  console.log("\n===== 完了（READ-ONLY） =====\n");
}
main().catch((e) => { console.error("ERROR:", (e?.message ?? String(e)).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***REDACTED***")); process.exit(1); }).finally(() => prisma.$disconnect());
