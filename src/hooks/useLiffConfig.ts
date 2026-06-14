"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック
//
// 設計メモ（一括保存方式 / PR: LIFF編集改善）:
// - LIFF 編集画面の変更（ページ設定・デザイン設定・ページ種別・公開状態・ブロックの
//   追加/編集/削除/並び替え）は **すべてローカル draft state に保持** する。
// - 旧仕様の 800ms 自動保存・ブロックごとの即時保存・各操作の即時 API 呼び出しは廃止。
// - 永続化は最下部「すべての変更を保存」(= saveAll) 押下時のみ。
//   サーバー側トランザクション（/liff-pages/[pageId]/bulk）で page + blocks をまとめて保存し、
//   途中失敗時に半端な状態を作らない。
// - 保存成功で dirty を解除。保存失敗時は draft を保持したままエラー表示（復旧可能）。
// - 公開/非公開の切り替えも一括保存に含める（即時反映が必要な理由は無いため draft 化）。
// - 新規ブロックは temp- 始まりのローカル ID を採番し、保存時にサーバーが本 ID を採番する。

import { useEffect, useState, useCallback, useRef } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type {
  LiffPageConfig,
  LiffPageBlock,
  LiffBlockType,
  LiffPageType,
  LiffPublishStatus,
  BulkSaveLiffPageBody,
} from "@/types";

export type LiffSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  saveStatus: LiffSaveStatus;
  /** 未保存の変更があるか */
  dirty: boolean;
  workTitle: string;
  editingBlockId: string | null;

  toggleEnabled: () => void;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;
  updatePageType: (next: LiffPageType) => void;
  updatePublishStatus: (next: LiffPublishStatus) => void;

  addBlock: (blockType: LiffBlockType) => Promise<void>;
  deleteBlock: (blockId: string) => void;
  toggleBlockEnabled: (block: LiffPageBlock) => void;
  moveBlock: (idx: number, direction: "up" | "down") => void;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => void;

  setEditingBlockId: (id: string | null) => void;
  cancelBlockEdit: () => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

  /** すべての変更を 1 リクエストで保存する */
  saveAll: () => Promise<void>;
  reload: () => Promise<void>;
}

const SAVED_INDICATOR_TIMEOUT_MS = 2000;

