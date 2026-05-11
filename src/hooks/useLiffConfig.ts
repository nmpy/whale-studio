"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック
//
// 設計メモ:
// - serverConfig (ref) と編集中の config (state) を分離。
//   入力中に save レスポンスで draft を上書きしないことで「文字が消える/巻き戻る」を防ぐ。
// - onSuccess / onError は useRef で保持し reload の dependency に入れない。
// - title / description / settings_json は入力時にローカル即時更新し、800ms debounce で auto-save。
// - 各 save リクエストに seq を付与し、古いレスポンスで新しい入力を上書きしないようにする。
// - block の追加・更新・削除・並び替え・有効化切替では reload() を呼ばずローカルパッチで完結させる。

import { useEffect, useState, useCallback, useRef } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageBlock, LiffBlockType, LiffPageType, LiffPublishStatus } from "@/types";

export type LiffSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  saveStatus: LiffSaveStatus;
  workTitle: string;
  editingBlockId: string | null;

  toggleEnabled: () => Promise<void>;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;
  updatePageType: (next: LiffPageType) => Promise<void>;
  updatePublishStatus: (next: LiffPublishStatus) => Promise<void>;

  addBlock: (blockType: LiffBlockType) => Promise<void>;
  updateBlock: (block: LiffPageBlock) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  toggleBlockEnabled: (block: LiffPageBlock) => Promise<void>;
  moveBlock: (idx: number, direction: "up" | "down") => Promise<void>;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => Promise<void>;

  setEditingBlockId: (id: string | null) => void;
  cancelBlockEdit: () => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

  reload: () => Promise<void>;
}

const AUTO_SAVE_DEBOUNCE_MS = 800;
const SAVED_INDICATOR_TIMEOUT_MS = 2000;

