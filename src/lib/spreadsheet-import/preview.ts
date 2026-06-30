// src/lib/spreadsheet-import/preview.ts
// 検証OK時の反映予定（summary + 行別 action）を算出する純ロジック。DB アクセスはしない。

import type { NormalizedSheets, ExistingData, ImportSummary, PreviewRow } from "./types";

export function buildPreview(n: NormalizedSheets, existing: ExistingData): { summary: ImportSummary; rows: PreviewRow[] } {
  const rows: PreviewRow[] = [];
  const summary: ImportSummary = {
    characters: { create: 0, update: 0 },
    phases: { create: 0, update: 0 },
    messages: { create: 0, update: 0 },
    transitions: { create: 0, update: 0 },
  };

  for (const c of n.characters) {
    const action = existing.characterKeys.has(c.characterKey) ? "update" : "create";
    summary.characters[action]++;
    rows.push({ sheet: "characters", row: c.row, key: c.characterKey, action });
  }
  for (const p of n.phases) {
    const action = existing.phaseKeys.has(p.phaseKey) ? "update" : "create";
    summary.phases[action]++;
    rows.push({ sheet: "phases", row: p.row, key: p.phaseKey, action });
  }
  for (const m of n.messages) {
    const action = existing.messageKeys.has(m.messageKey) ? "update" : "create";
    summary.messages[action]++;
    rows.push({ sheet: "messages", row: m.row, key: m.messageKey, action });

    // input_wait 由来の transition（fromPhaseKey::condition で既存判定）
    if (m.kind === "input_wait" && m.phaseKey && m.responseKeyword) {
      const tKey = `${m.phaseKey}::${m.responseKeyword}`;
      summary.transitions[existing.transitionKeys.has(tKey) ? "update" : "create"]++;
    }
  }

  return { summary, rows };
}
