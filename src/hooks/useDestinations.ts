"use client";

// src/hooks/useDestinations.ts
// destination 管理のステートとハンドラーをカプセル化するカスタムフック。
// useLiffConfig と同じパターン。

import { useEffect, useState, useCallback } from "react";
import { destinationApi, workApi, getDevToken } from "@/lib/api-client";
import type {
  LineDestination,
  DestinationType,
  LiffTargetType,
} from "@/types";

export interface UseDestinationsReturn {
  destinations: LineDestination[];
  loading: boolean;
  saving: boolean;
  workTitle: string;

  add: (data: DestinationFormData) => Promise<boolean>;
  update: (id: string, data: DestinationFormData) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  toggleEnabled: (dest: LineDestination) => Promise<void>;
  reload: () => Promise<void>;
}

/** フォームから submit されるデータ */
export interface DestinationFormData {
  key: string;
  name: string;
  description?: string | null;
  destination_type: DestinationType;
  liff_target_type?: LiffTargetType | null;
  url_or_path?: string | null;
  query_params_json?: Record<string, string>;
  is_enabled?: boolean;
}

export function useDestinations(
  workId: string,
  opts: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void } = {}
): UseDestinationsReturn {
  const [destinations, setDestinations] = useState<LineDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workTitle, setWorkTitle] = useState("");

  const token = getDevToken();
  const { onSuccess, onError } = opts;

  const reload = useCallback(async () => {
    try {
      const [dests, work] = await Promise.all([
        destinationApi.list(token, workId),
        workApi.get(token, workId),
      ]);
      setDestinations(dests);
      setWorkTitle(work.title);
    } catch {
      onError?.("読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, workId, onError]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (data: DestinationFormData): Promise<boolean> => {
    setSaving(true);
    try {
      await destinationApi.create(token, workId, data);
      await reload();
      onSuccess?.("遷移先を追加しました");
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "追加に失敗しました";
      onError?.(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const update = useCallback(async (id: string, data: DestinationFormData): Promise<boolean> => {
    setSaving(true);
    try {
      await destinationApi.update(token, workId, id, data);
      await reload();
      onSuccess?.("保存しました");
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "保存に失敗しました";
      onError?.(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const remove = useCallback(async (id: string) => {
    const dest = destinations.find((d) => d.id === id);
    const usageCount = dest?.usage_count ?? 0;
    const msg = usageCount > 0
      ? `この遷移先は ${usageCount} 箇所で使われています。本当に削除しますか？`
      : "この遷移先を削除しますか？";
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      await destinationApi.delete(token, workId, id);
      await reload();
      onSuccess?.("削除しました");
    } catch {
      onError?.("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const toggleEnabled = useCallback(async (dest: LineDestination) => {
    // optimistic update
    setDestinations((prev) =>
      prev.map((d) => d.id === dest.id ? { ...d, is_enabled: !d.is_enabled } : d)
    );
    try {
      await destinationApi.update(token, workId, dest.id, { is_enabled: !dest.is_enabled });
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    }
  }, [token, workId, reload, onError]);

  return {
    destinations, loading, saving, workTitle,
    add, update, remove, toggleEnabled, reload,
  };
}
