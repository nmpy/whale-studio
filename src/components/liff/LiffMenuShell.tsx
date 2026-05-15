"use client";

// src/components/liff/LiffMenuShell.tsx
//
// 作品メニュー shell — 1 つの work 配下の複数 LiffPageConfig をタブで束ねて表示する。
//
// 設計方針:
//   - 既存の LiffPageConfig / LiffPageBlock をそのまま参照する (DB 構造変更なし)
//   - 各タブは pageType 別の既存 renderer (HintSiteRenderer / FaqRenderer /
//     SurveyRenderer / LocationHistoryRenderer / CharacterRenderer / LiffRenderer)
//     を delegate して使う。Studio プレビューと実機 LIFF で完全に同じ renderer。
//   - ヘッダー (LIFF 上部バー) = work_title を document.title で同期
//   - 画面内: 「メニュー」見出し + 横スクロール可能なタブバー + active タブの本文
//   - URL 同期: ?tab=hint で active タブを切り替え可能 (location.hash 等は使わない)
//   - 左右 16px padding は `.liff-player-main` で保証 (PR #57 で導入)

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type {
  LiffPageConfigSettings,
  LiffBlockType,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
} from "@/types";
import { normalizeLiffPageType } from "@/types";
import { HintSiteRenderer, type HintSiteBlock } from "./HintSiteRenderer";
import { FaqRenderer } from "./FaqRenderer";
import { SurveyRenderer } from "./SurveyRenderer";
import { LocationHistoryRenderer } from "./LocationHistoryRenderer";
import { CharacterRenderer, type CharacterRendererBlock } from "./CharacterRenderer";
import { LiffRenderer, type LiffBlock, type LiffRenderContext } from "./LiffRenderer";
import {
  liffRootClass,
  resolveHeaderTitle,
  buildMenuTabs,
  type MenuTab,
} from "./liff-style-helpers";
import { LiffPlayerProvider } from "./LiffPlayerContext";

/** メニュー shell 用の per-page 入力。API レスポンス / プレビュー側の両方からこの形で渡す。 */
export interface LiffMenuPage {
  id:             string;
  public_id?:     string | null;
  title:          string | null;
  description:    string | null;
  page_type:      string | null;
  is_enabled:     boolean;
  publish_status?: string;
  settings_json:  LiffPageConfigSettings;
  blocks: Array<{
    id:                        string;
    block_type:                LiffBlockType;
    sort_order?:               number;
    title:                     string | null;
    settings_json:             Record<string, unknown>;
    visibility_condition_json?: string | null;
  }>;
}

interface Props {
  workId:     string;
  workTitle:  string;
  pages:      LiffMenuPage[];
  /** /p/[publicId] でアクセスされたとき、この publicId と一致するページを初期 active タブにする。 */
  activePagePublicId?: string | null;
  /** プレビュー (CMS 側) のときは shareTargetPicker や API 送信を止める。 */
  preview?:   boolean;
  /** LIFF SDK 取得済みのユーザー ID。 */
  lineUserId?: string | null;
  /** "default" page 用の最小 render context。 */
  defaultPageCtx?: LiffRenderContext;
  /** 右上の閉じるボタンが押されたとき。preview 中は呼ばない。 */
  onClose?:   () => void;
  /** URL ?tab=xxx の同期を行うか。プレビューでは false 推奨。 */
  syncUrl?:   boolean;
}

const DEFAULT_RENDER_CTX: LiffRenderContext = {
  userState: "before_start",
  progress:  { current: 0, total: 1 },
  evidences: [],
  hints:     [],
  characters: [],
  canResume: false,
};

