// _node-graph/hooks/use-operation-tracker.ts — 操作ログの軽量計測

import { useCallback, useRef } from "react";

// ── Tracker Interface ──────────────────────────────
export type OperationType =
  | "phase_create"
  | "phase_duplicate"
  | "phase_delete"
  | "phase_bulk_delete"
  | "transition_create"
  | "transition_delete"
  | "auto_layout"
  | "search"
  | "context_menu"
  | "undo"
  | "redo"
  | "edge_drag_create"; // エッジドラッグからの新規作成

export interface OperationEvent {
  type: OperationType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 操作ログ送信先の抽象インターフェース。
 * デフォルトは no-op。将来 analytics サービスに差し替え可能。
 *
 * 実装例:
 * - ConsoleTracker: dev 用に console.log
 * - ApiTracker: POST /api/analytics/events
 * - MixpanelTracker: mixpanel.track()
 */
export interface OperationTrackerSink {
  track(event: OperationEvent): void;
  flush?(): void;
}

/** dev 用: console に出力するだけの sink */
export const consoleTrackerSink: OperationTrackerSink = {
  track(event) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[graph-tracker]", event.type, event.metadata ?? "");
    }
  },
};

/** 本番用デフォルト: 何もしない */
export const noopTrackerSink: OperationTrackerSink = {
  track() {},
};

// ── Hook ────────────────────────────────────────────
export function useOperationTracker(sink: OperationTrackerSink = noopTrackerSink) {
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  const track = useCallback((type: OperationType, metadata?: Record<string, unknown>) => {
    sinkRef.current.track({
      type,
      timestamp: Date.now(),
      metadata,
    });
  }, []);

  return { track };
}