export function useLiffConfig(
  workId: string,
  opts: {
    /** 編集対象の LIFF ページ ID。未指定なら旧 single-config API を使う (workId 配下の最古ページ)。 */
    pageId?: string;
    onSuccess?: (msg: string) => void;
    onError?: (msg: string) => void;
  } = {}
): UseLiffConfigReturn {
  const pageId = opts.pageId;
  const [config, setConfig] = useState<LiffPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<LiffSaveStatus>("idle");
  const [workTitle, setWorkTitle] = useState("");
  const [editingBlockId, setEditingBlockIdState] = useState<string | null>(null);

  // ── callbacks via refs (re-renderしてもhandlerが再生成されないように) ───────────
  const onSuccessRef = useRef(opts.onSuccess);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onSuccessRef.current = opts.onSuccess;
    onErrorRef.current = opts.onError;
  });

  // ── 最新の config / token / workId を非同期処理から参照するための refs ─────────
  const configRef = useRef<LiffPageConfig | null>(null);
  useEffect(() => { configRef.current = config; }, [config]);

  // serverConfigRef = 最後に server から受け取った正規状態。block 編集 cancel 時の復元元。
  const serverConfigRef = useRef<LiffPageConfig | null>(null);

  const token = getDevToken();
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const workIdRef = useRef(workId);
  useEffect(() => { workIdRef.current = workId; }, [workId]);
  const pageIdRef = useRef(pageId);
  useEffect(() => { pageIdRef.current = pageId; }, [pageId]);

  // ── auto-save state ───────────────────────────────────────────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);              // 次に発行する save の seq
  const latestAckedSeqRef = useRef(0);   // これ以下の seq の応答は古いとみなして無視

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const performAutoSave = useCallback(async () => {
    const draft = configRef.current;
    if (!draft) return;
    const seq = ++seqRef.current;
    setSaveStatus("saving");
    setSaving(true);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        settings_json: draft.settings_json,
      };
      const updated = pageIdRef.current
        ? await liffConfigApi.updatePage(tokenRef.current, workIdRef.current, pageIdRef.current, body)
        : await liffConfigApi.update(tokenRef.current, workIdRef.current, body);
      if (seq < latestAckedSeqRef.current) {
        // 古い in-flight 応答。最新入力を上書きしない。
        return;
      }
      latestAckedSeqRef.current = seq;
      // server 側で派生したフィールド (updated_at 等) を取り込みつつ
      // ユーザーが触っている title/description/settings_json は draft を維持。
      serverConfigRef.current = updated;
      setConfig((prev) => {
        if (!prev) return updated;
        return {
          ...updated,
          title: prev.title,
          description: prev.description,
          settings_json: prev.settings_json,
          blocks: prev.blocks,
        };
      });
      // 後続の入力が無く auto-save も予定されていなければ "saved" 表示。
      if (autoSaveTimerRef.current === null && seq === seqRef.current) {
        setSaveStatus("saved");
        if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
        savedIndicatorTimerRef.current = setTimeout(() => {
          setSaveStatus((s) => (s === "saved" ? "idle" : s));
        }, SAVED_INDICATOR_TIMEOUT_MS);
      }
    } catch {
      if (seq < latestAckedSeqRef.current) return;
      setSaveStatus("error");
      onErrorRef.current?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    clearAutoSaveTimer();
    setSaveStatus("pending");
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void performAutoSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [clearAutoSaveTimer, performAutoSave]);

  const flushAutoSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearAutoSaveTimer();
      await performAutoSave();
    }
  }, [clearAutoSaveTimer, performAutoSave]);

  // ── 読み込み ─────────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const cfgPromise = pageIdRef.current
        ? liffConfigApi.getPage(tokenRef.current, workIdRef.current, pageIdRef.current)
        : liffConfigApi.get(tokenRef.current, workIdRef.current);
      const [cfg, work] = await Promise.all([
        cfgPromise,
        workApi.get(tokenRef.current, workIdRef.current),
      ]);
      serverConfigRef.current = cfg;
      setConfig(cfg);
      setWorkTitle(work.title);
    } catch {
      onErrorRef.current?.("LIFF設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
    };
  }, []);

  // ── ローカル更新 (auto-save 連動) ────────────────────────────────────────────
  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    if ("title" in patch || "description" in patch || "settings_json" in patch) {
      scheduleAutoSave();
    }
  }, [scheduleAutoSave]);

  // ── 即時保存系 (toggle / page_type / publish_status) ─────────────────────────
  const toggleEnabled = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    const next = !current.is_enabled;
    setConfig((prev) => (prev ? { ...prev, is_enabled: next } : prev));
    setSaving(true);
    try {
      await flushAutoSave();
      if (pageIdRef.current) {
        await liffConfigApi.updatePage(tokenRef.current, workIdRef.current, pageIdRef.current, { is_enabled: next });
      } else {
        await liffConfigApi.update(tokenRef.current, workIdRef.current, { is_enabled: next });
      }
      if (serverConfigRef.current) serverConfigRef.current = { ...serverConfigRef.current, is_enabled: next };
      onSuccessRef.current?.(next ? "LIFFを有効にしました" : "LIFFを無効にしました");
    } catch {
      setConfig((prev) => (prev ? { ...prev, is_enabled: !next } : prev));
      onErrorRef.current?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [flushAutoSave]);

  const updatePageType = useCallback(async (next: LiffPageType) => {
    const current = configRef.current;
    if (!current) return;
    const previous = current.page_type;
    setConfig((prev) => (prev ? { ...prev, page_type: next } : prev));
    setSaving(true);
    try {
      await flushAutoSave();
      if (pageIdRef.current) {
        await liffConfigApi.updatePage(tokenRef.current, workIdRef.current, pageIdRef.current, { page_type: next });
      } else {
        await liffConfigApi.update(tokenRef.current, workIdRef.current, { page_type: next });
      }
      if (serverConfigRef.current) serverConfigRef.current = { ...serverConfigRef.current, page_type: next };
      onSuccessRef.current?.("ページ種別を更新しました");
    } catch {
      setConfig((prev) => (prev ? { ...prev, page_type: previous } : prev));
      onErrorRef.current?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [flushAutoSave]);

  const updatePublishStatus = useCallback(async (next: LiffPublishStatus) => {
    const current = configRef.current;
    if (!current) return;
    const previous = current.publish_status;
    setConfig((prev) => (prev ? { ...prev, publish_status: next } : prev));
    setSaving(true);
    try {
      await flushAutoSave();
      if (pageIdRef.current) {
        await liffConfigApi.updatePage(tokenRef.current, workIdRef.current, pageIdRef.current, { publish_status: next });
      } else {
        await liffConfigApi.update(tokenRef.current, workIdRef.current, { publish_status: next });
      }
      if (serverConfigRef.current) serverConfigRef.current = { ...serverConfigRef.current, publish_status: next };
      onSuccessRef.current?.(
        next === "published" ? "公開しました" :
        next === "archived"  ? "アーカイブしました" :
        "下書きに戻しました"
      );
    } catch (err) {
      setConfig((prev) => (prev ? { ...prev, publish_status: previous } : prev));
      onErrorRef.current?.(err instanceof Error ? err.message : "公開に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [flushAutoSave]);

  // ── block 操作 (reloadなし、ローカルパッチで完結) ────────────────────────────
  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    setConfig((prev) => (prev ? {
      ...prev,
      blocks: prev.blocks.map((b) => b.id === blockId ? { ...b, ...patch } : b),
    } : prev));
  }, []);

  const setEditingBlockId = useCallback((id: string | null) => {
    setEditingBlockIdState(id);
  }, []);

  const cancelBlockEdit = useCallback(() => {
    setEditingBlockIdState((currentId) => {
      if (currentId && serverConfigRef.current) {
        const serverBlock = serverConfigRef.current.blocks.find((b) => b.id === currentId);
        if (serverBlock) {
          setConfig((prev) => (prev ? {
            ...prev,
            blocks: prev.blocks.map((b) => b.id === currentId ? serverBlock : b),
          } : prev));
        }
      }
      return null;
    });
  }, []);

  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    setSaving(true);
    try {
      const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
      const entry = BLOCK_TYPE_REGISTRY[blockType];
      const created = await liffConfigApi.createBlock(tokenRef.current, workIdRef.current, {
        block_type: blockType,
        title: entry.label,
        settings_json: entry.defaultSettings,
        ...(pageIdRef.current ? { page_id: pageIdRef.current } : {}),
      });
      setConfig((prev) => (prev ? { ...prev, blocks: [...prev.blocks, created] } : prev));
      if (serverConfigRef.current) {
        serverConfigRef.current = { ...serverConfigRef.current, blocks: [...serverConfigRef.current.blocks, created] };
      }
      onSuccessRef.current?.("ブロックを追加しました");
    } catch {
      onErrorRef.current?.("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }, []);

  const updateBlock = useCallback(async (block: LiffPageBlock) => {
    setSaving(true);
    try {
      const updated = await liffConfigApi.updateBlock(tokenRef.current, workIdRef.current, block.id, {
        title: block.title,
        is_enabled: block.is_enabled,
        settings_json: block.settings_json as Record<string, unknown>,
        visibility_condition_json: block.visibility_condition_json,
      });
      setConfig((prev) => (prev ? {
        ...prev,
        blocks: prev.blocks.map((b) => b.id === updated.id ? updated : b),
      } : prev));
      if (serverConfigRef.current) {
        serverConfigRef.current = {
          ...serverConfigRef.current,
          blocks: serverConfigRef.current.blocks.map((b) => b.id === updated.id ? updated : b),
        };
      }
      setEditingBlockIdState(null);
      onSuccessRef.current?.("保存しました");
    } catch {
      onErrorRef.current?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, []);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!confirm("このブロックを削除しますか？")) return;
    setSaving(true);
    try {
      await liffConfigApi.deleteBlock(tokenRef.current, workIdRef.current, blockId);
      setConfig((prev) => (prev ? {
        ...prev,
        blocks: prev.blocks.filter((b) => b.id !== blockId),
      } : prev));
      if (serverConfigRef.current) {
        serverConfigRef.current = {
          ...serverConfigRef.current,
          blocks: serverConfigRef.current.blocks.filter((b) => b.id !== blockId),
        };
      }
      setEditingBlockIdState((cur) => (cur === blockId ? null : cur));
      onSuccessRef.current?.("削除しました");
    } catch {
      onErrorRef.current?.("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleBlockEnabled = useCallback(async (block: LiffPageBlock) => {
    const next = !block.is_enabled;
    updateBlockLocal(block.id, { is_enabled: next });
    try {
      await liffConfigApi.updateBlock(tokenRef.current, workIdRef.current, block.id, { is_enabled: next });
      if (serverConfigRef.current) {
        serverConfigRef.current = {
          ...serverConfigRef.current,
          blocks: serverConfigRef.current.blocks.map((b) => b.id === block.id ? { ...b, is_enabled: next } : b),
        };
      }
    } catch {
      updateBlockLocal(block.id, { is_enabled: !next });
      onErrorRef.current?.("更新に失敗しました");
    }
  }, [updateBlockLocal]);

  const moveBlock = useCallback(async (idx: number, direction: "up" | "down") => {
    const current = configRef.current;
    if (!current) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.blocks.length) return;
    const newBlocks = [...current.blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    const prevBlocks = current.blocks;
    setConfig((prev) => (prev ? { ...prev, blocks: reordered } : prev));
    try {
      await liffConfigApi.reorderBlocks(tokenRef.current, workIdRef.current, {
        block_ids: reordered.map((b) => b.id),
        ...(pageIdRef.current ? { page_id: pageIdRef.current } : {}),
      });
      if (serverConfigRef.current) serverConfigRef.current = { ...serverConfigRef.current, blocks: reordered };
    } catch {
      setConfig((prev) => (prev ? { ...prev, blocks: prevBlocks } : prev));
      onErrorRef.current?.("並び替えに失敗しました");
    }
  }, []);

  const reorderBlocks = useCallback(async (newBlocks: LiffPageBlock[]) => {
    const current = configRef.current;
    if (!current) return;
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    const prevBlocks = current.blocks;
    setConfig((prev) => (prev ? { ...prev, blocks: reordered } : prev));
    try {
      await liffConfigApi.reorderBlocks(tokenRef.current, workIdRef.current, {
        block_ids: reordered.map((b) => b.id),
        ...(pageIdRef.current ? { page_id: pageIdRef.current } : {}),
      });
      if (serverConfigRef.current) serverConfigRef.current = { ...serverConfigRef.current, blocks: reordered };
    } catch {
      setConfig((prev) => (prev ? { ...prev, blocks: prevBlocks } : prev));
      onErrorRef.current?.("並び替えに失敗しました");
    }
  }, []);

  return {
    config, loading, saving, saveStatus, workTitle, editingBlockId,
    toggleEnabled, updateConfigLocal,
    updatePageType, updatePublishStatus,
    addBlock, updateBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, cancelBlockEdit, updateBlockLocal,
    reload,
  };
}
