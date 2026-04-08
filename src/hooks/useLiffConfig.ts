"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック

import { useEffect, useState, useCallback } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageBlock, LiffBlockType } from "@/types";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  workTitle: string;
  editingBlockId: string | null;

  // ── Config 操作 ──
  toggleEnabled: () => Promise<void>;
  updateConfigField: (field: "title" | "description", value: string | null) => Promise<void>;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;

  // ── Block 操作 ──
  addBlock: (blockType: LiffBlockType) => Promise<void>;
  updateBlock: (block: LiffPageBlock) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  toggleBlockEnabled: (block: LiffPageBlock) => Promise<void>;
  moveBlock: (idx: number, direction: "up" | "down") => Promise<void>;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => Promise<void>;

  // ── Local 編集 ──
  setEditingBlockId: (id: string | null) => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

  // ── リフレッシュ ──
  reload: () => Promise<void>;
}

export function useLiffConfig(
  workId: string,
  opts: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void } = {}
): UseLiffConfigReturn {
  const [config, setConfig] = useState<LiffPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workTitle, setWorkTitle] = useState("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const token = getDevToken();
  const { onSuccess, onError } = opts;

  const reload = useCallback(async () => {
    try {
      const [cfg, work] = await Promise.all([
        liffConfigApi.get(token, workId),
        workApi.get(token, workId),
      ]);
      setConfig(cfg);
      setWorkTitle(work.title);
    } catch {
      onError?.("LIFF設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, workId, onError]);

  useEffect(() => { reload(); }, [reload]);

  // ── Config 操作 ──────────────────────────────
  const toggleEnabled = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { is_enabled: !config.is_enabled });
      setConfig(updated);
      onSuccess?.(updated.is_enabled ? "LIFFを有効にしました" : "LIFFを無効にしました");
    } catch {
      onError?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigField = useCallback(async (field: "title" | "description", value: string | null) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { [field]: value || null });
      setConfig(updated);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...patch });
  }, [config]);

  // ── Block 操作 ──────────────────────────────
  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    setSaving(true);
    try {
      const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
      const entry = BLOCK_TYPE_REGISTRY[blockType];
      await liffConfigApi.createBlock(token, workId, {
        block_type: blockType,
        title: entry.label,
        settings_json: entry.defaultSettings,
      });
      await reload();
      onSuccess?.("ブロックを追加しました");
    } catch {
      onError?.("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const updateBlock = useCallback(async (block: LiffPageBlock) => {
    setSaving(true);
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, {
        title: block.title,
        is_enabled: block.is_enabled,
        settings_json: block.settings_json as Record<string, unknown>,
        visibility_condition_json: block.visibility_condition_json,
      });
      await reload();
      setEditingBlockId(null);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!confirm("このブロックを削除しますか？")) return;
    setSaving(true);
    try {
      await liffConfigApi.deleteBlock(token, workId, blockId);
      await reload();
      if (editingBlockId === blockId) setEditingBlockId(null);
      onSuccess?.("削除しました");
    } catch {
      onError?.("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, editingBlockId, onSuccess, onError]);

  const toggleBlockEnabled = useCallback(async (block: LiffPageBlock) => {
    // optimistic update
    updateBlockLocal(block.id, { is_enabled: !block.is_enabled });
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, { is_enabled: !block.is_enabled });
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    }
  }, [token, workId, reload, onError]);

  const moveBlock = useCallback(async (idx: number, direction: "up" | "down") => {
    if (!config) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= config.blocks.length) return;
    const newBlocks = [...config.blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const reorderBlocks = useCallback(async (newBlocks: LiffPageBlock[]) => {
    if (!config) return;
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  // ── Local 編集 ──────────────────────────────
  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    if (!config) return;
    setConfig({
      ...config,
      blocks: config.blocks.map((b) => b.id === blockId ? { ...b, ...patch } : b),
    });
  }, [config]);

  return {
    config, loading, saving, workTitle, editingBlockId,
    toggleEnabled, updateConfigField, updateConfigLocal,
    addBlock, updateBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, updateBlockLocal,
    reload,
  };
}
