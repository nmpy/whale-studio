"use client";

// src/components/liff/werewolf/WerewolfTitleDetailEditor.tsx
//
// 人狼タイトル詳細編集画面の本体。
//   - タイトル本体 (title / description / scheduledAt / playerCount) の編集 + 保存
//   - ゲーム開始ボタン (確認ダイアログ付き、is_started=true で固定)
//   - 配下スロット一覧 (各 slot 内でカード CRUD / 並び替え / QR)

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { werewolfApi, getDevToken } from "@/lib/api-client";
import type {
  WerewolfTitle,
  WerewolfRoleSlot,
  WerewolfRoleCard,
  CreateWerewolfRoleCardBody,
  UpdateWerewolfRoleCardBody,
} from "@/types";
import { WerewolfSlotEditorItem } from "./WerewolfSlotEditorItem";

// Slot.cards / Title.slots はそれぞれ optional になっているが、詳細 API では必ず含まれる。
// 型を厳密にするため、Omit + 上書きで「必須」に絞った型を作る。
type DetailSlot  = Omit<WerewolfRoleSlot, "cards"> & { cards: WerewolfRoleCard[] };
type DetailTitle = Omit<WerewolfTitle, "slots">    & { slots: DetailSlot[] };

interface Props {
  workId:           string;
  liffPageConfigId: string;
  titleId:          string;
  readOnly:         boolean;
  /** ゲーム開始後にメニュー側で告知するための callback (オプション) */
  liffId?:          string;
}

