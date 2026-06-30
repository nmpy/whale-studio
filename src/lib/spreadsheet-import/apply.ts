// src/lib/spreadsheet-import/apply.ts
// 検証OKの NormalizedSheets を transaction 内で upsert する。
// 保存順: characters → phases → (key→id 解決) → messages → input_wait 由来 transitions。
// すべて *_key で照合（既存あれば update / 無ければ create）。シートに無い既存行は触らない（削除なし）。

import type { Prisma } from "@prisma/client";
import type { NormalizedSheets, NormMessage } from "./types";

/** kind → Message の保存フィールド（messageType/kind/body/characterId/assetUrl/quickReplies）。 */
function mapMessageFields(
  m: NormMessage,
  phaseIdOf: (key: string) => string,
  characterIdOf: (key: string) => string | null,
): { messageType: string; kind: string; body: string | null; characterId: string | null; assetUrl: string | null; quickReplies: string | null } {
  switch (m.kind) {
    case "line":
      return { messageType: "text", kind: "normal", body: m.content, characterId: characterIdOf(m.characterKey!), assetUrl: null, quickReplies: null };
    case "narration":
      return { messageType: "text", kind: "normal", body: m.content, characterId: null, assetUrl: null, quickReplies: null };
    case "system":
      return { messageType: "text", kind: "system_notice", body: m.content, characterId: null, assetUrl: null, quickReplies: null };
    case "image":
      return { messageType: "image", kind: "normal", body: m.content, characterId: null, assetUrl: m.imageUrl, quickReplies: null };
    case "choice": {
      const items = m.choices
        .filter((c) => c.label && c.nextPhaseKey)
        .map((c) => ({ label: c.label!, action: "text", target_type: "phase", target_phase_id: phaseIdOf(c.nextPhaseKey!), enabled: true }));
      return { messageType: "text", kind: "normal", body: m.content, characterId: null, assetUrl: null, quickReplies: JSON.stringify(items) };
    }
    case "input_wait":
      return { messageType: "text", kind: "normal", body: m.content, characterId: null, assetUrl: null, quickReplies: null };
    default:
      return { messageType: "text", kind: "normal", body: m.content, characterId: null, assetUrl: null, quickReplies: null };
  }
}