export function LiffMenuShell({
  workId,
  workTitle,
  pages,
  activePagePublicId,
  preview = false,
  lineUserId = null,
  defaultPageCtx = DEFAULT_RENDER_CTX,
  onClose,
  syncUrl = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── タブ一覧 (raw page → 並び替え済み + 非表示除外) ────────────────────────
  const tabs: MenuTab[] = useMemo(
    () => buildMenuTabs(
      pages.map((p) => ({
        id:           p.id,
        public_id:    p.public_id,
        page_type:    p.page_type,
        title:        p.title,
        is_enabled:   p.is_enabled,
        settings_json: p.settings_json,
      }))
    ),
    [pages]
  );

  // ── 初期 active タブ ────────────────────────────────────────────────────────
  // 優先順位:
  //   1. URL ?tab=xxx (syncUrl 有効時)
  //   2. activePagePublicId (= /p/[publicId] でアクセスされたケース)
  //   3. タブ並び順の先頭
  const initialActiveTabId = useMemo(() => {
    if (tabs.length === 0) return null;
    if (syncUrl) {
      const q = searchParams?.get("tab");
      if (q) {
        const byType = tabs.find((t) => t.pageType === q);
        if (byType) return byType.id;
      }
    }
    if (activePagePublicId) {
      const byPublic = tabs.find((t) => t.publicId === activePagePublicId);
      if (byPublic) return byPublic.id;
    }
    return tabs[0].id;
    // searchParams / activePagePublicId は初期値だけ参照する想定なので deps から除外。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map((t) => t.id).join(",")]);

  const [activeTabId, setActiveTabId] = useState<string | null>(initialActiveTabId);

  // tabs が再計算されて activeTabId が消えた場合は先頭に倒す。
  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTabId(null);
      return;
    }
    if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );
  const activePage = useMemo(
    () => pages.find((p) => p.id === activeTabId) ?? null,
    [pages, activeTabId]
  );

  // ── document.title をヘッダー文言 (= work_title) と同期 ─────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    const settings = activePage?.settings_json;
    const title = resolveHeaderTitle({
      settings,
      workTitle,
      pageTitle: activePage?.title,
    });
    document.title = title;
  }, [workTitle, activePage]);

  // ── URL ?tab=xxx 同期 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!syncUrl) return;
    if (!activeTab || typeof window === "undefined") return;
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (sp.get("tab") === activeTab.pageType) return;
    sp.set("tab", activeTab.pageType);
    const next = `${pathname}?${sp.toString()}`;
    router.replace(next, { scroll: false });
  }, [activeTab, syncUrl, pathname, router, searchParams]);

  // ── 空状態: pages 自体が無い ──────────────────────────────────────────────
  if (tabs.length === 0 || !activeTab || !activePage) {
    return (
      <div className={`liff-font ${liffRootClass(undefined)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
        <MenuHeader workTitle={workTitle} onClose={preview ? undefined : onClose} />
        <main className="liff-player-main pt-4 pb-8">
          <h2 className="text-[18px] font-bold mb-6">メニュー</h2>
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-8 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              メニュー項目がまだ登録されていません
            </p>
          </div>
        </main>
      </div>
    );
  }

  const playerCtxValue = {
    workId,
    pageId:     activePage.id,
    lineUserId,
    preview,
  };

  return (
    <LiffPlayerProvider value={playerCtxValue}>
      <div className={`liff-font ${liffRootClass(activePage.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
        <MenuHeader workTitle={workTitle} onClose={preview ? undefined : onClose} />

        {/* メニュー見出し */}
        <div className="liff-player-main pt-4 pb-3">
          <h2 className="text-[18px] font-bold leading-snug">メニュー</h2>
        </div>

        {/* 横スクロール可能なタブバー。`liff-player-main` で 16px padding を確保しつつ
            タブ自体は `overflow-x-auto` で横スクロール可能にする。 */}
        <div className="liff-player-main pb-3">
          <div
            role="tablist"
            aria-label="作品メニュー"
            className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&amp;::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  className={[
                    "shrink-0 px-4 min-h-[40px] rounded-full text-[14px] font-semibold transition-colors active:opacity-80",
                    isActive
                      ? "bg-[color:var(--liff-line-green)] text-white"
                      : "bg-[color:var(--liff-surface-subtle,#FAFAFA)] text-[color:var(--liff-primary-text)] border border-[color:var(--liff-border)]",
                  ].join(" ")}
                >
                  {tab.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* タブ本文の上に「ページ内タイトル」を表示。 */}
        <div className="liff-player-main pt-2 pb-1">
          <h3 className="text-[17px] font-bold leading-snug">{activeTab.pageTitle}</h3>
        </div>

        {/* タブ本文 — pageType ごとの既存 renderer に委譲。
            各 renderer は自分で `.liff-player-main` を付けて 16px padding を確保するため、
            ここでは追加の padding ラッパーを置かない (二重 padding を防ぐ)。 */}
        <ActiveTabContent
          workId={workId}
          page={activePage}
          activePageType={activeTab.pageType}
          preview={preview}
          lineUserId={lineUserId}
          defaultPageCtx={defaultPageCtx}
        />
      </div>
    </LiffPlayerProvider>
  );
}

// ── ヘッダー: 中央に作品名、右上に閉じるボタン ────────────────────────────────
function MenuHeader({
  workTitle, onClose,
}: { workTitle: string; onClose?: () => void }) {
  return (
    <header className="sticky top-0 z-10 bg-[color:var(--liff-header-bg)] border-b border-[color:var(--liff-header-border)]">
      <div className="liff-player-main flex items-center min-h-[48px] py-2">
        {/* 中央寄せのために左右 placeholder を出す */}
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

// ── pageType ごとの renderer を delegate ────────────────────────────────────
function ActiveTabContent({
  workId,
  page,
  activePageType,
  preview,
  lineUserId,
  defaultPageCtx,
}: {
  workId: string;
  page: LiffMenuPage;
  activePageType: ReturnType<typeof normalizeLiffPageType>;
  preview: boolean;
  lineUserId: string | null;
  defaultPageCtx: LiffRenderContext;
}) {
  const settings = page.settings_json;

  switch (activePageType) {
    case "hint":
      return (
        <HintSiteRenderer
          preview={preview}
          config={{
            work_id:       workId,
            work_title:    null,
            // shell 側で pageTitle を既に表示済みなので renderer 側の h2 表示は廃止済み。
            title:         page.title,
            description:   page.description,
            settings_json: settings,
            blocks: page.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })) as HintSiteBlock[],
          }}
        />
      );
    case "faq":
      return (
        <FaqRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "survey":
      return (
        <SurveyRenderer
          preview={preview}
          lineUserId={lineUserId}
          config={{
            work_id:       workId,
            page_id:       page.id,
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "location":
      return (
        <LocationHistoryRenderer
          preview={preview}
          lineUserId={lineUserId}
          config={{
            work_id:       workId,
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "character":
      return (
        <CharacterRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
            blocks: page.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })) as CharacterRendererBlock[],
          }}
        />
      );
    case "default":
    default:
      return (
        <LiffRenderer
          preview={preview}
          workTitle={null}
          title={page.title}
          settings={settings}
          ctx={defaultPageCtx}
          blocks={page.blocks.map((b) => ({
            id:                        b.id,
            block_type:                b.block_type,
            sort_order:                b.sort_order ?? 0,
            title:                     b.title,
            settings_json:             (b.settings_json ?? {}) as Record<string, unknown>,
            visibility_condition_json: (b.visibility_condition_json ?? null) as LiffBlock["visibility_condition_json"],
          }))}
        />
      );
  }
}

// HintSiteBlock 型 import 経由でも参照したいので re-export
export type { HintSiteBlock };