/** datetime-local <input> 用に ISO 文字列を `YYYY-MM-DDTHH:MM` 形式 (秒以下なし) へ変換。 */
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function datetimeLocalToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function WerewolfTitleDetailEditor({
  workId, liffPageConfigId, titleId, readOnly, liffId,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();

  const [data, setData] = useState<DetailTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // タイトル本体 (編集用 draft state)
  const [draftTitle,       setDraftTitle]       = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftScheduledAt, setDraftScheduledAt] = useState("");
  const [draftPlayerCount, setDraftPlayerCount] = useState(0);
  const [savingTitle,      setSavingTitle]      = useState(false);
  const [startingGame,     setStartingGame]     = useState(false);

  const reload = useCallback(async () => {
    try {
      const t = await werewolfApi.getTitleDetail(getDevToken(), workId, titleId);
      setData(t as DetailTitle);
      setDraftTitle(t.title);
      setDraftDescription(t.description ?? "");
      setDraftScheduledAt(isoToDatetimeLocal(t.scheduled_at));
      setDraftPlayerCount(t.player_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [workId, titleId]);

  useEffect(() => { void reload(); }, [reload]);

  const isStarted = data?.is_started ?? false;

  // 本体保存
  const handleSaveTitle = async () => {
    if (readOnly || !data) return;
    if (!draftTitle.trim()) {
      showToast("タイトル名は必須です", "error");
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await werewolfApi.updateTitle(getDevToken(), workId, titleId, {
        title:        draftTitle.trim(),
        description:  draftDescription.trim() || null,
        scheduled_at: datetimeLocalToISO(draftScheduledAt),
        ...(isStarted ? {} : { player_count: draftPlayerCount }),
      });
      setData(updated as DetailTitle);
      showToast("保存しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存に失敗しました", "error");
    } finally {
      setSavingTitle(false);
    }
  };

  // ゲーム開始
  const handleStartGame = async () => {
    if (readOnly || !data || isStarted) return;
    const ok = window.confirm(
      "ゲームを開始しますか？\n開始すると、プレイヤーが配役ページを閲覧できるようになります。"
    );
    if (!ok) return;
    setStartingGame(true);
    try {
      await werewolfApi.startGame(getDevToken(), workId, titleId);
      await reload();
      showToast("ゲームを開始しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "ゲーム開始に失敗しました", "error");
    } finally {
      setStartingGame(false);
    }
  };

  // slot label 保存
  const handleSaveSlotLabel = useCallback(async (slotId: string, label: string | null) => {
    if (!data) return;
    try {
      const updated = await werewolfApi.updateSlot(getDevToken(), workId, slotId, { label });
      setData({
        ...data,
        slots: data.slots.map((s) => (s.id === slotId ? { ...s, label: updated.label, updated_at: updated.updated_at } : s)),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "ラベル保存に失敗しました", "error");
    }
  }, [data, workId, showToast]);

  // token 再発行
  const handleRotateToken = useCallback(async (slotId: string) => {
    if (!data) return;
    try {
      const updated = await werewolfApi.rotateSlotToken(getDevToken(), workId, slotId);
      setData({
        ...data,
        slots: data.slots.map((s) => (s.id === slotId ? { ...s, token: updated.token, updated_at: updated.updated_at } : s)),
      });
      showToast("token を再発行しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "再発行に失敗しました", "error");
    }
  }, [data, workId, showToast]);

  // card CRUD
  const handleCreateCard = useCallback(async (slotId: string, body: CreateWerewolfRoleCardBody) => {
    if (!data) return;
    try {
      const created = await werewolfApi.createCard(getDevToken(), workId, slotId, body);
      setData({
        ...data,
        slots: data.slots.map((s) => (s.id === slotId ? { ...s, cards: [...s.cards, created] } : s)),
      });
      showToast("カードを追加しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "追加に失敗しました", "error");
      throw e;
    }
  }, [data, workId, showToast]);

  const handleUpdateCard = useCallback(async (cardId: string, body: UpdateWerewolfRoleCardBody) => {
    if (!data) return;
    try {
      const updated = await werewolfApi.updateCard(getDevToken(), workId, cardId, body);
      setData({
        ...data,
        slots: data.slots.map((s) => ({
          ...s,
          cards: s.cards.map((c) => (c.id === cardId ? updated : c)),
        })),
      });
      showToast("カードを更新しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新に失敗しました", "error");
      throw e;
    }
  }, [data, workId, showToast]);

  const handleDeleteCard = useCallback(async (cardId: string) => {
    if (!data) return;
    try {
      await werewolfApi.deleteCard(getDevToken(), workId, cardId);
      setData({
        ...data,
        slots: data.slots.map((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== cardId) })),
      });
      showToast("カードを削除しました", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }, [data, workId, showToast]);

  const handleReorderCards = useCallback(async (slotId: string, cardIds: string[]) => {
    if (!data) return;
    // optimistic update
    const prevSlots = data.slots;
    setData({
      ...data,
      slots: data.slots.map((s) => {
        if (s.id !== slotId) return s;
        const byId = new Map(s.cards.map((c) => [c.id, c] as const));
        return { ...s, cards: cardIds.map((id) => byId.get(id)!).filter(Boolean) };
      }),
    });
    try {
      await werewolfApi.reorderCards(getDevToken(), workId, slotId, { card_ids: cardIds });
    } catch (e) {
      setData({ ...data, slots: prevSlots });
      showToast(e instanceof Error ? e.message : "並び替えに失敗しました", "error");
    }
  }, [data, workId, showToast]);

  const playerCountDirty = useMemo(() => {
    if (!data) return false;
    return draftPlayerCount !== data.player_count;
  }, [data, draftPlayerCount]);

  if (loading) {
    return <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />;
  }
  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
        {error ?? "読み込めませんでした"}
        <button onClick={() => router.back()} className="ml-3 underline">戻る</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 本体 */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-900">タイトル設定</h2>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
              isStarted
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}>
              {isStarted ? "開始済み" : "開始前"}
            </span>
            {!isStarted && !readOnly && (
              <button
                type="button"
                onClick={handleStartGame}
                disabled={startingGame}
                className="px-3 py-1.5 bg-[color:var(--liff-line-green,#06C755)] text-white rounded-md text-xs font-bold hover:opacity-90 disabled:opacity-50"
              >
                {startingGame ? "開始中..." : "ゲーム開始"}
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">タイトル名 <span className="text-red-500">*</span></label>
          <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={readOnly}
            maxLength={100}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">説明 (任意)</label>
          <textarea
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-brand/30"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            disabled={readOnly}
            rows={2}
            maxLength={1000}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">プレイ予定日時 (任意)</label>
            <input
              type="datetime-local"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={draftScheduledAt}
              onChange={(e) => setDraftScheduledAt(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">プレイヤー人数</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50"
              value={draftPlayerCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setDraftPlayerCount(Math.max(1, Math.min(50, Math.floor(n))));
              }}
              disabled={readOnly || isStarted}
              min={1}
              max={50}
            />
            <p className="text-[10px] text-gray-400 mt-0.5">
              {isStarted
                ? "開始後は変更できません。"
                : playerCountDirty
                  ? "保存すると slot を増減します (末尾を削除 / 追加)"
                  : "増減すると slot が末尾に追加 / 削除されます"}
            </p>
          </div>
        </div>

        {!readOnly && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSaveTitle}
              disabled={savingTitle}
              className="px-4 py-2 bg-brand text-white rounded-md text-sm font-semibold hover:bg-brand-deep disabled:opacity-50"
            >
              {savingTitle ? "保存中..." : "タイトル設定を保存"}
            </button>
          </div>
        )}
      </section>

      {/* slot 一覧 */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">配役スロット ({data.slots.length} 件)</h2>
        {data.slots.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">プレイヤー人数を入力して保存すると、スロットが生成されます。</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.slots.map((s) => (
              <WerewolfSlotEditorItem
                key={s.id}
                slot={s}
                readOnly={readOnly}
                liffId={liffId}
                onSaveLabel={(label) => handleSaveSlotLabel(s.id, label)}
                onRotateToken={() => handleRotateToken(s.id)}
                onCreateCard={(body) => handleCreateCard(s.id, body)}
                onUpdateCard={(cardId, body) => handleUpdateCard(cardId, body)}
                onDeleteCard={(cardId) => handleDeleteCard(cardId)}
                onReorderCards={(cardIds) => handleReorderCards(s.id, cardIds)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