export async function applyImport(tx: Prisma.TransactionClient, workId: string, n: NormalizedSheets): Promise<void> {
  // 1. characters upsert
  for (const c of n.characters) {
    await tx.character.upsert({
      where:  { workId_characterKey: { workId, characterKey: c.characterKey } },
      create: {
        workId, characterKey: c.characterKey, name: c.name,
        ...(c.iconImageUrl !== null ? { iconImageUrl: c.iconImageUrl, iconType: "image" } : {}),
        sortOrder: c.displayOrder ?? 0, isActive: true,
      },
      update: {
        name: c.name,
        ...(c.iconImageUrl !== null ? { iconImageUrl: c.iconImageUrl, iconType: "image" } : {}),
        ...(c.displayOrder !== null ? { sortOrder: c.displayOrder } : {}),
      },
    });
  }

  // 2. phases upsert（既存 phaseType は保持。is_start_phase=true のときだけ start に更新）
  for (const p of n.phases) {
    const createType = p.isStartPhase === true ? "start" : "normal";
    await tx.phase.upsert({
      where:  { workId_phaseKey: { workId, phaseKey: p.phaseKey } },
      create: {
        workId, phaseKey: p.phaseKey, name: p.name, phaseType: createType,
        sortOrder: p.displayOrder ?? 0, isActive: p.isActive ?? true,
        ...(p.startTrigger !== null ? { startTrigger: p.startTrigger } : {}),
        ...(p.summary !== null ? { resumeSummary: p.summary } : {}),
      },
      update: {
        name: p.name,
        ...(p.displayOrder !== null ? { sortOrder: p.displayOrder } : {}),
        ...(p.isActive !== null ? { isActive: p.isActive } : {}),
        ...(p.startTrigger !== null ? { startTrigger: p.startTrigger } : {}),
        ...(p.summary !== null ? { resumeSummary: p.summary } : {}),
        ...(p.isStartPhase === true ? { phaseType: "start" } : {}), // 既存 ending 等は維持
      },
    });
  }

  // 3. key→id 解決（新規 upsert 済 + 既存DB分の両方を含む）
  const refPhaseKeys = new Set<string>();
  n.phases.forEach((p) => refPhaseKeys.add(p.phaseKey));
  n.messages.forEach((m) => {
    if (m.phaseKey) refPhaseKeys.add(m.phaseKey);
    if (m.nextPhaseKey) refPhaseKeys.add(m.nextPhaseKey);
    m.choices.forEach((c) => { if (c.nextPhaseKey) refPhaseKeys.add(c.nextPhaseKey); });
  });
  const refCharKeys = new Set<string>();
  n.messages.forEach((m) => { if (m.kind === "line" && m.characterKey) refCharKeys.add(m.characterKey); });

  const phaseRows = await tx.phase.findMany({ where: { workId, phaseKey: { in: [...refPhaseKeys] } }, select: { id: true, phaseKey: true } });
  const charRows = await tx.character.findMany({ where: { workId, characterKey: { in: [...refCharKeys] } }, select: { id: true, characterKey: true } });
  const phaseMap = new Map(phaseRows.map((r) => [r.phaseKey!, r.id]));
  const charMap = new Map(charRows.map((r) => [r.characterKey!, r.id]));
  const phaseIdOf = (k: string): string => {
    const id = phaseMap.get(k);
    if (!id) throw new Error(`phase_key 解決失敗: ${k}`); // validate 済のため通常起きない
    return id;
  };
  const characterIdOf = (k: string): string | null => charMap.get(k) ?? null;

  // 4. messages upsert
  for (const m of n.messages) {
    const f = mapMessageFields(m, phaseIdOf, characterIdOf);
    const lag = m.delaySeconds !== null ? { lagMs: m.delaySeconds * 1000 } : {};
    await tx.message.upsert({
      where:  { workId_messageKey: { workId, messageKey: m.messageKey } },
      create: {
        workId, messageKey: m.messageKey, phaseId: phaseIdOf(m.phaseKey),
        messageType: f.messageType, kind: f.kind, body: f.body, characterId: f.characterId,
        assetUrl: f.assetUrl, quickReplies: f.quickReplies,
        sortOrder: m.sortOrder ?? 0, isActive: true,
        lagMs: m.delaySeconds !== null ? m.delaySeconds * 1000 : 0,
      },
      update: {
        phaseId: phaseIdOf(m.phaseKey),
        messageType: f.messageType, kind: f.kind, body: f.body, characterId: f.characterId,
        assetUrl: f.assetUrl, quickReplies: f.quickReplies,
        sortOrder: m.sortOrder ?? 0, ...lag,
      },
    });
  }

  // 5. input_wait 由来の transition upsert（(workId, fromPhaseId, condition) で冪等）
  for (const m of n.messages) {
    if (m.kind !== "input_wait" || !m.phaseKey || !m.nextPhaseKey || !m.responseKeyword) continue;
    const fromPhaseId = phaseIdOf(m.phaseKey);
    const toPhaseId = phaseIdOf(m.nextPhaseKey);
    const condition = m.responseKeyword;
    const existing = await tx.transition.findFirst({ where: { workId, fromPhaseId, condition }, select: { id: true } });
    if (existing) {
      await tx.transition.update({ where: { id: existing.id }, data: { toPhaseId, label: condition, isActive: true } });
    } else {
      await tx.transition.create({
        data: { workId, fromPhaseId, toPhaseId, label: condition, condition, sortOrder: m.sortOrder ?? 0, setFlags: "{}", isActive: true },
      });
    }
  }
}
