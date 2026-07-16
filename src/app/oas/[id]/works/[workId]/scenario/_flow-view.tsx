"use client";

// scenario/_flow-view.tsx
// 「フェーズフロー」表示（読み取り専用）。既存のフェーズ／遷移データをノードグラフとして可視化する。
//   - 縦(TB)/横(LR) レイアウト切替（初期は横）。
//   - 状態: 読み込み中 / 0件 / 遷移なし / 壊れた参照あり / 取得エラー。
//   - 編集は既存のフェーズ編集画面へ遷移、削除は既存の削除処理を再利用（別処理を作らない）。
//   - 書き込みは一切しない（配置保存・遷移作成・条件編集は本ビューでは行わない）。

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import type { PhaseWithCounts, TransitionWithPhases } from "@/types";
import { buildFlowGraph } from "./_flow/build-graph";
import type { FlowDirection } from "./_flow/layout";
import { FlowCanvas } from "./_flow/FlowCanvas";
import type { FlowActions } from "./_flow/context";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

export interface PhaseFlowViewProps {
  phases: PhaseWithCounts[];
  transitions: TransitionWithPhases[];
  oaId: string;
  workId: string;
  canEdit: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAddPhase: () => void;
  /** 既存の削除処理（確認込み）を呼ぶ。フロー画面独自の削除処理は作らない。 */
  onDeletePhase: (phaseId: string, name: string) => void;
}

export function PhaseFlowView({
  phases, transitions, oaId, workId, canEdit, loading, error, onRetry, onAddPhase, onDeletePhase,
}: PhaseFlowViewProps) {
  const router = useRouter();
  const [direction, setDirection] = useState<FlowDirection>("LR"); // 初期は横

  const hrefFor = useMemo(
    () => (phaseId: string) => `/oas/${oaId}/works/${workId}/phases/${phaseId}`,
    [oaId, workId],
  );

  const graph = useMemo(() => buildFlowGraph(phases, transitions, hrefFor), [phases, transitions, hrefFor]);

  // 壊れた遷移参照は開発環境でのみ確認できるログを出す（本文・機密は出さない）。
  useEffect(() => {
    if (graph.warnings.length > 0 && process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[phase-flow] ${graph.warnings.length} 件の壊れた遷移参照を除外しました:`, graph.warnings);
    }
  }, [graph.warnings]);

  const actions: FlowActions = useMemo(() => ({
    direction,
    canEdit,
    onEdit: (phaseId: string) => router.push(hrefFor(phaseId)),
    onDelete: (phaseId: string, name: string) => onDeletePhase(phaseId, name),
  }), [direction, canEdit, router, hrefFor, onDeletePhase]);

  const dirBtn = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700,
    background: active ? "#06C755" : "transparent", color: active ? "#fff" : "#6b7280",
  });

  return (
    <div>
      {/* フロー用ヘッダー: 縦/横 レイアウト切替 */}
      <div className="mb-3 flex items-center gap-2">
        <div role="group" aria-label="レイアウト方向" className="inline-flex rounded-lg border border-line bg-surface p-1">
          <button type="button" aria-pressed={direction === "TB"} onClick={() => setDirection("TB")} style={dirBtn(direction === "TB")}>縦</button>
          <button type="button" aria-pressed={direction === "LR"} onClick={() => setDirection("LR")} style={dirBtn(direction === "LR")}>横</button>
        </div>
        <span className="text-[12px] text-ink-3">フェーズの順序・分岐・収束を俯瞰できます</span>
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-line"
        style={{ height: "min(72vh, 760px)", minHeight: 460, background: "#F4F6F8" }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center"><InlineWhaleLoader /></div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-[13px] text-ink-2">フローの読み込みに失敗しました</p>
            <button type="button" onClick={onRetry} className="rounded-md border border-line bg-white px-3 py-1.5 text-[13px] text-ink hover:border-brand hover:text-brand-ink">再読み込み</button>
          </div>
        ) : phases.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-[14px] font-semibold text-ink">まだフェーズがありません</p>
            <p className="text-[12px] leading-[1.7] text-ink-3">「フェーズを追加」からシナリオの構成要素を作成しましょう。</p>
            <button type="button" onClick={onAddPhase} className="rounded-full bg-brand px-4 py-2 text-[13px] font-bold text-white">＋ フェーズを追加</button>
          </div>
        ) : (
          <>
            <ReactFlowProvider>
              <FlowCanvas nodes={graph.nodes} edges={graph.edges} direction={direction} actions={actions} />
            </ReactFlowProvider>
            {graph.edges.length === 0 && (
              <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-line bg-white/90 px-3 py-1 text-[12px] text-ink-3 shadow-sm">
                フェーズ間の遷移はまだ設定されていません
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
