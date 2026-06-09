// src/lib/liff/submission.ts
//
// LIFF フォーム/アンケート送信（LiffSubmission）の純関数群。
//  - 書き込み側: survey_items + 回答マップ → ブロック配列（buildSubmissionAnswers）
//  - 読み取り側: answersJson から防御的にブロック配列を取り出す（extractAnswerBlocks）
//  - 集計（設問別）/ CSV 生成
// JSON は欠損フィールドがあっても落ちないよう defensive に扱う。

import type { SurveyItem, SurveyInputType } from "@/types";

export type SubmissionAnswerType = "text" | "singleChoice" | "multipleChoice";

export interface SubmissionAnswerBlock {
  blockId:    string;
  blockType:  string; // 例: "survey"
  label:      string;
  answerType: SubmissionAnswerType;
  value:      string | string[];
}

/** survey の入力タイプ → 回答タイプ。 */
export function mapAnswerType(input: SurveyInputType | string | undefined): SubmissionAnswerType {
  if (input === "radio") return "singleChoice";
  if (input === "checkbox") return "multipleChoice";
  return "text"; // text / textarea / 未知
}

/** SurveyRenderer の itemKey と同一規則（item.id || `q${idx}`）。 */
function itemKey(item: SurveyItem, idx: number): string {
  return item.id || `q${idx}`;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** survey_items + 回答マップ（{ [questionId]: string | string[] }）→ 保存用ブロック配列。
 *  空回答の設問はスキップする。 */
export function buildSubmissionAnswers(
  items: SurveyItem[] | undefined | null,
  answers: Record<string, string | string[]> | undefined | null,
): SubmissionAnswerBlock[] {
  if (!Array.isArray(items) || !answers || typeof answers !== "object") return [];
  const out: SubmissionAnswerBlock[] = [];
  items.forEach((it, i) => {
    const key = itemKey(it, i);
    const v = (answers as Record<string, string | string[]>)[key];
    if (isEmptyValue(v)) return;
    out.push({
      blockId:    key,
      blockType:  "survey",
      label:      it.question || `Q${i + 1}`,
      answerType: mapAnswerType(it.input_type),
      value:      Array.isArray(v) ? v.map(String) : String(v),
    });
  });
  return out;
}

/** answersJson から防御的にブロック配列を取り出す。
 *  受理形: { blocks: [...] } / 直接の配列 / それ以外は空配列。 */
export function extractAnswerBlocks(answersJson: unknown): SubmissionAnswerBlock[] {
  const raw =
    answersJson && typeof answersJson === "object" && !Array.isArray(answersJson)
      ? (answersJson as { blocks?: unknown }).blocks
      : answersJson;
  if (!Array.isArray(raw)) return [];
  const VALID: SubmissionAnswerType[] = ["text", "singleChoice", "multipleChoice"];
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => {
      const at = b.answerType;
      const value = b.value;
      return {
        blockId:    typeof b.blockId === "string" ? b.blockId : "",
        blockType:  typeof b.blockType === "string" ? b.blockType : "",
        label:      typeof b.label === "string" ? b.label : "",
        answerType: (VALID.includes(at as SubmissionAnswerType) ? at : "text") as SubmissionAnswerType,
        value:      Array.isArray(value) ? value.map(String) : value == null ? "" : String(value),
      };
    });
}

/** 表示用に回答値を文字列へ。配列は「 / 」区切り。 */
export function answerValueToText(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" / ") : value;
}

// ─────────────────────────────────────────────────────────────
// 設問別集計
// ─────────────────────────────────────────────────────────────

export interface QuestionAggregation {
  blockId:    string;
  label:      string;
  answerType: SubmissionAnswerType;
  /** 回答した件数（このブロックに回答があった submission 数）。 */
  responseCount: number;
  /** 選択式: 選択肢ごとの件数（多い順）。 */
  choices?: { value: string; count: number; percent: number }[];
  /** 自由記述: 回答テキスト一覧（新しい順は呼出側で submissions を並べて渡す）。 */
  texts?: { value: string; lineUserId: string | null; displayName: string | null; createdAt: string }[];
}

export interface SubmissionRow {
  lineUserId:  string | null;
  displayName: string | null;
  createdAt:   string;
  blocks:      SubmissionAnswerBlock[];
}

/** submissions を設問（blockId）単位で集計する。設問の出現順を保つ。 */
export function aggregateByQuestion(rows: SubmissionRow[]): QuestionAggregation[] {
  const order: string[] = [];
  const map = new Map<string, QuestionAggregation>();

  for (const row of rows) {
    for (const b of row.blocks) {
      const key = b.blockId || b.label;
      if (!map.has(key)) {
        order.push(key);
        map.set(key, {
          blockId: b.blockId,
          label: b.label || "(無題の設問)",
          answerType: b.answerType,
          responseCount: 0,
          ...(b.answerType === "text" ? { texts: [] } : { choices: [] }),
        });
      }
      const agg = map.get(key)!;
      const empty = isEmptyValue(b.value);
      if (!empty) agg.responseCount += 1;

      if (b.answerType === "text") {
        if (!empty) agg.texts!.push({ value: answerValueToText(b.value), lineUserId: row.lineUserId, displayName: row.displayName, createdAt: row.createdAt });
      } else {
        const vals = Array.isArray(b.value) ? b.value : [b.value];
        for (const raw of vals) {
          const v = String(raw).trim();
          if (!v) continue;
          const existing = agg.choices!.find((c) => c.value === v);
          if (existing) existing.count += 1;
          else agg.choices!.push({ value: v, count: 1, percent: 0 });
        }
      }
    }
  }

  // choices をパーセント計算 + 多い順
  for (const agg of map.values()) {
    if (agg.choices) {
      const total = agg.choices.reduce((s, c) => s + c.count, 0);
      agg.choices.forEach((c) => { c.percent = total > 0 ? Math.round((c.count / total) * 100) : 0; });
      agg.choices.sort((a, b) => b.count - a.count);
    }
  }

  return order.map((k) => map.get(k)!);
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 回答 1 ブロック = 1 行の CSV（BOM 付き UTF-8）。回答が無い submission も 1 行出す。 */
export function buildSubmissionsCsv(rows: SubmissionRow[]): string {
  const header = ["回答日時", "LINE userId", "表示名", "設問タイトル", "回答", "blockId", "answerType"];
  const lines: string[][] = [header];
  for (const r of rows) {
    if (r.blocks.length === 0) {
      lines.push([r.createdAt, r.lineUserId ?? "", r.displayName ?? "", "", "", "", ""]);
      continue;
    }
    for (const b of r.blocks) {
      lines.push([
        r.createdAt,
        r.lineUserId ?? "",
        r.displayName ?? "",
        b.label,
        answerValueToText(b.value),
        b.blockId,
        b.answerType,
      ]);
    }
  }
  const body = lines.map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  return "\uFEFF" + body;
}
