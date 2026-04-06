"use client";

/**
 * SetupStepper — 新規作品のセットアップ進捗を表示するコンパクトなガイドUI
 *
 * 進捗ロジック:
 *   1. 作品作成        — 常に完了（このコンポーネントが表示されている時点で完了）
 *   2. キャラクター作成 — work._count.characters > 0
 *   3. フェーズ作成    — localStorage "phase-created-{workId}" (scenario/page.tsx がセット)
 *   4. メッセージ・謎  — work._count.messages > 0
 *   5. シナリオフロー  — localStorage "scenario-setup-{workId}" (scenario/page.tsx がセット)
 *   6. プレビュー確認  — localStorage "preview-confirmed-{workId}" (hub の▶ボタンクリックでセット)
 *
 * 全ステップ完了後、または localStorage に dismiss フラグがある場合は非表示になる。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WorkListItem } from "@/lib/api-client";

interface StepDef {
  key: string;
  label: string;
  desc: string;
  href: string;          // "" = アクションなし（already done）
  isExternal?: boolean;  // playground などアプリ外
}

const STEPS: StepDef[] = [
  { key: "work",      label: "作品作成",          desc: "タイトルや説明を設定",           href: "" },
  { key: "character", label: "キャラクター作成",   desc: "名前・アイコンを設定",           href: "characters" },
  { key: "phase",     label: "フェーズ作成",       desc: "開始〜エンディングの場面を作る", href: "scenario" },
  { key: "message",   label: "メッセージ・謎追加", desc: "会話や謎チャレンジを作成",       href: "messages" },
  { key: "scenario",  label: "シナリオフロー設定", desc: "フェーズの分岐・遷移を整理",     href: "scenario" },
  { key: "preview",   label: "プレビュー確認",     desc: "実際の体験に近い形で確認",       href: "preview", isExternal: true },
];

interface Props {
  work:   WorkListItem;
  oaId:   string;
  workId: string;
}

export function SetupStepper({ work, oaId, workId }: Props) {
  const [mounted,      setMounted]      = useState(false);
  const [dismissed,    setDismissed]    = useState(false);
  const [phaseDone,    setPhaseDone]    = useState(false);
  const [scenarioDone, setScenarioDone] = useState(false);
  const [previewDone,  setPreviewDone]  = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(`setup-guide-dismissed-${workId}`)) setDismissed(true);
      if (localStorage.getItem(`phase-created-${workId}`))         setPhaseDone(true);
      if (localStorage.getItem(`scenario-setup-${workId}`))        setScenarioDone(true);
      if (localStorage.getItem(`preview-confirmed-${workId}`))     setPreviewDone(true);
    } catch {}
  }, [workId]);

  function handleDismiss() {
    setDismissed(true);
    try { localStorage.setItem(`setup-guide-dismissed-${workId}`, "1"); } catch {}
  }

  if (!mounted || dismissed) return null;

  const completion: Record<string, boolean> = {
    work:      true,
    character: (work._count.characters ?? 0) > 0,
    phase:     phaseDone,
    message:   (work._count.messages   ?? 0) > 0,
    scenario:  scenarioDone,
    preview:   previewDone,
  };

  const allDone = STEPS.every((s) => completion[s.key]);
  if (allDone) return null;

  const doneCount = STEPS.filter((s) => completion[s.key]).length;
  const nextStep  = STEPS.find((s) => !completion[s.key]);
  const basePath  = `/oas/${oaId}/works/${workId}`;

  return (
    <div style={{
      background:   "linear-gradient(135deg, #f0f9ff 0%, #f0fdf4 100%)",
      border:       "1px solid #bae6fd",
      borderRadius: "var(--radius-md)",
      padding:      "14px 16px",
      marginBottom: 20,
      position:     "relative",
    }}>
      {/* dismiss */}
      <button
        onClick={handleDismiss}
        aria-label="ガイドを非表示"
        style={{
          position: "absolute", top: 10, right: 12,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 13, color: "#9ca3af", padding: "2px 4px", lineHeight: 1,
        }}
      >✕</button>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#1e40af" }}>セットアップの進捗</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
            {doneCount} / {STEPS.length} ステップ完了
          </div>
        </div>
      </div>

      {/* プログレスバー */}
      <div style={{
        height: 4, background: "#e0e7ef", borderRadius: 99,
        marginBottom: 12, overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width:  `${(doneCount / STEPS.length) * 100}%`,
          background: "linear-gradient(90deg, #3b82f6, #10b981)",
          borderRadius: 99,
          transition: "width 0.4s ease",
        }} />
      </div>

      {/* ステップ一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {STEPS.map((step, i) => {
          const done   = completion[step.key];
          const isNext = step.key === nextStep?.key;

          const href = step.isExternal
            ? `/playground?work_id=${workId}&oa_id=${oaId}`
            : step.href ? `${basePath}/${step.href}` : "";

          return (
            <div key={step.key} style={{
              display:      "flex",
              alignItems:   "center",
              gap:          8,
              padding:      isNext ? "7px 10px" : "3px 10px",
              borderRadius: "var(--radius-sm)",
              background:   isNext ? "rgba(59,130,246,0.07)" : "transparent",
              border:       isNext ? "1px solid rgba(59,130,246,0.18)" : "1px solid transparent",
            }}>
              {/* アイコン */}
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                background: done ? "#dcfce7" : isNext ? "#dbeafe" : "#f3f4f6",
                color:      done ? "#16a34a" : isNext ? "#1d4ed8" : "#9ca3af",
                border:     `1px solid ${done ? "#86efac" : isNext ? "#93c5fd" : "#e5e7eb"}`,
                flexShrink: 0,
              }}>
                {done ? "✓" : i + 1}
              </span>

              {/* ラベル */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize:       12,
                  fontWeight:     isNext ? 700 : 400,
                  color:          done ? "#9ca3af" : isNext ? "#1d4ed8" : "#6b7280",
                  textDecoration: done ? "line-through" : "none",
                }}>
                  {i + 1}. {step.label}
                </span>
                {isNext && (
                  <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>
                    — {step.desc}
                  </span>
                )}
              </div>

              {/* 次へボタン */}
              {isNext && href && (
                <Link href={href} style={{
                  fontSize:       11,
                  fontWeight:     600,
                  color:          "#2563eb",
                  textDecoration: "none",
                  whiteSpace:     "nowrap",
                  padding:        "3px 8px",
                  background:     "#dbeafe",
                  borderRadius:   "var(--radius-sm)",
                  flexShrink:     0,
                }}>
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
