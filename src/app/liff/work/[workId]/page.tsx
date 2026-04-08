"use client";

// src/app/liff/work/[workId]/page.tsx
// LIFF表示ページ — LINE内ブラウザ / 外部ブラウザ両対応
// LIFF SDK 初期化は useLiffSDK hook に委譲

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffRenderer } from "@/components/liff/LiffRenderer";
import type { LiffBlock, UserState, LiffRenderContext } from "@/components/liff/LiffRenderer";

interface LiffPageData {
  work_id: string;
  work_title: string;
  title: string | null;
  description: string | null;
  blocks: LiffBlock[];
}

export default function LiffViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  const liff = useLiffSDK();

  const [pageData, setPageData] = useState<LiffPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userState, setUserState] = useState<UserState>("before_start");

  // ── ページデータ取得 ───────────────────────────
  useEffect(() => {
    if (!liff.ready) return;

    (async () => {
      try {
        const res = await fetch(`/api/liff/works/${workId}`);
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
  }, [workId, liff.ready]);

  // ── UserProgress 取得 ──────────────────────────
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
        // プログレス取得失敗は無視（before_start のまま）
      }
    })();
  }, [liff.lineUserId, workId]);

  // ── Loading ────────────────────────────────────
  if (liff.loading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 shadow-sm text-center max-w-sm w-full">
          <p className="text-4xl mb-3">😢</p>
          <h2 className="text-base font-semibold text-gray-900 mb-2">エラーが発生しました</h2>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!pageData) return null;

  // ── Render context ─────────────────────────────
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
      />
    </div>
  );
}
