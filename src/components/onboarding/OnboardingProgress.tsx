"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onboardingApi, getDevToken } from "@/lib/api-client";

interface Props {
  oaId:           string;
  workId:         string;
  hasCharacters:  boolean;
  hasPhases:      boolean;
  hasMessages:    boolean;
  hasTransitions: boolean;
}

const STEPS: { key: string; label: string; href: string; isPreview?: boolean }[] = [
  { key: "work",      label: "作品作成",          href: "" },
  { key: "character", label: "キャラクター作成",   href: "characters" },
  { key: "phase",     label: "フェーズ作成",       href: "scenario" },
  { key: "message",   label: "メッセージ・謎追加", href: "messages" },
  { key: "scenario",  label: "フロー設定",         href: "scenario" },
  { key: "preview",   label: "プレビュー確認",     href: "preview", isPreview: true },
];

type StepKey = "work" | "character" | "phase" | "message" | "scenario" | "preview";

/**
 * OnboardingProgress — 作品ハブ上部に表示するセットアップ進捗ステッパー
 *
 * 進捗ロジック:
 *   - work      : 常に true
 *   - character : props.hasCharacters
 *   - phase     : props.hasPhases
 *   - message   : props.hasMessages
 *   - scenario  : props.hasTransitions
 *   - preview   : localStorage "preview-confirmed-{workId}"
 *
 * 全ステップ完了 or ユーザー非表示 → null を返す
 */
export function OnboardingProgress({
  oaId, workId,
  hasCharacters, hasPhases, hasMessages, hasTransitions,
}: Props) {
  const [mounted,     setMounted]     = useState(false);
  const [dismissed,   setDismissed]   = useState(false);
  const [hasPreviewed, setHasPreviewed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(`setup-guide-dismissed-${workId}`)) setDismissed(true);
      if (localStorage.getItem(`preview-confirmed-${workId}`))     setHasPreviewed(true);
    } catch {}
  }, [workId]);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(`setup-guide-dismissed-${workId}`, "1"); } catch {}
  }

  if (!mounted || dismissed) return null;

  const completion: Record<StepKey, boolean> = {
    work:      true,
    character: hasCharacters,
    phase:     hasPhases,
    message:   hasMessages,
    scenario:  hasTransitions,
    preview:   hasPreviewed,
  };

  const allDone = STEPS.every((s) => completion[s.key as StepKey]);
  if (allDone) return null;

  const doneCount = STEPS.filter((s) => completion[s.key as StepKey]).length;
  const pct       = Math.round((doneCount / STEPS.length) * 100);
  const nextStep  = STEPS.find((s) => !completion[s.key as StepKey]);
  const basePath  = `/oas/${oaId}/works/${workId}`;

  return (
    <div
      className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-emerald-50 relative"
      style={{ padding: "14px 16px", marginBottom: 20 }}
    >
      {/* 非表示ボタン */}
      <button
        onClick={dismiss}
        aria-label="ガイドを非表示"
        className="absolute text-neutral-300 hover:text-neutral-400 transition-colors"
        style={{ top: 10, right: 12, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
      >
        ✕
      </button>

      {/* ヘッダー */}
      <div className="flex items-center" style={{ gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 15 }}>🚀</span>
        <div>
          <div className="font-bold text-sky-700" style={{ fontSize: 12 }}>
            セットアップの進捗
          </div>
          <div className="text-neutral-400" style={{ fontSize: 11 }}>
            {doneCount} / {STEPS.length} ステップ完了（{pct}%）
          </div>
        </div>
      </div>

      {/* プログレスバー */}
      <div
        className="rounded-full overflow-hidden bg-neutral-200"
        style={{ height: 5, marginBottom: 12 }}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
          style={{ width: `${pct}%`, transition: "width 0.5s ease" }}
        />
      </div>

      {/* ステップ一覧 */}
      <div className="flex flex-col" style={{ gap: 4 }}>
        {STEPS.map((step, i) => {
          const done   = completion[step.key as StepKey];
          const isNext = step.key === nextStep?.key;

          const href = step.isPreview
            ? `/playground?work_id=${workId}&oa_id=${oaId}`
            : step.href
              ? `${basePath}/${step.href}`
              : "";

          return (
            <div
              key={step.key}
              className={[
                "flex items-center rounded-xl transition-colors",
                isNext ? "bg-white border border-sky-200 shadow-sm" : "",
              ].join(" ")}
              style={{ gap: 8, padding: isNext ? "7px 10px" : "3px 10px" }}
            >
              {/* アイコン */}
              <span className="flex-shrink-0 text-center" style={{ fontSize: 12, width: 16 }}>
                {done ? "✅" : isNext ? "👉" : "○"}
              </span>

              {/* ラベル */}
              <span
                className={[
                  "flex-1",
                  done   ? "line-through text-neutral-400" :
                  isNext ? "font-semibold text-sky-800"    :
                           "text-neutral-400",
                ].join(" ")}
                style={{ fontSize: 12 }}
              >
                {i + 1}. {step.label}
              </span>

              {/* 次へリンク */}
              {isNext && href && (
                <Link
                  href={href}
                  className="flex-shrink-0 font-semibold text-sky-600 bg-sky-100 hover:bg-sky-200 rounded-lg transition-colors"
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => {
                    if (step.isPreview) {
                      try { localStorage.setItem(`preview-confirmed-${workId}`, "1"); } catch {}
                      // オンボーディング: previewed ステップを記録（fire-and-forget）
                      onboardingApi.trackStep(getDevToken(), { work_id: workId, oa_id: oaId, step: "previewed" }).catch(() => {});
                    }
                  }}
                >
                  →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
