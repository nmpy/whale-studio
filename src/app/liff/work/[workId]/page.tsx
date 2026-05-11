"use client";

// src/app/liff/work/[workId]/page.tsx
// LIFF表示ページ — LINE内ブラウザ / 外部ブラウザ両対応

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffRenderer } from "@/components/liff/LiffRenderer";
import { HintSiteRenderer } from "@/components/liff/HintSiteRenderer";
import { FaqRenderer } from "@/components/liff/FaqRenderer";
import { SurveyRenderer } from "@/components/liff/SurveyRenderer";
import { LocationHistoryRenderer } from "@/components/liff/LocationHistoryRenderer";
import type { LiffBlock, UserState, LiffRenderContext } from "@/components/liff/LiffRenderer";
import { normalizeLiffPageType } from "@/types";
import type { LiffPageType, LiffPageConfigSettings, LiffPublishStatus } from "@/types";

interface LiffPageData {
  work_id: string;
  work_title: string;
  title: string | null;
  description: string | null;
  page_type?: LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?: LiffPageConfigSettings;
  blocks: LiffBlock[];
}

export default function LiffViewerPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workId = params.workId as string;
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
        const url = isPreview
          ? `/api/liff/works/${workId}?preview=1`
          : `/api/liff/works/${workId}`;
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
  }, [workId, liff.ready, isPreview]);

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

  // 旧 "hint_site" は "hint" に正規化（DB の生値が古い場合の互換対応）。
  const mode = normalizeLiffPageType(pageData.page_type);

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
            title:         pageData.title || pageData.work_title,
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
            title:         pageData.title || pageData.work_title,
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
            title:         pageData.title || pageData.work_title,
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
            title:         pageData.title || pageData.work_title,
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
      {!liff.isInClient && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <p className="text-xs text-amber-700 text-center">
            LINEアプリ内で開くと、すべての機能をご利用いただけます
          </p>
        </div>
      )}

      <LiffRenderer
        blocks={pageData.blocks}
        title={pageData.title || pageData.work_title}
        ctx={ctx}
        settings={pageData.settings_json ?? {}}
        preview={isPreview}
      />
    </div>
  );
}
