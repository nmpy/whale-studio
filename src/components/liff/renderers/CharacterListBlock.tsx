"use client";

// src/components/liff/renderers/CharacterListBlock.tsx
// LIFF キャラクター一覧ブロック（block_type="n" / character_list）。
//   - 作品の有効キャラを 3 列グリッド（アバター + 名前）で表示
//   - キャラタップで中央モーダル（アバター + 名前 + 紹介文）
//   - 紹介文は PR #399 の Character.description（API pass-through）を使用。show_description で表示制御。
//   - met/unlock・役割(role) 等は本ブロックでは扱わない（データに無い / 別 PR）。

import { useEffect, useState } from "react";
import type { CharacterListSettings } from "@/types";

export interface CharacterInfo {
  id: string;
  name: string;
  /** キャラクター紹介文（PR #399・任意）。モーダルで表示。 */
  description?: string | null;
  icon_type: "text" | "image";
  icon_text?: string | null;
  icon_image_url?: string | null;
  icon_color?: string | null;
}

// アバター（画像 or 色円 + 文字）。decorative なので aria-hidden。
function CharAvatar({ c, size }: { c: CharacterInfo; size: number }) {
  if (c.icon_type === "image" && c.icon_image_url) {
    return (
      <img
        src={c.icon_image_url}
        alt=""
        aria-hidden="true"
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="rounded-full shrink-0 inline-flex items-center justify-center text-white font-bold"
      style={{ width: size, height: size, background: c.icon_color || "#8b5cf6", fontSize: Math.round(size * 0.32) }}
    >
      {c.icon_text || c.name.charAt(0)}
    </span>
  );
}

function CharacterModal({
  character, showIcon, showDescription, onClose,
}: {
  character: CharacterInfo;
  showIcon: boolean;
  showDescription: boolean;
  onClose: () => void;
}) {
  // Escape で閉じる（最低限の a11y）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const desc = character.description?.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-7 bg-black/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={character.name}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[340px] rounded-[16px] px-6 pt-[30px] pb-[26px] text-center bg-[color:var(--liff-surface,#fff)] shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute top-3.5 right-3.5 w-[26px] h-[26px] rounded-full inline-flex items-center justify-center text-[15px] bg-[color:var(--liff-surface-subtle,#F5F5F5)] text-[color:var(--liff-tertiary-text,#777)] active:opacity-70"
        >
          ×
        </button>

        {showIcon && (
          <span className="block mx-auto mb-4 w-24 h-24">
            <CharAvatar c={character} size={96} />
          </span>
        )}

        <div className="text-[19px] font-bold text-[color:var(--liff-primary-text)] break-words">
          {character.name}
        </div>

        {showDescription && (
          desc ? (
            <p className="mt-4 text-[13px] leading-[1.85] whitespace-pre-wrap break-words text-[color:var(--liff-secondary-text)]">
              {desc}
            </p>
          ) : (
            <p className="mt-4 text-[13px] leading-[1.85] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
              まだ紹介文がありません
            </p>
          )
        )}
      </div>
    </div>
  );
}

export function CharacterListBlock({
  title,
  settings,
  characters,
}: {
  title?: string | null;
  settings: CharacterListSettings;
  characters: CharacterInfo[];
}) {
  const [selected, setSelected] = useState<CharacterInfo | null>(null);
  const showIcon = settings.show_icon !== false;          // 既定: 表示（既存挙動）
  const showDescription = settings.show_description !== false; // 既定: 表示（PR #399 の description を活かす）

  return (
    <div>
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}

      {characters.length === 0 ? (
        <p className="text-[14px] text-[color:var(--liff-tertiary-text)] text-center py-4">
          キャラクターが登録されていません
        </p>
      ) : (
        // 1 枚の白カード内に 3 列グリッド。
        <div className="bg-[color:var(--liff-surface,#fff)] rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] pt-5 px-3.5 pb-1">
          <div className="grid grid-cols-3 gap-x-2 gap-y-[22px]">
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c)}
                aria-label={c.name}
                className="flex flex-col items-center gap-2 text-center active:opacity-60 transition-opacity"
              >
                {showIcon && <CharAvatar c={c} size={62} />}
                <span className="text-[11.5px] leading-[1.25] text-center break-words text-[color:var(--liff-secondary-text)]">
                  {c.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <CharacterModal
          character={selected}
          showIcon={showIcon}
          showDescription={showDescription}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
