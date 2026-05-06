"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック

import { useEffect, useState, useCallback, useRef } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageBlock, LiffBlockType, LiffPageType, LiffPublishStatus, LiffPageConfigSettings } from "@/types";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  workTitle: string;
  editingBlockId: string | null;

  toggleEnabled: () => Promise<void>;
  updateConfigField: (field: "title" | "description", value: string | null) => Promise<void>;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;
  updatePageType: (next: LiffPageType) => Promise<void>;
  updatePublishStatus: (next: LiffPublishStatus) => Promise<void>;
  updateSettingsField: (key: keyof LiffPageConfigSettings, value: unknown) => Promise<void>;

  addBlock: (blockType: LiffBlockType) => Promise<void>;
  updateBlock: (block: LiffPageBlock) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  toggleBlockEnabled: (block: LiffPageBlock) => Promise<void>;
  moveBlock: (idx: number, direction: "up" | "down") => Promise<void>;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => Promise<void>;

  setEditingBlockId: (id: string | null) => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

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

  // 呼び出し側が毎レンダーで新しい inline 関数を渡しても、
  // useCallback / useEffect の deps を不安定にしないよう ref 経由で参照する。
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const onSuccess = useCallback((msg: string) => optsRef.current.onSuccess?.(msg), []);
  const onError = useCallback((msg: string) => optsRef.current.onError?.(msg), []);

  // LIFF設定（必須）と Work 情報（補助）を分けて取得し、
  // 補助側の失敗で「LIFF設定の読み込みに失敗しました」を出さないようにする。
  const reload = useCallback(async () => {
    try {
      const cfg = await liffConfigApi.get(token, workId);
      setConfig(cfg);
    } catch (err) {
      console.error("[useLiffConfig.reload] liff-config get failed", err);
      onError("LIFF設定の読み込みに失敗しました");
    }
    try {
      const work = await workApi.get(token, workId);
      setWorkTitle(work.title);
    } catch (err) {
      // 作品情報はパンくず等の補助表示にしか使っていないので致命扱いしない
      console.warn("[useLiffConfig.reload] work get failed (non-fatal)", err);
    }
    setLoading(false);
  }, [token, workId, onError]);

  useEffect(() => { reload(); }, [reload]);

  const toggleEnabled = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { is_enabled: !config.is_enabled });
      setConfig(updated);
      onSuccess(updated.is_enabled ? "LIFFを有効にしました" : "LIFFを無効にしました");
    } catch (err) {
      console.error("[useLiffConfig.toggleEnabled]", err);
      onError("更新に失敗しました");
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
      onSuccess("保存しました");
    } catch (err) {
      console.error("[useLiffConfig.updateConfigField]", err);
      onError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updatePageType = useCallback(async (next: LiffPageType) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { page_type: next });
      setConfig(updated);
      onSuccess("ページ種別を更新しました");
    } catch (err) {
      console.error("[useLiffConfig.updatePageType]", err);
      onError("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updatePublishStatus = useCallback(async (next: LiffPublishStatus) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { publish_status: next });
      setConfig(updated);
      onSuccess(
        next === "published" ? "公開しました" :
        next === "archived"  ? "アーカイブしました" :
        "下書きに戻しました"
      );
    } catch (err) {
      console.error("[useLiffConfig.updatePublishStatus]", err);
      onError(err instanceof Error ? err.message : "公開に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateSettingsField = useCallback(async (key: keyof LiffPageConfigSettings, value: unknown) => {
    if (!config) return;
    const nextSettings = { ...(config.settings_json ?? {}), [key]: value };
    setConfig({ ...config, settings_json: nextSettings });
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { settings_json: nextSettings });
      setConfig(updated);
    } catch (err) {
      console.error("[useLiffConfig.updateSettingsField]", err);
      onError("更新に失敗しました");
      await reload();
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onError, reload]);

  // 追加・更新・削除は API レスポンスをそのまま local state に反映し、
  // 余分な reload を発火させない（reload が失敗するとトーストが出てしまうため）。
  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    setSaving(true);
    try {
      const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
      const entry = BLOCK_TYPE_REGISTRY[blockType];
      const createdBlock = await liffConfigApi.createBlock(token, workId, {
        block_type: blockType,
        title: entry.label,
        settings_json: entry.defaultSettings,
      });
      setConfig((prev) => (prev ? { ...prev, blocks: [...prev.blocks, createdBlock] } : prev));
      onSuccess("ブロックを追加しました");
    } catch (err) {
      console.error("[useLiffConfig.addBlock]", err);
      onError("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, onSuccess, onError]);

  const updateBlock = useCallback(async (block: LiffPageBlock) => {
    setSaving(true);
    try {
      const updated = await liffConfigApi.updateBlock(token, workId, block.id, {
        title: block.title,
        is_enabled: block.is_enabled,
        settings_json: block.settings_json as Record<string, unknown>,
        visibility_condition_json: block.visibility_condition_json,
      });
      setConfig((prev) =>
        prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)) } : prev
      );
      setEditingBlockId(null);
      onSuccess("保存しました");
    } catch (err) {
      console.error("[useLiffConfig.updateBlock]", err);
      onError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, onSuccess, onError]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!confirm("このブロックを削除しますか？")) return;
    setSaving(true);
    try {
      await liffConfigApi.deleteBlock(token, workId, blockId);
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              blocks: prev.blocks
                .filter((b) => b.id !== blockId)
                .map((b, i) => ({ ...b, sort_order: i })),
            }
          : prev
      );
      setEditingBlockId((cur) => (cur === blockId ? null : cur));
      onSuccess("削除しました");
    } catch (err) {
      console.error("[useLiffConfig.deleteBlock]", err);
      onError("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, onSuccess, onError]);

  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    setConfig((prev) =>
      prev
        ? { ...prev, blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
        : prev
    );
  }, []);

  const toggleBlockEnabled = useCallback(async (block: LiffPageBlock) => {
    updateBlockLocal(block.id, { is_enabled: !block.is_enabled });
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, { is_enabled: !block.is_enabled });
    } catch (err) {
      console.error("[useLiffConfig.toggleBlockEnabled]", err);
      onError("更新に失敗しました");
      await reload();
    }
  }, [token, workId, reload, updateBlockLocal, onError]);

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
    } catch (err) {
      console.error("[useLiffConfig.moveBlock]", err);
      onError("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const reorderBlocks = useCallback(async (newBlocks: LiffPageBlock[]) => {
    if (!config) return;
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch (err) {
      console.error("[useLiffConfig.reorderBlocks]", err);
      onError("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  return {
    config, loading, saving, workTitle, editingBlockId,
    toggleEnabled, updateConfigField, updateConfigLocal,
    updatePageType, updatePublishStatus, updateSettingsField,
    addBlock, updateBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, updateBlockLocal,
    reload,
  };
}