export function useLiffConfig(
  workId: string,
  opts: {
    /** 編集対象の LIFF ページ ID。一括保存はこの ID が必須。 */
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
  const [dirty, setDirty] = useState(false);
  const [workTitle, setWorkTitle] = useState("");
  const [editingBlockId, setEditingBlockIdState] = useState<string | null>(null);

  // ── callbacks via refs（再レンダーで handler を作り直さない） ──
  const onSuccessRef = useRef(opts.onSuccess);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onSuccessRef.current = opts.onSuccess;
    onErrorRef.current = opts.onError;
  });

  // ── 最新値を非同期処理から参照するための refs ──
  const configRef = useRef<LiffPageConfig | null>(null);
  useEffect(() => { configRef.current = config; }, [config]);
  // 最後にサーバーから受け取った正規状態（保存成功後に更新）。
  const serverConfigRef = useRef<LiffPageConfig | null>(null);

  const token = getDevToken();
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const workIdRef = useRef(workId);
  useEffect(() => { workIdRef.current = workId; }, [workId]);
  const pageIdRef = useRef(pageId);
  useEffect(() => { pageIdRef.current = pageId; }, [pageId]);

  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempIdRef = useRef(0);

  /** ローカル変更を反映しつつ dirty を立てる共通ヘルパー。 */
  const patchConfig = useCallback((updater: (prev: LiffPageConfig) => LiffPageConfig) => {
    setConfig((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setSaveStatus((s) => (s === "saved" ? "idle" : s));
  }, []);

  // ── 読み込み ──
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
      setDirty(false);
      setSaveStatus("idle");
    } catch {
      onErrorRef.current?.("LIFF設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    return () => {
      if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
    };
  }, []);

  // ── ローカル更新（すべて draft + dirty） ──
  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    patchConfig((prev) => ({ ...prev, ...patch }));
  }, [patchConfig]);

  const toggleEnabled = useCallback(() => {
    patchConfig((prev) => ({ ...prev, is_enabled: !prev.is_enabled }));
  }, [patchConfig]);

  const updatePageType = useCallback((next: LiffPageType) => {
    patchConfig((prev) => ({ ...prev, page_type: next }));
  }, [patchConfig]);

  const updatePublishStatus = useCallback((next: LiffPublishStatus) => {
    patchConfig((prev) => ({ ...prev, publish_status: next }));
  }, [patchConfig]);

  // ── ブロック操作（draft のみ。永続化は saveAll） ──
  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    patchConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  }, [patchConfig]);

  const setEditingBlockId = useCallback((id: string | null) => {
    setEditingBlockIdState(id);
  }, []);

  // 一括保存方式では「閉じる」は単に編集 UI を畳むだけ（変更は draft に残る）。
  const cancelBlockEdit = useCallback(() => {
    setEditingBlockIdState(null);
  }, []);

  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    const draft = configRef.current;
    if (!draft) return;
    const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
    const entry = BLOCK_TYPE_REGISTRY[blockType];
    const now = new Date().toISOString();
    const tempId = `temp-${++tempIdRef.current}`;
    const created: LiffPageBlock = {
      id:                        tempId,
      page_config_id:            draft.id,
      block_type:                blockType,
      sort_order:                draft.blocks.length,
      is_enabled:                true,
      title:                     entry.label,
      settings_json:             entry.defaultSettings as LiffPageBlock["settings_json"],
      visibility_condition_json: null,
      created_at:                now,
      updated_at:                now,
    };
    patchConfig((prev) => ({ ...prev, blocks: [...prev.blocks, created] }));
  }, [patchConfig]);

  const deleteBlock = useCallback((blockId: string) => {
    if (!confirm("このブロックを削除します。「すべての変更を保存」で確定します。よろしいですか？")) return;
    patchConfig((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) }));
    setEditingBlockIdState((cur) => (cur === blockId ? null : cur));
  }, [patchConfig]);

  const toggleBlockEnabled = useCallback((block: LiffPageBlock) => {
    patchConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === block.id ? { ...b, is_enabled: !b.is_enabled } : b)),
    }));
  }, [patchConfig]);

  const moveBlock = useCallback((idx: number, direction: "up" | "down") => {
    const draft = configRef.current;
    if (!draft) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= draft.blocks.length) return;
    const newBlocks = [...draft.blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    patchConfig((prev) => ({ ...prev, blocks: newBlocks.map((b, i) => ({ ...b, sort_order: i })) }));
  }, [patchConfig]);

  const reorderBlocks = useCallback((newBlocks: LiffPageBlock[]) => {
    patchConfig((prev) => ({ ...prev, blocks: newBlocks.map((b, i) => ({ ...b, sort_order: i })) }));
  }, [patchConfig]);

  // ── 一括保存 ──
  const saveAll = useCallback(async () => {
    const draft = configRef.current;
    const pid = pageIdRef.current;
    if (!draft || !pid || saving) return;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const body: BulkSaveLiffPageBody = {
        is_enabled:     draft.is_enabled,
        title:          draft.title,
        description:    draft.description,
        page_type:      draft.page_type,
        publish_status: draft.publish_status,
        settings_json:  draft.settings_json,
        blocks: draft.blocks.map((b) => ({
          // temp- 始まり（新規）は id を送らずサーバーに採番させる。
          id:                        b.id.startsWith("temp-") ? undefined : b.id,
          block_type:                b.block_type,
          title:                     b.title,
          is_enabled:                b.is_enabled,
          settings_json:             b.settings_json,
          visibility_condition_json: b.visibility_condition_json,
        })),
      };
      const saved = await liffConfigApi.bulkSavePage(tokenRef.current, workIdRef.current, pid, body);
      serverConfigRef.current = saved;
      setConfig(saved);
      setEditingBlockIdState(null);
      setDirty(false);
      setSaveStatus("saved");
      onSuccessRef.current?.("すべての変更を保存しました");
      if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
      savedIndicatorTimerRef.current = setTimeout(() => {
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      }, SAVED_INDICATOR_TIMEOUT_MS);
    } catch (err) {
      // draft は保持したままエラー表示（ユーザーが再保存できるように）。
      setSaveStatus("error");
      onErrorRef.current?.(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [saving]);

  return {
    config, loading, saving, saveStatus, dirty, workTitle, editingBlockId,
    toggleEnabled, updateConfigLocal,
    updatePageType, updatePublishStatus,
    addBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, cancelBlockEdit, updateBlockLocal,
    saveAll, reload,
  };
}
