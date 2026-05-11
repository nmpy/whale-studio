"use client";

// src/components/liff/LiffPlayerViewer.tsx
// LIFF プレイヤー画面の本体。
// route ごとに API URL だけ変えて再利用する:
//   - /liff/work/[workId]               → /api/liff/works/[workId]               (旧仕様: workId 配下の最古ページ)
//   - /liff/work/[workId]/pages/[pageId] → /api/liff/works/[workId]/pages/[pageId] (新仕様: 個別ページ指定)

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffRenderer } from "./LiffRenderer";
import { HintSiteRenderer } from "./HintSiteRenderer";
import { FaqRenderer } from "./FaqRenderer";
import { SurveyRenderer } from "./SurveyRenderer";
import { LocationHistoryRenderer } from "./LocationHistoryRenderer";
import type { LiffBlock, UserState, LiffRenderContext } from "./LiffRenderer";
import { normalizeLiffPageType } from "@/types";
import type { LiffPageType, LiffPageConfigSettings, LiffPublishStatus } from "@/types";

interface LiffPageData {
  work_id: string;
  work_title: string;
  page_id?: string;
  title: string | null;
  description: string | null;
  page_type?: LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?: LiffPageConfigSettings;
  blocks: LiffBlock[];
}

interface Props {
  workId: string;
  /** ベース API URL (?preview=1 は内部で付与する) */
  apiBaseUrl: string;
}

export function LiffPlayerViewer({ workId, apiBaseUrl }: Props) {
  const searchParams = useSearchParams();
  const isPreview = searchParams.get("preview") === "1";
  const liff = useLiffSDK();

  const [pageData, setPageData] = useState<LiffPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userState, setUserState] = useState<UserState>("before_start");

  useEffect(() => {
    if (!liff.ready) return;
    (async () => {
      try {
        const url = isPreview ? `${apiBaseUrl}?preview=1` : apiBaseUrl;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.success) {
          setError(json.error?.message || "データの取得に失敗しました");
          return;
        }
        setPageData(json.data);
      } catch {
        setError("サーバーに接続できませんでした");
      } finally {
        setLoading(false);
      }
    })();
  }, [apiBaseUrl, liff.ready, isPreview]);

  useEffect(() => {
    if (!liff.lineUserId || !workId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/runtime/progress?work_id=${workId}&line_user_id=${liff.lineUserId}`
        );
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            if (json.data.reached_ending) setUserState("completed");
            else if (json.data.current_phase_id) setUserState("in_progress");
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [liff.lineUserId, workId]);

  if (liff.loading || loading) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center px-4">
        <div className="text-center">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
            style={{
              borderColor: "var(--liff-border)",
              borderTopColor: "var(--liff-line-green, #06C755)",
            }}
          />
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center p-4">
        <div className="bg-[color:var(--liff-surface)] rounded-[12px] px-4 py-6 border border-[color:var(--liff-border)] text-center max-w-sm w-full">
          <p className="text-4xl mb-3">😢</p>
          <h2 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">エラーが発生しました</h2>
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!pageData) return null;

  const mode = normalizeLiffPageType(pageData.page_type);
  // 本文には pageData.title (LIFF ページタイトル) を使う。
  // pageData.work_title へのフォールバックはやめる (LIFF ページのタイトルが空ならヘッダーも空にする方が UX として誤解が少ない)。
  const displayTitle = pageData.title;

  const InClientBanner = !liff.isInClient && !isPreview ? (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
      <p className="text-xs text-amber-700 text-center">
        LINEアプリ内で開くと、すべての機能をご利用いただけます
      </p>
    </div>
  ) : null;

  if (mode === "hint") {
    return (
      <>
        {InClientBanner}
        <HintSiteRenderer
          config={{
            work_id:       pageData.work_id,
            title:         displayTitle,
            description:   pageData.description,
            settings_json: pageData.settings_json ?? {},
            blocks:        pageData.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })),
          }}
          preview={isPreview}
        />
      </>
    );
  }

  if (mode === "faq") {
    return (
      <>
        {InClientBanner}
        <FaqRenderer
          config={{
            title:         displayTitle,
            description:   pageData.description,
            settings_json: pageData.settings_json ?? {},
          }}
          preview={isPreview}
        />
      </>
    );
  }

  if (mode === "survey") {
    return (
      <>
        {InClientBanner}
        <SurveyRenderer
          config={{
            work_id:       pageData.work_id,
            title:         displayTitle,
            description:   pageData.description,
            settings_json: pageData.settings_json ?? {},
          }}
          preview={isPreview}
          lineUserId={liff.lineUserId}
        />
      </>
    );
  }

  if (mode === "location") {
    return (
      <>
        {InClientBanner}
        <LocationHistoryRenderer
          config={{
            work_id:       pageData.work_id,
            title:         displayTitle,
            description:   pageData.description,
            settings_json: pageData.settings_json ?? {},
          }}
          lineUserId={liff.lineUserId}
          preview={isPreview}
        />
      </>
    );
  }

  const ctx: LiffRenderContext = {
    userState,
    progress: { current: 0, total: 1 },
    evidences: [],
    hints: [],
    characters: [],
    canResume: userState === "in_progress",
    onStart: async () => {
      if (!liff.lineUserId) {
        alert("LINE にログインしてください");
        return;
      }
      try {
        const res = await fetch("/api/runtime/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_id: workId, line_user_id: liff.lineUserId }),
        });
        if (res.ok) setUserState("in_progress");
      } catch {
        alert("開始に失敗しました。もう一度お試しください。");
      }
    },
    onResume: async () => {
      alert("LINEトーク画面に戻って続きをプレイしてください");
    },
  };

  return (
    <div>
      {InClientBanner}
      <LiffRenderer
        blocks={pageData.blocks}
        title={displayTitle}
        ctx={ctx}
        settings={pageData.settings_json ?? {}}
        preview={isPreview}
      />
    </div>
  );
}
