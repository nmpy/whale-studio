"use client";

// src/components/FeedbackModal.tsx
// フィードバック送信モーダル。
// ・現在の画面URL・ページ名・OA/作品IDを自動付与
// ・送信先: POST /api/feedback → service 層 → GAS (sheet: feedback)

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";

// ── ページ名マッピング ─────────────────────────────────────────────────────
function getPageName(pathname: string): string {
  const patterns: [RegExp, string][] = [
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages\/new$/,            "メッセージ作成"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages\/[^/]+$/,          "メッセージ編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/messages$/,                 "メッセージ・謎一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/phases\/[^/]+$/,            "フェーズ編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/phases$/,                   "フェーズ管理"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters\/[^/]+\/edit$/,  "キャラクター編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters\/new$/,          "キャラクター作成"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/characters$/,               "キャラクター一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/scenario$/,                 "シナリオ管理"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/audience$/,                 "オーディエンス"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/dashboard\/flow-analysis$/, "フロー分析"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/dashboard$/,                "ダッシュボード"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/riddles$/,                  "謎一覧"],
    [/^\/oas\/[^/]+\/works\/[^/]+\/edit$/,                     "作品編集"],
    [/^\/oas\/[^/]+\/works\/[^/]+$/,                           "作品トップ"],
    [/^\/oas\/[^/]+\/works\/new$/,                             "作品作成"],
    [/^\/oas\/[^/]+\/works$/,                                  "作品リスト"],
    [/^\/oas\/[^/]+\/characters\/[^/]+\/edit$/,                "キャラクター編集"],
    [/^\/oas\/[^/]+\/characters\/new$/,                        "キャラクター作成"],
    [/^\/oas\/[^/]+\/characters$/,                             "キャラクター管理"],
    [/^\/oas\/[^/]+\/riddles\/[^/]+$/,                         "謎編集"],
    [/^\/oas\/[^/]+\/riddles\/new$/,                           "謎作成"],
    [/^\/oas\/[^/]+\/riddles$/,                                "謎一覧"],
    [/^\/oas\/[^/]+\/richmenu-editor\/[^/]+$/,                 "リッチメニュー編集"],
    [/^\/oas\/[^/]+\/richmenu-editor$/,                        "リッチメニュー管理"],
    [/^\/oas\/[^/]+\/richmenu-sync$/,                          "リッチメニュー同期"],
    [/^\/oas\/[^/]+\/friend-add$/,                             "友だち追加設定"],
    [/^\/oas\/[^/]+\/sns$/,                                    "SNS投稿管理"],
    [/^\/oas\/[^/]+\/trackings$/,                              "トラッキング管理"],
    [/^\/oas\/[^/]+\/settings\/members$/,                      "メンバー管理"],
    [/^\/oas\/[^/]+\/settings$/,                               "設定"],
    [/^\/oas\/[^/]+\/account$/,                                "アカウント情報"],
    [/^\/oas\/[^/]+\/audience\/segments\/new$/,                "セグメント作成"],
    [/^\/oas\/[^/]+\/audience\/segments\/[^/]+$/,              "セグメント編集"],
    [/^\/oas\/[^/]+\/audience\/tracking\/new$/,                "トラッキング作成"],
    [/^\/oas\/[^/]+\/audience\/tracking\/[^/]+$/,              "トラッキング編集"],
    [/^\/oas\/[^/]+\/audience$/,                               "オーディエンス"],
    [/^\/oas\/[^/]+\/edit$/,                                   "OA編集"],
    [/^\/oas\/new$/,                                           "アカウント作成"],
    [/^\/oas$/,                                                "アカウント一覧"],
    [/^\/$/,                                                   "ホーム"],
  ];
  for (const [pattern, name] of patterns) {
    if (pattern.test(pathname)) return name;
  }
  return pathname;
}

// ── カテゴリ定義 ────────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: "bug",     label: "🐛 バグ報告" },
  { value: "ux",      label: "😓 使いにくさ" },
  { value: "feature", label: "✨ 欲しい機能" },
  { value: "other",   label: "💬 その他" },
] as const;

type CategoryValue = typeof CATEGORIES[number]["value"];

// ── Props ───────────────────────────────────────────────────────────────────
interface Props {
  pathname: string;
  onClose:  () => void;
}

