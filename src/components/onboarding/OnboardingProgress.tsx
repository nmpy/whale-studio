"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Accordion } from "@/components/shared";
import { SETUP_STEPS, computeSetupProgress } from "@/lib/onboarding-setup";

interface Props {
  oaId:           string;
  workId:         string;
  hasCharacters:  boolean;
  hasPhases:      boolean;
  hasMessages:    boolean;
  hasTransitions: boolean;
}

/**
 * OnboardingProgress — 作品ハブ上部に表示するセットアップ進捗ステッパー
 *
 * 進捗ロジック（4ステップ・@/lib/onboarding-setup に集約）:
 *   - work      : 常に true
 *   - character : props.hasCharacters
 *   - phase     : props.hasPhases
 *   - message   : props.hasMessages
 *
 * ※ セットアップステップから削除済み:
 *    - 「プレビュー確認」: 実機LINEで確認する運用のため。
 *    - 「フロー設定」    : 任意タスク扱い（フロー機能そのものは不変）。props.hasTransitions は
 *                          受け取るが進捗判定には使わない。
 * 全ステップ完了 or ユーザー非表示 → null を返す
 */
export function OnboardingProgress({
  oaId, workId,
  hasCharacters, hasPhases, hasMessages, hasTransitions,
}: Props) {
  const [mounted,   setMounted]   = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(`setup-guide-dismissed-${workId}`)) setDismissed(true);
    } catch {}
  }, [workId]);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(`setup-guide-dismissed-${workId}`, "1"); } catch {}
  }

  if (!mounted || dismissed) return null;

  const { completion, doneCount, pct, nextKey, allDone } = computeSetupProgress({
    hasCharacters, hasPhases, hasMessages, hasTransitions,
  });
  if (allDone) return null;

  const STEPS    = SETUP_STEPS;
  const nextStep = STEPS.find((s) => s.key === nextKey) ?? null;
  const basePath = `/oas/${oaId}/works/${workId}`;

  return (
    // 共通 Accordion でラップし、デザインガイド §4「Accordion」+ §6「ヘルプを開きっぱなし NG」に揃える。
    // defaultOpen=false で初期は閉じた状態。summary で進捗 (件数 + %) を閉じたまま見せる。
    <div style={{ marginBottom: 16, position: "relative" }}>
      {/* 非表示ボタン: Accordion ヘッダーの上に absolute 配置。クリック時に Accordion 開閉は発生させない (stopPropagation)。 */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        aria-label="ガイドを非表示"
        className="absolute text-neutral-300 hover:text-neutral-400 transition-colors z-10"
        style={{ top: 12, right: 44, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}
      >
        ✕
      </button>
      <Accordion
        title={<span style={{ color: "#9ca3af", fontWeight: 500, fontSize: 12 }}>セットアップの進捗</span>}
        summary={`${doneCount} / ${STEPS.length} 完了（${pct}%）`}
        helpTone
        defaultOpen={false}
      >
        {/* プログレスバー */}
        <div
          className="rounded-full overflow-hidden bg-neutral-200 mt-1"
          style={{ height: 4, marginBottom: 10 }}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
            style={{ width: `${pct}%`, transition: "width 0.5s ease" }}
          />
        </div>

        {/* ステップ一覧 */}
        <div className="flex flex-col" style={{ gap: 4 }}>
          {STEPS.map((step, i) => {
            const done   = completion[step.key];
            const isNext = step.key === nextStep?.key;

            const href = step.href ? `${basePath}/${step.href}` : "";

            return (
              <div
                key={step.key}
                className={[
                  "flex items-center rounded-xl transition-colors",
                  isNext ? "bg-white border border-sky-200 shadow-sm" : "",
                ].join(" ")}
                style={{ gap: 8, padding: isNext ? "6px 9px" : "3px 9px" }}
              >
                {/* アイコン */}
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                  background: done ? "#dcfce7" : isNext ? "#dbeafe" : "#f3f4f6",
                  color:      done ? "#16a34a" : isNext ? "#1d4ed8" : "#9ca3af",
                  border:     `1px solid ${done ? "#86efac" : isNext ? "#93c5fd" : "#e5e7eb"}`,
                  flexShrink: 0,
                }}>
                  {done ? "✓" : i + 1}
                </span>

                {/* ラベル */}
                <span
                  className={[
                    "flex-1",
                    done   ? "line-through text-neutral-400" :
                    isNext ? "font-semibold text-sky-800"    :
                             "text-neutral-400",
                  ].join(" ")}
                  style={{ fontSize: 11 }}
                >
                  {i + 1}. {step.label}
                </span>

                {/* 次へリンク */}
                {isNext && href && (
                  <Link
                    href={href}
                    className="flex-shrink-0 font-semibold text-sky-600 bg-sky-100 hover:bg-sky-200 rounded-lg transition-colors"
                    style={{ fontSize: 11, padding: "3px 8px" }}
                  >
                    →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </Accordion>
    </div>
  );
}
