// src/lib/spreadsheet-import/validate.ts
// 取り込みデータの検証（純ロジック）。raw(シート/カラム存在) + normalized(値) + existing(DB スナップショット) を受け取り、
// ImportError[] を返す。DB アクセスはしない（existing は route が構築）。

import type { RawSheets, NormalizedSheets, ExistingData, ImportError, SheetName } from "./types";
import { REQUIRED_COLUMNS } from "./types";

function headerSet(rows: RawSheets[SheetName]): Set<string> {
  if (!rows || rows.length === 0) return new Set();
  return new Set(Object.keys(rows[0]).filter((k) => k !== "_row"));
}
function dupKeys(values: { row: number; key: string }[]): { row: number; key: string }[] {
  const seen = new Map<string, number>();
  const dups: { row: number; key: string }[] = [];
  for (const v of values) {
    if (!v.key) continue;
    if (seen.has(v.key)) dups.push(v);
    else seen.set(v.key, v.row);
  }
  return dups;
}

export function validateImport(raw: RawSheets, n: NormalizedSheets, existing: ExistingData): ImportError[] {
  const errors: ImportError[] = [];
  const add = (sheet: SheetName | "file", row: number, code: ImportError["code"], message: string, column?: string) =>
    errors.push({ sheet, row, code, message, column });

  // 0. 必須シート
  (["characters", "phases", "messages"] as SheetName[]).forEach((sh) => {
    if (raw[sh] === null) add("file", 0, "SHEET_MISSING", `必須シート「${sh}」がありません`);
  });

  // 1. 必須カラム（行があるシートのみ）
  (["characters", "phases", "messages"] as SheetName[]).forEach((sh) => {
    if (!raw[sh] || raw[sh]!.length === 0) return;
    const cols = headerSet(raw[sh]);
    for (const req of REQUIRED_COLUMNS[sh]) {
      if (!cols.has(req)) add(sh, 1, "COLUMN_MISSING", `必須カラム「${req}」がありません`, req);
    }
  });

  // 参照集合
  const sheetPhaseKeys = new Set(n.phases.map((p) => p.phaseKey).filter(Boolean));
  const sheetCharKeys = new Set(n.characters.map((c) => c.characterKey).filter(Boolean));
  const allPhaseKeys = new Set([...sheetPhaseKeys, ...existing.phaseKeys]);
  const allCharKeys = new Set([...sheetCharKeys, ...existing.characterKeys]);

  // 2. characters
  for (const c of n.characters) {
    if (!c.characterKey) add("characters", c.row, "REQUIRED", "character_key は必須です", "character_key");
    if (!c.name) add("characters", c.row, "REQUIRED", "name は必須です", "name");
    if (c.displayOrderRaw !== "" && c.displayOrder === null) add("characters", c.row, "NOT_NUMBER", "display_order は数値で入力してください", "display_order");
  }
  for (const d of dupKeys(n.characters.map((c) => ({ row: c.row, key: c.characterKey })))) add("characters", d.row, "DUPLICATE_KEY", `character_key「${d.key}」が重複しています`, "character_key");

  // 3. phases
  for (const p of n.phases) {
    if (!p.phaseKey) add("phases", p.row, "REQUIRED", "phase_key は必須です", "phase_key");
    if (!p.name) add("phases", p.row, "REQUIRED", "name は必須です", "name");
    if (p.displayOrderRaw !== "" && p.displayOrder === null) add("phases", p.row, "NOT_NUMBER", "display_order は数値で入力してください", "display_order");
    if (p.isStartPhaseRaw !== "" && p.isStartPhase === null) add("phases", p.row, "BAD_BOOL", "is_start_phase は TRUE/FALSE で入力してください", "is_start_phase");
    if (p.isActiveRaw !== "" && p.isActive === null) add("phases", p.row, "BAD_BOOL", "is_active は TRUE/FALSE で入力してください", "is_active");
  }
  for (const d of dupKeys(n.phases.map((p) => ({ row: p.row, key: p.phaseKey })))) add("phases", d.row, "DUPLICATE_KEY", `phase_key「${d.key}」が重複しています`, "phase_key");

  // 3b. 開始フェーズ重複（ファイル内 + DB 既存）
  const startRows = n.phases.filter((p) => p.isStartPhase === true);
  if (startRows.length > 1) startRows.slice(1).forEach((p) => add("phases", p.row, "START_PHASE_MULTIPLE", "is_start_phase=true のフェーズが複数あります（1つだけにしてください）", "is_start_phase"));
  if (startRows.length >= 1 && existing.existingStartPhase) {
    const k = startRows[0].phaseKey;
    if (existing.existingStartPhase.phaseKey !== k) {
      add("phases", startRows[0].row, "START_PHASE_CONFLICT",
        "既に別の開始フェーズが存在します。開始フェーズの自動切り替えはできません（既存の開始フェーズの phase_key を更新してください）", "is_start_phase");
    }
  }

  // 4. messages
  const sortByPhase = new Map<string, Map<number, number>>();    // phaseKey → sortOrder → 初出row
  const kwByPhase = new Map<string, Map<string, number>>();      // phaseKey → response_keyword → 初出row
  for (const m of n.messages) {
    if (!m.messageKey) add("messages", m.row, "REQUIRED", "message_key は必須です", "message_key");
    if (!m.phaseKey) add("messages", m.row, "REQUIRED", "phase_key は必須です", "phase_key");
    if (m.sortOrderRaw === "") add("messages", m.row, "REQUIRED", "sort_order は必須です", "sort_order");
    else if (m.sortOrder === null) add("messages", m.row, "NOT_NUMBER", "sort_order は数値で入力してください", "sort_order");
    if (m.kindRaw === "") add("messages", m.row, "REQUIRED", "message_kind は必須です", "message_kind");
    else if (m.kind === null) add("messages", m.row, "BAD_KIND", `message_kind「${m.kindRaw}」は許可されていません`, "message_kind");

    // phase_key 参照
    if (m.phaseKey && !allPhaseKeys.has(m.phaseKey)) add("messages", m.row, "REF_NOT_FOUND", `phase_key「${m.phaseKey}」が見つかりません`, "phase_key");

    // 同一 phase 内 sort_order 重複
    if (m.phaseKey && m.sortOrder !== null) {
      const mp = sortByPhase.get(m.phaseKey) ?? new Map();
      if (mp.has(m.sortOrder)) add("messages", m.row, "DUP_SORT_ORDER", `phase「${m.phaseKey}」内で sort_order「${m.sortOrder}」が重複しています`, "sort_order");
      else mp.set(m.sortOrder, m.row);
      sortByPhase.set(m.phaseKey, mp);
    }

    // kind 別必須・参照
    switch (m.kind) {
      case "line":
        if (!m.characterKey) add("messages", m.row, "REQUIRED", "セリフ(line)は character_key が必須です", "character_key");
        else if (!allCharKeys.has(m.characterKey)) add("messages", m.row, "REF_NOT_FOUND", `character_key「${m.characterKey}」が見つかりません`, "character_key");
        if (!m.content) add("messages", m.row, "REQUIRED", "セリフ(line)は content が必須です", "content");
        break;
      case "narration":
      case "system":
        if (!m.content) add("messages", m.row, "REQUIRED", `${m.kind} は content が必須です`, "content");
        break;
      case "image":
        if (!m.imageUrl) add("messages", m.row, "REQUIRED", "画像(image)は image_url が必須です", "image_url");
        break;
      case "choice": {
        if (!m.content) add("messages", m.row, "REQUIRED", "選択肢(choice)は content が必須です", "content");
        let valid = 0;
        for (const ch of m.choices) {
          const hasL = !!ch.label, hasN = !!ch.nextPhaseKey;
          if (hasL !== hasN) add("messages", m.row, "CHOICE_PAIR", `choice_${ch.n} は label と next_phase_key を両方入力してください`, `choice_${ch.n}_label`);
          else if (hasL && hasN) {
            valid++;
            if (!allPhaseKeys.has(ch.nextPhaseKey!)) add("messages", m.row, "REF_NOT_FOUND", `choice_${ch.n}_next_phase_key「${ch.nextPhaseKey}」が見つかりません`, `choice_${ch.n}_next_phase_key`);
          }
        }
        if (valid === 0) add("messages", m.row, "CHOICE_NONE", "選択肢(choice)は1つ以上の選択肢が必要です", "choice_1_label");
        break;
      }
      case "input_wait": {
        if (!m.content) add("messages", m.row, "REQUIRED", "入力待ち(input_wait)は content が必須です", "content");
        if (!m.responseKeyword) add("messages", m.row, "REQUIRED", "入力待ち(input_wait)は response_keyword が必須です", "response_keyword");
        if (!m.nextPhaseKey) add("messages", m.row, "REQUIRED", "入力待ち(input_wait)は next_phase_key が必須です", "next_phase_key");
        else if (!allPhaseKeys.has(m.nextPhaseKey)) add("messages", m.row, "REF_NOT_FOUND", `next_phase_key「${m.nextPhaseKey}」が見つかりません`, "next_phase_key");
        if (m.phaseKey && m.responseKeyword) {
          const mp = kwByPhase.get(m.phaseKey) ?? new Map();
          if (mp.has(m.responseKeyword)) add("messages", m.row, "DUP_RESPONSE_KEYWORD", `phase「${m.phaseKey}」内で response_keyword「${m.responseKeyword}」が重複しています`, "response_keyword");
          else mp.set(m.responseKeyword, m.row);
          kwByPhase.set(m.phaseKey, mp);
        }
        break;
      }
      default:
        break; // kind 不正は上で報告済み
    }

    // delay_seconds 範囲（0〜30）
    if (m.delayRaw !== "") {
      if (m.delaySeconds === null) add("messages", m.row, "NOT_NUMBER", "delay_seconds は数値で入力してください", "delay_seconds");
      else if (m.delaySeconds < 0 || m.delaySeconds > 30) add("messages", m.row, "DELAY_RANGE", "delay_seconds は 0〜30 の範囲で入力してください", "delay_seconds");
    }
  }
  for (const d of dupKeys(n.messages.map((m) => ({ row: m.row, key: m.messageKey })))) add("messages", d.row, "DUPLICATE_KEY", `message_key「${d.key}」が重複しています`, "message_key");

  return errors;
}