// ── コンポーネント ──────────────────────────────────────────────────────────
export default function FeedbackModal({ pathname, onClose }: Props) {
  const { showToast } = useToast();
  const [content, setContent]       = useState("");
  const [category, setCategory]     = useState<CategoryValue>("other");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 開いたらテキストエリアにフォーカス
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // ESC で閉じる
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  function handleClose() {
    if (content.trim()) {
      if (!confirm("入力内容が送信されていません。閉じてよいですか？")) return;
    }
    onClose();
  }

  async function handleSubmit() {
    if (!content.trim()) {
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const pageUrl  = typeof window !== "undefined" ? window.location.href : pathname;
      const oaMatch  = pathname.match(/\/oas\/([^/]+)/);
      const workMatch = pathname.match(/\/works\/([^/]+)/);

      const body = {
        content:    content.trim(),
        category,
        page_name:  getPageName(pathname),
        page_url:   pageUrl,
        // 将来: Supabase Auth から取得。現時点は空文字
        user_name:  "",
        user_email: "",
        oa_id:      oaMatch?.[1]  ?? null,
        oa_name:    null,          // 将来: OA名取得後に付与
        work_id:    workMatch?.[1] ?? null,
        work_name:  null,          // 将来: 作品名取得後に付与
      };

      const res = await fetch("/api/feedback", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      const json = await res.json() as { ok: boolean; error?: string };

      if (!json.ok) throw new Error(json.error ?? "送信失敗");

      showToast("フィードバックを送信しました。ありがとうございます！", "success");
      onClose();
    } catch (err) {
      console.error("[FeedbackModal] submit error:", err);
      showToast("送信に失敗しました。もう一度お試しください。", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const pageName  = getPageName(pathname);
  const canSubmit = content.trim().length > 0 && !submitting;

  return (
    /* ── バックドロップ ── */
    <div
      onClick={handleClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(2px)",
      }}
    >
      {/* ── モーダル本体 ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth: 480,
          overflow: "hidden",
        }}
      >
        {/* ── ヘッダー ── */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "16px 20px 14px",
          borderBottom: "1px solid #e5e7eb",
        }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: 0 }}>
              💬 フィードバックを送る
            </h2>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "2px 0 0" }}>
              現在のページ: {pageName}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{
              marginLeft: "auto", background: "none", border: "none",
              cursor: "pointer", color: "#9ca3af", fontSize: 20,
              lineHeight: 1, padding: "2px 6px", borderRadius: 6,
            }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* ── フォーム ── */}
        <div style={{ padding: "18px 20px 20px" }}>

          {/* カテゴリ選択 */}
          <div style={{ marginBottom: 16 }}>
            <p style={{
              fontSize: 12, fontWeight: 600, color: "#374151",
              marginBottom: 8,
            }}>
              カテゴリ（任意）
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CATEGORIES.map(({ value, label }) => {
                const selected = category === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: selected ? 700 : 400,
                      cursor: "pointer",
                      border: `1.5px solid ${selected ? "#06C755" : "#e5e7eb"}`,
                      background: selected ? "#E6F7ED" : "#f9fafb",
                      color: selected ? "#166534" : "#6b7280",
                      transition: "all 0.15s",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 内容テキストエリア */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="feedback-content"
              style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "#374151", marginBottom: 6,
              }}
            >
              この画面で気づいたこと / 改善してほしいこと
              <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
            </label>
            <textarea
              id="feedback-content"
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="例：〇〇ボタンが見つけにくかった、〇〇の機能が欲しい、など"
              maxLength={2000}
              rows={5}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.6,
                border: "1.5px solid #e5e7eb",
                borderRadius: 8,
                resize: "vertical",
                outline: "none",
                fontFamily: "inherit",
                color: "#111827",
                background: "#fafafa",
                transition: "border-color 0.15s, background 0.15s",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#06C755";
                e.target.style.background  = "#fff";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#e5e7eb";
                e.target.style.background  = "#fafafa";
              }}
            />
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>
              {content.length} / 2000
            </p>
          </div>

          {/* 自動付与情報の説明 */}
          <p style={{
            fontSize: 11, color: "#9ca3af", lineHeight: 1.6,
            marginBottom: 16,
            padding: "8px 12px",
            background: "#f9fafb",
            borderRadius: 6,
          }}>
            送信時に現在のURL・ページ名・OA情報・ブラウザ情報が自動的に添付されます。
          </p>

          {/* ボタン行 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: "8px 18px", fontSize: 13, fontWeight: 500,
                background: "#f3f4f6", color: "#374151",
                border: "none", borderRadius: 8, cursor: "pointer",
              }}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: "8px 20px", fontSize: 13, fontWeight: 600,
                background: canSubmit ? "#06C755" : "#d1d5db",
                color: "#fff",
                border: "none", borderRadius: 8,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", gap: 6,
                transition: "background 0.15s",
              }}
            >
              {submitting && (
                <span style={{
                  width: 13, height: 13,
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }} />
              )}
              {submitting ? "送信中..." : "送信する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
