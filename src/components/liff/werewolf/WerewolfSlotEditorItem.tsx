"use client";

// src/components/liff/werewolf/WerewolfSlotEditorItem.tsx
//
// 配役スロット 1 件分の編集 UI。
//   - ラベル (GM 用管理名) inline 編集
//   - 配下の配役カード一覧 (上下並び替え + 編集 + 削除)
//   - 「＋ カード追加」ボタン
//   - QR 表示 + URL コピー + token 再発行 (WerewolfQRDisplay)

import { useState } from "react";
import type {
  WerewolfRoleSlot,
  WerewolfRoleCard,
  CreateWerewolfRoleCardBody,
  UpdateWerewolfRoleCardBody,
} from "@/types";
import { WerewolfCardFormModal } from "./WerewolfCardFormModal";
import { WerewolfQRDisplay } from "./WerewolfQRDisplay";

interface Props {
  slot: WerewolfRoleSlot & { cards: WerewolfRoleCard[] };
  readOnly: boolean;
  liffId?: string;
  onSaveLabel:   (label: string | null) => Promise<void>;
  onRotateToken: () => Promise<void>;
  onCreateCard:  (body: CreateWerewolfRoleCardBody) => Promise<void>;
  onUpdateCard:  (cardId: string, body: UpdateWerewolfRoleCardBody) => Promise<void>;
  onDeleteCard:  (cardId: string) => Promise<void>;
  onReorderCards: (cardIds: string[]) => Promise<void>;
}

export function WerewolfSlotEditorItem({
  slot, readOnly, liffId,
  onSaveLabel, onRotateToken,
  onCreateCard, onUpdateCard, onDeleteCard, onReorderCards,
}: Props) {
  const [labelDraft, setLabelDraft] = useState(slot.label ?? "");
  const [savingLabel, setSavingLabel] = useState(false);

  const [showCardModal, setShowCardModal] = useState(false);
  const [editingCard, setEditingCard]     = useState<WerewolfRoleCard | null>(null);
  const [savingCard, setSavingCard]       = useState(false);

  const handleSaveLabel = async () => {
    if (readOnly) return;
    const value = labelDraft.trim() || null;
    if ((slot.label ?? "") === (value ?? "")) return; // 変更なし
    setSavingLabel(true);
    try {
      await onSaveLabel(value);
    } finally {
      setSavingLabel(false);
    }
  };

  const moveCard = async (idx: number, dir: -1 | 1) => {
    if (readOnly) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= slot.cards.length) return;
    const reordered = [...slot.cards];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    await onReorderCards(reordered.map((c) => c.id));
  };

  const handleDeleteCard = async (card: WerewolfRoleCard) => {
    if (readOnly) return;
    if (!window.confirm(`「${card.title}」を削除しますか？`)) return;
    await onDeleteCard(card.id);
  };

  const handleSubmitCard = async (body: CreateWerewolfRoleCardBody | UpdateWerewolfRoleCardBody) => {
    setSavingCard(true);
    try {
      if (editingCard) {
        await onUpdateCard(editingCard.id, body as UpdateWerewolfRoleCardBody);
      } else {
        await onCreateCard(body as CreateWerewolfRoleCardBody);
      }
      setShowCardModal(false);
      setEditingCard(null);
    } finally {
      setSavingCard(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      {/* slot ヘッダー */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        <span className="text-[11px] font-bold text-gray-500 shrink-0 w-12">#{slot.slot_number}</span>
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={handleSaveLabel}
          disabled={readOnly || savingLabel}
          placeholder={`プレイヤー${slot.slot_number}`}
          maxLength={50}
          className="flex-1 min-w-[120px] text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {/* カード一覧 */}
      <div className="px-3 py-2.5">
        {slot.cards.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">配役カードがまだありません</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {slot.cards.map((card, idx) => (
              <li key={card.id} className="flex items-center gap-2 border border-gray-100 rounded-md px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {card.badge_label && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-gray-200 text-gray-500 bg-gray-50">
                        {card.badge_label}
                      </span>
                    )}
                    <span className="text-[13px] font-bold text-gray-900 truncate">{card.title}</span>
                  </div>
                  {card.subtitle && (
                    <p className="text-[10px] text-gray-500 truncate mt-0.5">{card.subtitle}</p>
                  )}
                </div>

                {!readOnly && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveCard(idx, -1)}
                      disabled={idx === 0}
                      className="w-6 h-6 inline-flex items-center justify-center text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCard(idx, 1)}
                      disabled={idx === slot.cards.length - 1}
                      className="w-6 h-6 inline-flex items-center justify-center text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingCard(card); setShowCardModal(true); }}
                      className="text-[11px] px-2 py-1 border border-gray-200 text-gray-600 rounded hover:bg-gray-50"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(card)}
                      className="text-[11px] px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={() => { setEditingCard(null); setShowCardModal(true); }}
            className="mt-2 text-[11px] px-2.5 py-1 border border-dashed border-brand/40 text-brand-ink rounded hover:bg-brand-mist"
          >
            ＋ カード追加
          </button>
        )}
      </div>

      {/* QR */}
      <div className="px-3 pb-3">
        <WerewolfQRDisplay
          slotToken={slot.token}
          liffId={liffId}
          onRotateToken={readOnly ? undefined : onRotateToken}
        />
      </div>

      {showCardModal && (
        <WerewolfCardFormModal
          card={editingCard}
          saving={savingCard}
          onCancel={() => { setShowCardModal(false); setEditingCard(null); }}
          onSubmit={handleSubmitCard}
        />
      )}
    </div>
  );
}
