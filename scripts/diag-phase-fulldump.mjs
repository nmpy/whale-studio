// scripts/diag-phase-fulldump.mjs
// 通常2(d0613693) と エンディング(aee7b3c9) の全文ダンプ（READ-ONLY・本文を切り詰めない）。
//   RELINK_DATABASE_URL="$(pbpaste)" node scripts/diag-phase-fulldump.mjs
// 出力: phase ごとに entry head / 各 message の body全文・next chain・QR全文・freeInput・逆参照・送信順。
// findMany のみ。

import { PrismaClient } from "@prisma/client";
const url = process.env.RELINK_DATABASE_URL;
if (!url) { console.error("RELINK_DATABASE_URL 未設定（SELECT 専用）"); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const PHASES = [{ pre: "d0613693", title: "通常2" }, { pre: "aee7b3c9", title: "エンディング" }];
const ENDING_LABELS = { d92b7d68: "A", "2f084123": "B", ee17adfa: "C", c28b6d12: "D", "5e768254": "E", "6d85502f": "F", "15cc80e7": "G" };
const sid = (s) => (s ? String(s).slice(0, 8) : "null");
const parseQr = (j) => { if (!j) return []; try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch { return []; } };
const MSEL = { id: true, phaseId: true, kind: true, sortOrder: true, nextMessageId: true, freeInputEnabled: true, freeInputVariableKey: true, freeInputNextMessageId: true, correctNextPhaseId: true, correctText: true, quickReplies: true, body: true, isActive: true, createdAt: true };

function entryHeads(msgs) {
  const referenced = new Set(msgs.map((m) => m.nextMessageId).filter(Boolean));
  return msgs.filter((m) => !referenced.has(m.id));
}
function refsOf(id, all) {
  const out = [];
  for (const m of all) {
    if (m.id === id) continue;
    if (m.nextMessageId === id) out.push(`${sid(m.id)}(next)`);
    if (m.freeInputNextMessageId === id) out.push(`${sid(m.id)}(freeInputNext)`);
    for (const q of parseQr(m.quickReplies)) {
      if (q.target_message_id === id) out.push(`${sid(m.id)}(QR target "${q.label}")`);
      if (q.response_message_id === id) out.push(`${sid(m.id)}(QR response "${q.label}")`);
    }
  }
  return out;
}

async function main() {
  for (const { pre, title } of PHASES) {
    const ph = await prisma.phase.findFirst({ where: { id: { startsWith: pre } }, select: { id: true, name: true, phaseType: true, workId: true } });
    console.log(`\n############################################################`);
    console.log(`# ${title}  phase=${pre}  name="${ph?.name}"  type=${ph?.phaseType}`);
    console.log(`############################################################`);
    if (!ph) { console.log("  見つからない"); continue; }
    const all = await prisma.message.findMany({ where: { workId: ph.workId }, select: MSEL });
    const msgs = all.filter((m) => m.phaseId === ph.id && m.isActive)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt > b.createdAt ? 1 : -1));
    const heads = entryHeads(msgs);
    console.log(`active=${msgs.length} / entry head=${heads.length}`);
    console.log(`entry head 一覧: ${heads.map((h) => sid(h.id) + (ENDING_LABELS[h.id.slice(0,8)] ? `(${ENDING_LABELS[h.id.slice(0,8)]})` : "")).join(", ")}`);

    // 送信順（buildPhaseMessages 相当: head を sort 順に、各 chain を最大5・freeInput停止、最初の freeInput で全停止）
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const order = []; let stopped = false;
    for (const h of heads) {
      if (stopped) break;
      let cur = h.id; const seen = new Set(); let n = 0;
      while (cur && !seen.has(cur) && n < 5) { seen.add(cur); const m = byId.get(cur); if (!m) break; order.push(cur); n++; if (m.freeInputEnabled) { stopped = true; break; } cur = m.nextMessageId; }
    }
    console.log(`buildPhaseMessages 送信順(${order.length}通${stopped ? "・freeInputで停止" : ""}): ${order.map(sid).join(" → ")}`);

    for (const m of msgs) {
      const label = ENDING_LABELS[m.id.slice(0, 8)];
      console.log(`\n--- ${sid(m.id)}${label ? ` [head ${label}]` : ""} kind=${m.kind} sort=${m.sortOrder} head=${heads.includes(m) ? "YES" : "-"} active=${m.isActive}`);
      console.log(`    next=${sid(m.nextMessageId)} freeInput=${m.freeInputEnabled} varKey=${m.freeInputVariableKey ?? "-"} freeInputNext=${sid(m.freeInputNextMessageId)} correctNextPhase=${sid(m.correctNextPhaseId)}`);
      console.log(`    body: ${JSON.stringify(m.body)}`);
      const qrs = parseQr(m.quickReplies);
      if (qrs.length) {
        console.log(`    quickReplies(${qrs.length}):`);
        for (const q of qrs) console.log(`      - label="${q.label}" action=${q.action} target_type=${q.target_type} target_message_id=${sid(q.target_message_id)} target_phase_id=${sid(q.target_phase_id)} response_message_id=${sid(q.response_message_id)}`);
      }
      console.log(`    ← 逆参照: ${(() => { const r = refsOf(m.id, all); return r.length ? r.join(", ") : "★なし(=phase entry head)"; })()}`);
    }
  }
  console.log("\n===== 完了（READ-ONLY） =====\n");
}
main().catch((e) => { console.error("ERROR:", (e?.message ?? String(e)).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***REDACTED***")); process.exit(1); }).finally(() => prisma.$disconnect());
