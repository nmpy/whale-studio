"use client";

// src/components/liff/LiffMenuHomeRenderer.tsx
//
// 作品メニューホーム — `/liff/w/[workPublicId]` の表示。
//
// 構成 (上から):
//   - ホーム画像 / 見出し / 説明文 (いずれも任意)
//   - メニュー (list: 1枚カードの縦リスト / card: 2列カードグリッド)
//   - 下部導線 (アンケート / よくある質問の枠ボタン)
//   - Powered by Whale Studio footer
//
// カードのクリック挙動:
//   - 実機: `<a href="/liff/w/[workPublicId]/p/[pagePublicId]">` で個別ページに遷移
//   - プレビュー: 親が onSelectCard を渡し、内部で個別ページ表示に切り替える
// どちらを使うかは props で渡された値で決まる。両方を渡してはいけない (a or button の片方のみ)。
//
// ※ PR-H3 visual polish: home-layout-handoff.md を参照に list/card/footer の見た目だけを調整。
//    menu データ / onSelect / href / 表示条件 / Survey・FAQ 導線条件は不変。

import type { LiffPageConfigSettings, LiffBlockType } from "@/types";
import {
  liffRootClass,
  buildMenuCards,
  type MenuCard,
  type MenuCardSource,
} from "./liff-style-helpers";
import { LiffPoweredBy, shouldShowWhaleStudioCredit, LiffEmptyState } from "./ui";

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
  /** ホームメニューの表示モード。"list" = 縦並びリスト / "card"(既定/未指定) = 2列カードグリッド。 */
  homeMenuLayout?: "card" | "list";
  /** プレビュー時はカードクリックで親が画面切替する。実機では未指定。 */
  onSelectCard?: (page: LiffMenuHomePage) => void;
  /** 実機時に <a href> を組み立てるための builder。プレビュー時は未指定。 */
  buildPageHref?: (page: LiffMenuHomePage) => string;
  preview?: boolean;
  /** 右上閉じるボタンの handler。preview / 未指定なら非表示。 */
  onClose?: () => void;
}

