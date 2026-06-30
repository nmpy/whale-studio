// src/lib/spreadsheet-import/normalize.ts
// RawSheets（文字列セル）→ 型付き NormalizedSheets。trim / 数値・真偽の解釈 / message_kind の enum 正規化。
// 解釈不能（数値・真偽・kind）は null にし、validate 側で raw を見てエラー判定する（即時 throw しない）。

import type { RawRow, RawSheets, NormalizedSheets, NormCharacter, NormPhase, NormMessage, NormChoice, MessageKind } from "./types";
import { MESSAGE_KIND_ALIASES } from "./types";

function s(row: RawRow, key: string): string {
  return String(row[key] ?? "").trim();
}
function orNull(v: string): string | null {
  return v === "" ? null : v;
}
/** 数値化。空や非数値は null。 */
function num(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** TRUE/FALSE 等を boolean に。空は null（未入力）。解釈不能も null（validate で raw を見て判定）。 */
function bool(v: string): boolean | null {
  if (v === "") return null;
  const t = v.toLowerCase();
  if (["true", "1", "yes", "y", "○", "はい"].includes(t)) return true;
  if (["false", "0", "no", "n", "×", "いいえ"].includes(t)) return false;
  return null;
}
function kind(v: string): MessageKind | null {
  return MESSAGE_KIND_ALIASES[v.trim()] ?? MESSAGE_KIND_ALIASES[v.trim().toLowerCase()] ?? null;
}

export function normalizeCharacter(row: RawRow): NormCharacter {
  const displayOrderRaw = s(row, "display_order");
  return {
    row: row._row,
    characterKey: s(row, "character_key"),
    name: s(row, "name"),
    iconImageUrl: orNull(s(row, "icon_image_url")),
    displayOrderRaw,
    displayOrder: num(displayOrderRaw),
  };
}
export function normalizePhase(row: RawRow): NormPhase {
  const displayOrderRaw = s(row, "display_order");
  const isStartPhaseRaw = s(row, "is_start_phase");
  const isActiveRaw = s(row, "is_active");
  return {
    row: row._row,
    phaseKey: s(row, "phase_key"),
    name: s(row, "name"),
    displayOrderRaw,
    displayOrder: num(displayOrderRaw),
    isStartPhaseRaw,
    isStartPhase: bool(isStartPhaseRaw),
    startTrigger: orNull(s(row, "start_trigger")),
    summary: orNull(s(row, "summary")),
    isActiveRaw,
    isActive: bool(isActiveRaw),
  };
}
export function normalizeMessage(row: RawRow): NormMessage {
  const choices: NormChoice[] = [1, 2, 3, 4].map((n) => ({
    n,
    label: orNull(s(row, `choice_${n}_label`)),
    nextPhaseKey: orNull(s(row, `choice_${n}_next_phase_key`)),
  }));
  const sortOrderRaw = s(row, "sort_order");
  const kindRaw = s(row, "message_kind");
  const delayRaw = s(row, "delay_seconds");
  return {
    row: row._row,
    messageKey: s(row, "message_key"),
    phaseKey: s(row, "phase_key"),
    sortOrderRaw,
    sortOrder: num(sortOrderRaw),
    kindRaw,
    kind: kind(kindRaw),
    characterKey: orNull(s(row, "character_key")),
    content: orNull(s(row, "content")),
    imageUrl: orNull(s(row, "image_url")),
    choices,
    responseKeyword: orNull(s(row, "response_keyword")),
    nextPhaseKey: orNull(s(row, "next_phase_key")),
    delayRaw,
    delaySeconds: num(delayRaw),
  };
}

export function normalizeSheets(raw: RawSheets): NormalizedSheets {
  return {
    characters: (raw.characters ?? []).map(normalizeCharacter),
    phases: (raw.phases ?? []).map(normalizePhase),
    messages: (raw.messages ?? []).map(normalizeMessage),
  };
}
