"use client";

// src/app/oas/[id]/riddles/page.tsx
// GET /api/oas/:id/riddles → 謎リスト

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { riddleApi, oaApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Riddle, RiddleMatchCondition } from "@/types";
import { QUESTION_TYPE_OPTIONS, MATCH_CONDITION_OPTIONS } from "./_form";

// ── ヘルパー ─────────────────────────────────────────────

function matchConditionLabel(c: RiddleMatchCondition) {
  return MATCH_CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

/** 問題形式に応じて「本文」列に表示する内容を返す */
function QuestionContent({ riddle }: { riddle: Riddle }) {
  const meta = QUESTION_TYPE_OPTIONS.find((o) => o.value === riddle.question_type)
    ?? QUESTION_TYPE_OPTIONS[0];

  // テキスト: 本文をそのまま表示（省略あり）
  if (riddle.question_type === "text") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          fontSize: 10, color: "#9ca3af", marginBottom: 2,
        }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{
          fontSize: 13, color: "#374151",
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
          wordBreak: "break-all",
        }}>
          {riddle.question_text ?? "—"}
        </span>
      </div>
    );
  }

  // 画像: サムネイル + ラベル
  if (riddle.question_type === "image") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {riddle.question_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={riddle.question_image_url}
            alt="問題画像"
            style={{
              width: 48, height: 36, objectFit: "cover",
              borderRadius: 4, border: "1px solid #e5e5e5", flexShrink: 0,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        <span style={{
          fontSize: 11, color: "#6b7280",
          display: "inline-flex", alignItems: "center", gap: 3,
        }}>
          {meta.icon} {meta.label}
        </span>
      </div>
    );
  }

  // 動画: URL を省略表示
  if (riddle.question_type === "video") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 10, color: "#9ca3af", display: "flex", alignItems: "center", gap: 3 }}>
          {meta.icon} {meta.label}
        </span>
        {riddle.question_video_url && (
          <span style={{
            fontSize: 11, color: "#6b7280",
            maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {riddle.question_video_url}
          </span>
        )}
      </div>
    );
  }

  // カルーセル: カード枚数を表示
  if (riddle.question_type === "carousel") {
    const count = riddle.question_carousel?.length ?? 0;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 12, color: "#6b7280",
      }}>
        {meta.icon} {meta.label}（{count} 枚）
      </span>
    );
  }

  return <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>;
}

/** 長いテキストを省略表示する共通セル */
function TruncatedCell({ text, maxWidth = 180 }: { text: string; maxWidth?: number }) {
  return (
    <span
      title={text}
      style={{
        display: "block",
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 13,
        color: "#374151",
      }}
    >
      {text || "—"}
    </span>
  );
}

// ── コンポーネント ────────────────────────────────────────

export default function RiddlesPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;

  const [oaTitle, setOaTitle]     = useState("");
  const [riddles, setRiddles]     = useState<Riddle[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      oaApi.get(getDevToken(), oaId),
      riddleApi.list(getDevToken(), oaId),
    ])
      .then(([oa, list]) => {
        setOaTitle(oa.title);
        setRiddles(list);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId]);

  // ── ローディング ──────────────────────────────────────
  if (loading) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "謎管理" },
          ]} />
          <h2>謎管理</h2>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
              <div className="skeleton" style={{ width: 100, height: 14 }} />
              <div className="skeleton" style={{ flex: 1,   height: 14 }} />
              <div className="skeleton" style={{ width: 80,  height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "謎管理" },
          ]} />
          <h2>謎管理</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const HEADERS = ["ID", "タイトル", "本文", "正解テキスト", "マッチ条件", "正解時メッセージ", "不正解時メッセージ", "状態", ""];

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "謎管理" },
          ]} />
          <h2>謎管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            LINE Bot が使用する謎（問題）を管理します
          </p>
        </div>
        <Link href={`/oas/${oaId}/riddles/new`} className="btn btn-primary">
          ＋ 謎を作成
        </Link>
      </div>

      {/* ── 一覧 ── */}
      {riddles.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <p className="empty-state-title">謎がまだありません</p>
            <p className="empty-state-desc">
              「＋ 謎を作成」から Bot 用の問題を追加してください。
            </p>
            <Link
              href={`/oas/${oaId}/riddles/new`}
              className="btn btn-primary"
              style={{ marginTop: 8, display: "inline-block" }}
            >
              ＋ 最初の謎を作成
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e5e5", background: "#f9fafb" }}>
                {HEADERS.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 14px", textAlign: "left",
                      fontWeight: 600, color: "#374151", fontSize: 12, whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {riddles.map((riddle) => {
                const isPublished = riddle.status === "published";
                return (
                  <tr
                    key={riddle.id}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* ID */}
                    <td style={{ padding: "12px 14px", color: "#9ca3af", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                      {riddle.id.slice(0, 8)}…
                    </td>

                    {/* タイトル */}
                    <td style={{ padding: "12px 14px", fontWeight: 500, color: "#111827", whiteSpace: "nowrap", maxWidth: 160 }}>
                      <TruncatedCell text={riddle.title} maxWidth={160} />
                    </td>

                    {/* 本文（問題形式に応じた内容） */}
                    <td style={{ padding: "12px 14px", minWidth: 160, maxWidth: 220 }}>
                      <QuestionContent riddle={riddle} />
                    </td>

                    {/* 正解テキスト */}
                    <td style={{ padding: "12px 14px", maxWidth: 140 }}>
                      <TruncatedCell text={riddle.answer_text} maxWidth={140} />
                    </td>

                    {/* マッチ条件 */}
                    <td style={{ padding: "12px 14px", color: "#6b7280", whiteSpace: "nowrap", fontSize: 12 }}>
                      {matchConditionLabel(riddle.match_condition)}
                    </td>

                    {/* 正解時メッセージ */}
                    <td style={{ padding: "12px 14px", maxWidth: 180 }}>
                      <TruncatedCell text={riddle.correct_message} maxWidth={180} />
                    </td>

                    {/* 不正解時メッセージ */}
                    <td style={{ padding: "12px 14px", maxWidth: 180 }}>
                      <TruncatedCell text={riddle.wrong_message} maxWidth={180} />
                    </td>

                    {/* 状態 */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 12,
                        fontSize: 11, fontWeight: 600,
                        background: isPublished ? "#dcfce7" : "#f3f4f6",
                        color:      isPublished ? "#16a34a" : "#6b7280",
                      }}>
                        {isPublished ? "公開" : "非公開"}
                      </span>
                    </td>

                    {/* 編集ボタン */}
                    <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link
                        href={`/oas/${oaId}/riddles/${riddle.id}`}
                        className="btn btn-ghost"
                        style={{ padding: "4px 12px", fontSize: 12 }}
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "8px 14px", fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
            {riddles.length} 件
          </div>
        </div>
      )}
    </>
  );
}
