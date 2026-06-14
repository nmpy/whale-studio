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
  /** ホーム見出し（作品単位の任意設定）。未設定/空のとき「ホーム」を表示。 */
  homeTitle?: string | null;
  /** ホーム説明文（複数行可）。未設定/空のとき非表示。 */
  homeDescription?: string | null;
  /** ホーム画像 URL。未設定/空のとき非表示。見出しの上に表示。 */
  homeImageUrl?: string | null;
  /** プレビュー時はカードクリックで親が画面切替する。実機では未指定。 */
  onSelectCard?: (page: LiffMenuHomePage) => void;
  /** 実機時に <a href> を組み立てるための builder。プレビュー時は未指定。 */
  buildPageHref?: (page: LiffMenuHomePage) => string;
  preview?: boolean;
  /** 右上閉じるボタンの handler。preview / 未指定なら非表示。 */
  onClose?: () => void;
}

export function LiffMenuHomeRenderer({
  pages, homeTitle, homeDescription, homeImageUrl,
  onSelectCard, buildPageHref,
}: Props) {
  // ※ 独自ヘッダー（作品名バー + 閉じる）は実機の LINE/LIFF デフォルトヘッダーと二重化するため廃止。
  //    workTitle / preview / onClose props は後方互換で残すが描画しない。
  // ホーム見出し: 未設定/空のとき従来どおり「ホーム」。
  const heading = homeTitle?.trim() || "ホーム";
  const description = homeDescription?.trim() ? homeDescription : null;
  const imageUrl = homeImageUrl?.trim() || null;
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
      {/* ホーム画像（任意）→ 見出し → 説明文（任意） の順。
          画像は横幅いっぱいにしすぎず角丸・縦横比維持で自然に。未設定時は従来表示。 */}
      <div className="liff-player-main pt-5 pb-3">
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="w-full rounded-2xl object-cover mb-3"
            style={{ maxHeight: 220 }}
          />
        )}
        <h2 className="text-[18px] font-bold leading-snug">{heading}</h2>
        {description && (
          <p className="mt-1.5 text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
            {description}
          </p>
        )}
      </div>

      {/* カードグリッド */}
      <div className="liff-player-main pb-6">
        {cards.length === 0 ? (
          <div className="bg-[color:var(--liff-surface,#fff)] border border-[#eef2f5] rounded-[20px] shadow-[0_6px_20px_rgba(31,64,92,0.06)] px-4 py-10 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              ホームに表示する項目がまだ登録されていません
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
  // compact: グリッド 2 列をまたぐ横長 1 行 (アイコン左・説明省略・低い高さ)。
  // card (既定): 従来どおり縦並びのグリッドセル。未設定ページは必ず card 扱い。
  const isCompact = card.cardStyle === "compact";

  const inner = isCompact ? (
    <>
      <div className="text-[22px] leading-none shrink-0" aria-hidden="true">{card.icon}</div>
      <div className="min-w-0 flex-1 text-[14px] font-bold leading-snug text-[color:var(--liff-primary-text)] truncate">
        {card.label}
      </div>
    </>
  ) : (
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
  const baseCls = isCompact
    ? "col-span-2 flex flex-row items-center gap-3 text-left bg-[color:var(--liff-surface,#fff)] border border-[#eef2f5] rounded-[14px] px-4 py-3 min-h-[56px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] transition-all active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] active:shadow-none"
    : "flex flex-col items-start text-left bg-[color:var(--liff-surface,#fff)] border border-[#eef2f5] rounded-[18px] px-4 py-4 min-h-[112px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] transition-all active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] active:shadow-none";

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
