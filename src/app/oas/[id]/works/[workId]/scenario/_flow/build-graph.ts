// scenario/_flow/build-graph.ts
// 既存のフェーズ／遷移データ（PhaseWithCounts[] / TransitionWithPhases[]）を、フロー表示用の
// プレーンなノード・エッジ配列へ変換する純関数。React Flow / dagre / DOM に依存しない（テスト可能）。
//
// 設計方針:
//   - 新しいデータモデルは作らない。既存の保存形式のみを読み取り、表示用に写像する。
//   - 壊れた遷移参照（削除済みフェーズを指す等）は線を除外し警告を返す（画面全体をクラッシュさせない）。
//   - 循環参照・自己参照があっても集計は有限で終わる（分岐は単純カウント、到達判定はしない）。
//   - 機密情報・フェーズ本文はここでは扱わない（name / 種別 / 件数 / 条件ラベルのみ）。

import type { PhaseWithCounts, TransitionWithPhases } from "@/types";
import type { EdgeTone } from "./constants";

// React Flow v12 のノード data 制約（Record<string, unknown>）を満たすため interface ではなく type で定義。
export type FlowNodeData = {
  id: string;
  phaseType: string;        // "start" | "normal" | "ending" | "global"
  name: string;
  msgCount: number;         // メッセージ件数（_count.messages）
  branchCount: number;      // 分岐数（このフェーズからの遷移本数）
  isStart: boolean;
  isEnding: boolean;
  isDraft: boolean;         // is_active === false
  isUnconnected: boolean;   // 入次数 0 かつ 出次数 0（フローから孤立）
  href: string;             // 既存のフェーズ編集画面 URL
}

export interface FlowEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;            // 表示ラベル（色に依存せずテキストでも条件を伝える）
  tone: EdgeTone;
}

export interface FlowGraph {
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  /** 壊れた遷移参照など（開発環境ログ用・本文/機密は含めない）。 */
  warnings: string[];
}

/** 遷移の label / condition / flag_condition から表示ラベルとトーンを決める（色のみに依存させない）。 */
export function edgeToneAndLabel(t: {
  label: string;
  condition: string | null;
  flag_condition: string | null;
}): { label: string; tone: EdgeTone } {
  const raw = (t.label ?? "").trim();
  const l = raw.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => l.includes(k));

  // トーン推定（正解=緑 / 不正解=赤 / ヒント・時間切れ・部分・警告=橙 / それ以外=グレー）。
  let tone: EdgeTone = "muted";
  if (has("不正解", "incorrect", "wrong", "✗", "×", "失敗", "未達")) tone = "ng";
  else if (has("正解", "correct", "✓", "○", "クリア", "達成", "成功")) tone = "ok";
  else if (has("ヒント", "hint", "時間切れ", "timeout", "無応答", "部分", "partial", "警告")) tone = "warn";

  // 表示ラベル: 明示ラベル > 条件式 > フラグ条件 > 自動遷移。
  let label = raw;
  if (!label) {
    if (t.condition && t.condition.trim()) label = `🔑 ${t.condition.trim()}`;
    else if (t.flag_condition && t.flag_condition.trim()) label = "フラグ条件";
    else label = "自動遷移";
  }
  if (label.length > 16) label = label.slice(0, 16) + "…";
  return { label, tone };
}

/**
 * フェーズ＋遷移 → フロー表示用グラフ（純関数・決定論的）。
 * @param hrefFor フェーズ id → 既存のフェーズ編集画面 URL を返す関数
 */
export function buildFlowGraph(
  phases: PhaseWithCounts[],
  transitions: TransitionWithPhases[],
  hrefFor: (phaseId: string) => string,
): FlowGraph {
  const idset = new Set(phases.map((p) => p.id));
  const warnings: string[] = [];

  // 有効な遷移のみで入次数・出次数を数える（分岐数 = 出次数、孤立判定 = 入次数0 かつ 出次数0）。
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const t of transitions) {
    const okFrom = idset.has(t.from_phase_id);
    const okTo = idset.has(t.to_phase_id);
    if (okFrom && okTo) {
      outCount.set(t.from_phase_id, (outCount.get(t.from_phase_id) ?? 0) + 1);
      inCount.set(t.to_phase_id, (inCount.get(t.to_phase_id) ?? 0) + 1);
    }
  }

  const nodes: FlowNodeData[] = phases.map((p) => {
    const out = outCount.get(p.id) ?? 0;
    const inc = inCount.get(p.id) ?? 0;
    return {
      id: p.id,
      phaseType: p.phase_type,
      name: p.name,
      msgCount: p._count?.messages ?? 0,
      // 分岐数 = 実際に描画される有効な遷移の出次数。_count.transitionsFrom は壊れた参照も数える
      // ため使わない（描画されない線を「N分岐」と誤表示しないため、表示と件数を一致させる）。
      branchCount: out,
      isStart: p.phase_type === "start",
      isEnding: p.phase_type === "ending",
      isDraft: p.is_active === false,
      isUnconnected: out === 0 && inc === 0,
      href: hrefFor(p.id),
    };
  });

  const edges: FlowEdgeData[] = [];
  const seen = new Set<string>();
  for (const t of transitions) {
    if (!idset.has(t.from_phase_id) || !idset.has(t.to_phase_id)) {
      // 壊れた遷移参照（削除済み/取得不能なフェーズ）→ 線を除外し警告のみ（本文/機密は出さない）。
      warnings.push(`transition ${t.id}: unresolved phase reference`);
      continue;
    }
    if (seen.has(t.id)) continue; // 念のため id 重複を除外（重複線を作らない）
    seen.add(t.id);
    const { label, tone } = edgeToneAndLabel(t);
    edges.push({ id: t.id, source: t.from_phase_id, target: t.to_phase_id, label, tone });
  }

  return { nodes, edges, warnings };
}
