"use client";

// src/components/liff/werewolf/WerewolfCardFormModal.tsx
//
// 配役カード新規 / 編集モーダル。
// 親側 (Slot editor) で create / update のどちらか + 既存値を受け取って show する。

import { useEffect, useState } from "react";
import type { WerewolfRoleCard, CreateWerewolfRoleCardBody, UpdateWerewolfRoleCardBody } from "@/types";

interface Props {
  /** 既存カードを編集する場合に渡す。null なら新規。 */
  card?: WerewolfRoleCard | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (body: CreateWerewolfRoleCardBody | UpdateWerewolfRoleCardBody) => Promise<void>;
}

export function WerewolfCardFormModal({ card, saving, onCancel, onSubmit }: Props) {
  const [title,      setTitle]      = useState("");
  const [subtitle,   setSubtitle]   = useState("");
  const [badgeLabel, setBadgeLabel] = useState("");
  const [body,       setBody]       = useState("");

  useEffect(() => {
    setTitle(card?.title ?? "");
    setSubtitle(card?.subtitle ?? "");
    setBadgeLabel(card?.badge_label ?? "");
    setBody(card?.body ?? "");
  }, [card]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    await onSubmit({
      title:       title.trim(),
      subtitle:    subtitle.trim() || null,
      badge_label: badgeLabel.trim() || null,
      body:        body,
    });
  };

  const isEdit = !!card;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-gray-900 mb-4">
          {isEdit ? "配役カードを編集" : "配役カードを追加"}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              カード見出し <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 守護騎士"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">サブテキスト</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="例: あなたは……"
                maxLength={100}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">カード見出しの上に小さく表示。</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">バッジ</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value)}
                placeholder="例: 役職"
                maxLength={30}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">小さなタグ表示。</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              本文 <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y min-h-[140px] focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="例: あなたは村の命を守る誇り高き騎士です。&#10;あなたは毎晩クエストに参加する者を1人選び……"
              rows={6}
              maxLength={5000}
            />
            <p className="text-[10px] text-gray-400 mt-0.5">改行可。プレイヤーには整形して表示されます。</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-md text-sm hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim() || !body.trim()}
              className="px-4 py-2 bg-brand text-white rounded-md text-sm font-semibold hover:bg-brand-deep disabled:opacity-50"
            >
              {saving ? "保存中..." : isEdit ? "更新" : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