export function LiffMenuHomeRenderer({
  pages, homeTitle, homeDescription, homeImageUrl, homeMenuLayout,
  onSelectCard, buildPageHref,
}: Props) {
  // 表示モード。未指定/"card" は従来の2列カードグリッド（既存作品の表示を維持）。
  const isList = homeMenuLayout === "list";
  // ※ 独自ヘッダー（作品名バー + 閉じる）は実機の LINE/LIFF デフォルトヘッダーと二重化するため廃止。
  //    workTitle / preview / onClose props は後方互換で残すが描画しない。
  // ホーム見出し: 入力があるときのみ表示。空欄は何も出さない（作品名や「ホーム」への fallback はしない）。
  const heading = homeTitle?.trim() || "";
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
    <div className={`liff-font ${liffRootClass(firstSettings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      {/* ホーム画像（任意）→ 見出し（任意）→ 説明文（任意） の順。
          いずれも未設定なら本ブロックごと描画しない（余白も残さない）。
          画像は横幅いっぱいにしすぎず角丸・縦横比維持で自然に。 */}
      {(imageUrl || heading || description) && (
        <div className="liff-player-main pt-5 pb-3">
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="w-full rounded-[10px] object-cover mb-3"
              style={{ maxHeight: 220 }}
            />
          )}
          {heading && <h2 className="text-[20px] font-medium leading-snug">{heading}</h2>}
          {description && (
            <p className="mt-1.5 text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
              {description}
            </p>
          )}
        </div>
      )}

      {/* メニュー（card: 2列グリッド / list: 縦並び） + 下部導線 */}
      <div className="liff-player-main pb-6">
        {cards.length === 0 ? (
          <LiffEmptyState emoji="📭" text="ホームに表示する項目がまだ登録されていません" />
        ) : isList ? (
          // A案: 1 枚の白カード。各項目は薄い区切り線で分ける（個別カードにしない）。
          <div className="bg-[color:var(--liff-surface,#fff)] rounded-[10px] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            {cards.map((card, idx) => {
              const page = pages.find((p) => p.id === card.id);
              if (!page) return null;
              return (
                <MenuListItem
                  key={card.id}
                  card={card}
                  page={page}
                  isLast={idx === cards.length - 1}
                  onSelectCard={onSelectCard}
                  buildPageHref={buildPageHref}
                />
              );
            })}
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

        {/* 下部導線: アンケート / よくある質問（対応する公開ページがある場合のみ表示） */}
        <BottomLinks pages={pages} onSelectCard={onSelectCard} buildPageHref={buildPageHref} />
      </div>

      {showCredit && <LiffPoweredBy />}
    </div>
  );
}

// 丸いアイコンバッジ（画像 or emoji）。既存データ（card.iconImageUrl / card.icon）のみ使う。
function MenuIconBadge({ card, size }: { card: MenuCard; size: "list" | "card" }) {
  const box = size === "list" ? "w-10 h-10" : "w-9 h-9";
  if (card.iconImageUrl) {
    return <img src={card.iconImageUrl} alt="" className={`${box} rounded-full object-cover shrink-0`} />;
  }
  if (!card.icon) return null;
  return (
    <span
      className={`${box} rounded-full bg-[color:var(--liff-surface-subtle,#EFEFEF)] inline-flex items-center justify-center text-[18px] shrink-0`}
      aria-hidden="true"
    >
      {card.icon}
    </span>
  );
}

// ── 個別カード（card: 2列グリッド）────────────────────────────────────────────
function MenuCardItem({
  card, page, onSelectCard, buildPageHref,
}: {
  card: MenuCard;
  page: LiffMenuHomePage;
  onSelectCard?: (page: LiffMenuHomePage) => void;
  buildPageHref?: (page: LiffMenuHomePage) => string;
}) {
  // compact: グリッド 2 列をまたぐ横長 1 行 (アイコン左・説明省略・低い高さ)。
  // card (既定): アイコン上 / ラベル・説明下寄せ (B案 · 高さ 122px)。未設定ページは card 扱い。
  const isCompact = card.cardStyle === "compact";

  const inner = isCompact ? (
    <>
      {/* アイコン画像は任意設定時のみ表示（未設定の既存ページは従来どおりテキストのみ）。 */}
      {card.iconImageUrl && (
        <img src={card.iconImageUrl} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
      )}
      {card.label && (
        <div className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-[color:var(--liff-primary-text)] truncate">
          {card.label}
        </div>
      )}
    </>
  ) : (
    <>
      <MenuIconBadge card={card} size="card" />
      {card.label && (
        <div className="mt-auto pt-2 text-[15px] font-medium leading-snug text-[color:var(--liff-primary-text)] line-clamp-2 break-words">
          {card.label}
        </div>
      )}
      {page.description && (
        <div className="mt-1 text-[11.5px] leading-[1.4] text-[color:var(--liff-tertiary-text,#8C8C8C)] line-clamp-2 break-words">
          {page.description}
        </div>
      )}
    </>
  );

  // B案トーン: 白カード + 角丸10 + 控えめな影（0 1px 3px）+ 高さ122 + 広いタップ領域。
  const baseCls = isCompact
    ? "col-span-2 flex flex-row items-center gap-3 text-left bg-[color:var(--liff-surface,#fff)] rounded-[10px] px-4 py-3 min-h-[56px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors active:bg-[color:var(--liff-surface-subtle,#F5F5F5)]"
    : "flex flex-col items-start text-left bg-[color:var(--liff-surface,#fff)] rounded-[10px] px-4 py-4 min-h-[122px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors active:bg-[color:var(--liff-surface-subtle,#F5F5F5)]";

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

// ── リスト表示の 1 行（home_menu_layout="list"）─────────────────────────────
// 1 枚の白カード内に、丸アイコンバッジ + ラベル + 説明 + chevron を薄い区切り線で並べる。
function MenuListItem({
  card, page, isLast, onSelectCard, buildPageHref,
}: {
  card: MenuCard;
  page: LiffMenuHomePage;
  isLast: boolean;
  onSelectCard?: (page: LiffMenuHomePage) => void;
  buildPageHref?: (page: LiffMenuHomePage) => string;
}) {
  const rowCls = `w-full flex items-center gap-3.5 text-left px-4 py-4 transition-colors active:bg-[color:var(--liff-surface-subtle,#F5F5F5)] ${
    isLast ? "" : "border-b border-[color:var(--liff-border)]"
  }`;

  const body = (
    <>
      <MenuIconBadge card={card} size="list" />
      <div className="min-w-0 flex-1">
        {card.label && (
          <div className="text-[15.5px] font-medium leading-snug text-[color:var(--liff-primary-text)] truncate">
            {card.label}
          </div>
        )}
        {page.description && (
          <div className="mt-0.5 text-[12px] leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)] line-clamp-1 break-words">
            {page.description}
          </div>
        )}
      </div>
      <span aria-hidden="true" className="shrink-0 text-[color:var(--liff-tertiary-text,#8C8C8C)] text-[18px]">›</span>
    </>
  );

  if (buildPageHref) {
    return <a href={buildPageHref(page)} className={rowCls} aria-label={card.label}>{body}</a>;
  }
  if (onSelectCard) {
    return <button type="button" onClick={() => onSelectCard(page)} className={rowCls} aria-label={card.label}>{body}</button>;
  }
  return <div className={rowCls} aria-label={card.label}>{body}</div>;
}

// ── 下部導線アイコン（汎用 SVG・ブランド資産ではない）────────────────────────
function SurveyGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function FaqGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ── ホーム下部の導線（アンケート / よくある質問）─────────────────────────────
// 対応する公開ページ（page_type="survey" / "faq"）が menu API の pages に存在する場合のみ表示。
// 未作成・非公開（= pages に含まれない）の場合は何も描画しない。見た目は枠ボタン（outline）。
function BottomLinks({
  pages, onSelectCard, buildPageHref,
}: {
  pages: LiffMenuHomePage[];
  onSelectCard?: (page: LiffMenuHomePage) => void;
  buildPageHref?: (page: LiffMenuHomePage) => string;
}) {
  const survey = pages.find((p) => p.page_type === "survey");
  const faq    = pages.find((p) => p.page_type === "faq");
  if (!survey && !faq) return null;

  const Item = ({ page, label, glyph }: { page: LiffMenuHomePage; label: string; glyph: React.ReactNode }) => {
    const cls =
      "flex-1 inline-flex items-center justify-center gap-2 rounded-[10px] border border-[color:var(--liff-border-strong,#E8EAED)] px-3 py-2.5 text-[13px] font-normal text-[color:var(--liff-tertiary-text,#777)] transition-colors active:bg-[color:var(--liff-surface-subtle,#F5F5F5)]";
    const inner = (<>{glyph}<span>{label}</span></>);
    if (buildPageHref) {
      return <a href={buildPageHref(page)} className={cls} aria-label={label}>{inner}</a>;
    }
    if (onSelectCard) {
      return <button type="button" onClick={() => onSelectCard(page)} className={cls} aria-label={label}>{inner}</button>;
    }
    return <div className={cls} aria-label={label}>{inner}</div>;
  };

  return (
    <div className="mt-6 flex gap-2.5">
      {survey && <Item page={survey} label="アンケート" glyph={<SurveyGlyph />} />}
      {faq && <Item page={faq} label="よくある質問" glyph={<FaqGlyph />} />}
    </div>
  );
}
