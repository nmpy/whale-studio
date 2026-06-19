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
import { LiffPoweredBy, shouldShowWhaleStudioCredit } from "./ui";
import { LiffCard } from "./primitives";

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
              className="w-full rounded-2xl object-cover mb-3"
              style={{ maxHeight: 220 }}
            />
          )}
          {heading && <h2 className="text-[18px] font-bold leading-snug">{heading}</h2>}
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
          <div className="bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border)] rounded-[20px] shadow-[0_6px_20px_rgba(31,64,92,0.06)] px-4 py-10 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              ホームに表示する項目がまだ登録されていません
            </p>
          </div>
        ) : isList ? (
          <div className="flex flex-col gap-2.5">
            {cards.map((card) => {
              const page = pages.find((p) => p.id === card.id);
              if (!page) return null;
              return (
                <MenuListItem
                  key={card.id}
                  card={card}
                  page={page}
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
      {/* アイコン画像は任意設定時のみ表示（未設定の既存ページは従来どおりテキストのみ）。 */}
      {card.iconImageUrl && (
        <img src={card.iconImageUrl} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
      )}
      {card.label && (
        <div className="min-w-0 flex-1 text-[14px] font-bold leading-snug text-[color:var(--liff-primary-text)] truncate">
          {card.label}
        </div>
      )}
    </>
  ) : (
    <>
      {/* アイコン画像は任意設定時のみ表示（未設定の既存ページは従来どおりテキストのみ）。 */}
      {card.iconImageUrl && (
        <img src={card.iconImageUrl} alt="" className="w-9 h-9 rounded-lg object-cover mb-2" />
      )}
      {card.label && (
        <div className="text-[14px] font-bold leading-snug text-[color:var(--liff-primary-text)] line-clamp-2 break-words">
          {card.label}
        </div>
      )}
      {page.description && (
        <div className="mt-1.5 text-[11px] leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)] line-clamp-2 break-words">
          {page.description}
        </div>
      )}
    </>
  );

  // 管理画面トーン: 白カード + 薄い境界線 + 控えめな影 + 角丸 + 広いタップ領域。
  const baseCls = isCompact
    ? "col-span-2 flex flex-row items-center gap-3 text-left bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border)] rounded-[14px] px-4 py-3 min-h-[56px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] transition-all active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] active:shadow-none"
    : "flex flex-col items-start text-left bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border)] rounded-[18px] px-4 py-4 min-h-[112px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] transition-all active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] active:shadow-none";

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
// 共通プリミティブ LiffCard を使い、アイコン（画像 or emoji）+ ラベル + 説明を横並びにする。
function MenuListItem({
  card, page, onSelectCard, buildPageHref,
}: {
  card: MenuCard;
  page: LiffMenuHomePage;
  onSelectCard?: (page: LiffMenuHomePage) => void;
  buildPageHref?: (page: LiffMenuHomePage) => string;
}) {
  const icon = card.iconImageUrl ? (
    <img src={card.iconImageUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
  ) : (
    <span
      className="w-10 h-10 rounded-xl bg-[color:var(--liff-surface-subtle,#FAFAFA)] inline-flex items-center justify-center text-[20px] shrink-0"
      aria-hidden="true"
    >
      {card.icon}
    </span>
  );

  const body = (
    <div className="flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        {card.label && (
          <div className="text-[15px] font-bold leading-snug text-[color:var(--liff-primary-text)] truncate">
            {card.label}
          </div>
        )}
        {page.description && (
          <div className="mt-0.5 text-[12px] leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)] line-clamp-1 break-words">
            {page.description}
          </div>
        )}
      </div>
      <span aria-hidden="true" className="text-[color:var(--liff-tertiary-text,#8C8C8C)] text-[18px] shrink-0">›</span>
    </div>
  );

  if (buildPageHref) {
    return <LiffCard as="a" href={buildPageHref(page)} padding="md" aria-label={card.label}>{body}</LiffCard>;
  }
  if (onSelectCard) {
    return <LiffCard as="button" onClick={() => onSelectCard(page)} padding="md" aria-label={card.label}>{body}</LiffCard>;
  }
  return <LiffCard padding="md" aria-label={card.label}>{body}</LiffCard>;
}

// ── ホーム下部の導線（アンケート / よくある質問）─────────────────────────────
// 対応する公開ページ（page_type="survey" / "faq"）が menu API の pages に存在する場合のみ表示。
// 未作成・非公開（= pages に含まれない）の場合は何も描画しない。
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

  const Item = ({ page, label }: { page: LiffMenuHomePage; label: string }) => {
    const body = (
      <span className="flex items-center justify-between">
        <span className="text-[14px] font-bold text-[color:var(--liff-primary-text)]">{label}</span>
        <span aria-hidden="true" className="text-[color:var(--liff-tertiary-text,#8C8C8C)] text-[18px]">›</span>
      </span>
    );
    if (buildPageHref) {
      return <LiffCard as="a" href={buildPageHref(page)} padding="md" aria-label={label}>{body}</LiffCard>;
    }
    if (onSelectCard) {
      return <LiffCard as="button" onClick={() => onSelectCard(page)} padding="md" aria-label={label}>{body}</LiffCard>;
    }
    return <LiffCard padding="md" aria-label={label}>{body}</LiffCard>;
  };

  return (
    <div className="mt-5 flex flex-col gap-2.5">
      {survey && <Item page={survey} label="アンケート" />}
      {faq && <Item page={faq} label="よくある質問" />}
    </div>
  );
}
