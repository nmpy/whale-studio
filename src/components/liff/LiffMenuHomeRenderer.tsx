"use client";

// src/components/liff/LiffMenuHomeRenderer.tsx
//
// 作品メニューホーム — `/liff/w/[workPublicId]` の表示。
//
// 構成 (上から):
//   - ヘッダー (作品名 + 閉じるボタン)
//   - 「メニュー」見出し (左寄せ、太字)
//   - 2 列グリッドのカード一覧 (各 LiffPageConfig に対応)
//   - Powered by Whale Studio footer
//
// カードのクリック挙動:
//   - 実機: `<a href="/liff/w/[workPublicId]/p/[pagePublicId]">` で個別ページに遷移
//   - プレビュー: 親が onSelectCard を渡し、内部で個別ページ表示に切り替える
// どちらを使うかは props で渡された値で決まる。両方を渡してはいけない (a or button の片方のみ)。

import type { LiffPageConfigSettings, LiffBlockType } from "@/types";
import {
  liffRootClass,
  buildMenuCards,
  type MenuCard,
  type MenuCardSource,
} from "./liff-style-helpers";
import { LiffStudioFooter, shouldShowWhaleStudioCredit } from "./LiffStudioFooter";

export interface LiffMenuHomePage {
  id:             string;
  public_id?:     string | null;
  title:          string | null;
  description:    string | null;
  page_type:      string | null;
  is_enabled:     boolean;
  publish_status?: string;
  settings_json:  LiffPageConfigSettings;
  blocks?: Array<{
    id:                        string;
    block_type:                LiffBlockType;
    sort_order?:               number;
    title:                     string | null;
    settings_json:             Record<string, unknown>;
    visibility_condition_json?: string | null;
  }>;
  created_at?: string | null;
}

interface Props {
  workTitle: string;
  pages: LiffMenuHomePage[];
  /** プレビュー時はカードクリックで親が画面切替する。実機では未指定。 */
  onSelectCard?: (page: LiffMenuHomePage) => void;
  /** 実機時に <a href> を組み立てるための builder。プレビュー時は未指定。 */
  buildPageHref?: (page: LiffMenuHomePage) => string;
  preview?: boolean;
  /** 右上閉じるボタンの handler。preview / 未指定なら非表示。 */
  onClose?: () => void;
}

export function LiffMenuHomeRenderer({
  workTitle, pages, onSelectCard, buildPageHref, preview = false, onClose,
}: Props) {
  // ── カード一覧 (並び替え + 非表示除外) ─────────────────────────────────────
  const sources: MenuCardSource[] = pages.map((p) => ({
    id:           p.id,
    public_id:    p.public_id,
    page_type:    p.page_type,
    title:        p.title,
    is_enabled:   p.is_enabled,
    settings_json: p.settings_json,
    created_at:   p.created_at,
  }));
  const cards: MenuCard[] = buildMenuCards(sources);

  // クレジット表示判定は「いずれかのページが false なら非表示」ではなく、
  // pages の中で最初に見つかった設定で決める (= 通常運用では work 内で揃っている前提)。
  const firstSettings = pages[0]?.settings_json;
  const showCredit = shouldShowWhaleStudioCredit(firstSettings);

  return (
    <div className={`liff-font ${liffRootClass(firstSettings)} min-h-screen bg-[#f6f8f7] text-[color:var(--liff-primary-text)]`}>
      <MenuHomeHeader workTitle={workTitle} onClose={preview ? undefined : onClose} />

      {/* メニュー見出し */}
      <div className="liff-player-main pt-5 pb-3">
        <h2 className="text-[18px] font-bold leading-snug">メニュー</h2>
      </div>

      {/* カードグリッド */}
      <div className="liff-player-main pb-6">
        {cards.length === 0 ? (
          <div className="bg-[color:var(--liff-surface,#fff)] border border-[#eef2f5] rounded-[20px] shadow-[0_6px_20px_rgba(31,64,92,0.06)] px-4 py-10 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              メニュー項目がまだ登録されていません
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => {
              const page = pages.find((p) => p.id === card.id);
              if (!page) return null;
              return (
                <MenuCardItem
                  key={card.id}
                  card={card}
                  page={page}
                  onSelectCard={onSelectCard}
                  buildPageHref={buildPageHref}
                />
              );
            })}
          </div>
        )}
      </div>

      {showCredit && <LiffStudioFooter />}
    </div>
  );
}

// ── 個別カード ────────────────────────────────────────────────────────────
function MenuCardItem({
  card, page, onSelectCard, buildPageHref,
}: {
  card: MenuCard;
  page: LiffMenuHomePage;
  onSelectCard?: (page: LiffMenuHomePage) => void;
  buildPageHref?: (page: LiffMenuHomePage) => string;
}) {
  const inner = (
    <>
      <div className="text-[26px] leading-none mb-2" aria-hidden="true">{card.icon}</div>
      <div className="text-[14px] font-bold leading-snug text-[color:var(--liff-primary-text)] line-clamp-2 break-words">
        {card.label}
      </div>
      {page.description && (
        <div className="mt-1.5 text-[11px] leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)] line-clamp-2 break-words">
          {page.description}
        </div>
      )}
    </>
  );

  // 管理画面トーン: 白カード + 薄い境界線 + 控えめな影 + 角丸 + 広いタップ領域。
  const baseCls = "flex flex-col items-start text-left bg-[color:var(--liff-surface,#fff)] border border-[#eef2f5] rounded-[18px] px-4 py-4 min-h-[112px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] transition-all active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] active:shadow-none";

  if (buildPageHref) {
    return (
      <a href={buildPageHref(page)} className={baseCls} aria-label={card.label}>
        {inner}
      </a>
    );
  }
  if (onSelectCard) {
    return (
      <button type="button" onClick={() => onSelectCard(page)} className={baseCls} aria-label={card.label}>
        {inner}
      </button>
    );
  }
  return <div className={baseCls} aria-label={card.label}>{inner}</div>;
}

// ── ヘッダー: 中央に作品名、右上に閉じるボタン (個別ページと共通) ─────────────
function MenuHomeHeader({
  workTitle, onClose,
}: { workTitle: string; onClose?: () => void }) {
  return (
    <header className="sticky top-0 z-10 bg-[color:var(--liff-header-bg)] border-b border-[color:var(--liff-header-border)]">
      <div className="liff-player-main flex items-center min-h-[48px] py-2">
        <div className="w-8 shrink-0" aria-hidden="true" />
        <h1 className="flex-1 text-center text-[15px] font-bold text-[color:var(--liff-header-text)] truncate">
          {workTitle}
        </h1>
        <div className="w-8 shrink-0 flex justify-end">
          {onClose && (
            <button
              type="button"
              aria-label="閉じる"
              onClick={onClose}
              className="w-8 h-8 -mr-1 inline-flex items-center justify-center rounded-full text-[color:var(--liff-secondary-text)] active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
