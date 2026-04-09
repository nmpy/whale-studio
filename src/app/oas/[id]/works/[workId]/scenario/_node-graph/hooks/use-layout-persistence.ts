// _node-graph/hooks/use-layout-persistence.ts — レイアウト永続化（storage adapter 抽象化）

import { useCallback, useEffect, useRef } from "react";
import type { Node } from "@xyflow/react";

// ── Storage Adapter ─────────────────────────────────
/**
 * ノード位置の永続化先を抽象化するインターフェース。
 *
 * 実装例:
 * - localStorageAdapter（デフォルト）: ブラウザローカルに保存
 * - apiAdapter（将来）: POST /api/works/{workId}/layout で DB 保存
 *
 * 責務:
 * - load: 保存済み位置を読む。データ不正 or 未保存なら null を返す。
 * - save: 位置を保存する。失敗時は UI を止めない（console.warn 程度）。
 * - clear: 保存データを削除する。失敗は致命扱いしない。
 *
 * 入出力形式（将来 API adapter の参考）:
 *   load  → GET /api/works/{workId}/layout → { positions: PositionMap } | 404
 *   save  → PUT /api/works/{workId}/layout { positions: PositionMap } → 200
 *   clear → DELETE /api/works/{workId}/layout → 204
 */
export interface LayoutStorageAdapter {
  load(workId: string): PositionMap | null;
  save(workId: string, positions: PositionMap): void;
  clear(workId: string): void;
}

export interface PositionMap {
  [nodeId: string]: { x: number; y: number };
}

// ── localStorage 実装 ───────────────────────────────
const STORAGE_PREFIX = "ng-layout-";

export const localStorageAdapter: LayoutStorageAdapter = {
  load(workId: string): PositionMap | null {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${workId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      for (const val of Object.values(parsed)) {
        const v = val as { x?: unknown; y?: unknown };
        if (typeof v.x !== "number" || typeof v.y !== "number") return null;
      }
      return parsed as PositionMap;
    } catch {
      // parse 失敗 → null で fallback（UI は止めない）
      return null;
    }
  },
  save(workId: string, positions: PositionMap): void {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${workId}`, JSON.stringify(positions));
    } catch {
      // localStorage full/unavailable → console warn のみ
      if (process.env.NODE_ENV === "development") {
        console.warn("[layout-persistence] save failed for", workId);
      }
    }
  },
  clear(workId: string): void {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${workId}`);
    } catch {
      // 致命扱いしない
    }
  },
};

// ── Hook ────────────────────────────────────────────
export function useLayoutPersistence(
  workId: string,
  adapter: LayoutStorageAdapter = localStorageAdapter,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const applyPersistedPositions = useCallback((nodes: Node[]): Node[] => {
    const saved = adapter.load(workId);
    if (!saved) return nodes;
    return nodes.map(node => {
      const pos = saved[node.id];
      return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
    });
  }, [workId, adapter]);

  const hasPersistedLayout = useCallback((): boolean => {
    return adapter.load(workId) !== null;
  }, [workId, adapter]);

  const persistPositions = useCallback((nodes: Node[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const positions: PositionMap = {};
      for (const node of nodes) {
        positions[node.id] = { x: node.position.x, y: node.position.y };
      }
      adapter.save(workId, positions);
    }, 500);
  }, [workId, adapter]);

  const clearPersistedLayout = useCallback(() => {
    adapter.clear(workId);
  }, [workId, adapter]);

  return { applyPersistedPositions, hasPersistedLayout, persistPositions, clearPersistedLayout };
}
