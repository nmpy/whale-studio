"use client";

// scenario/_flow/context.ts
// フローノードから使う「操作」を渡す Context。ノード data を純データに保つため、
// 編集/削除ハンドラ・レイアウト方向はここで供給する（既存のフェーズ編集/削除処理を再利用）。

import { createContext, useContext } from "react";
import type { FlowDirection } from "./layout";

export interface FlowActions {
  /** 既存のフェーズ編集画面へ遷移（href は build-graph が付与）。 */
  onEdit: (phaseId: string, name: string) => void;
  /** 既存の削除処理（確認 UI 込み）を呼ぶ。読み取り専用ビューでも削除は既存処理を再利用する。 */
  onDelete: (phaseId: string, name: string) => void;
  direction: FlowDirection;
  /** 編集/削除ボタンを出すか（viewer 等は false）。 */
  canEdit: boolean;
}

export const FlowActionsContext = createContext<FlowActions | null>(null);

export function useFlowActions(): FlowActions {
  const ctx = useContext(FlowActionsContext);
  if (!ctx) throw new Error("useFlowActions must be used within FlowActionsContext");
  return ctx;
}
