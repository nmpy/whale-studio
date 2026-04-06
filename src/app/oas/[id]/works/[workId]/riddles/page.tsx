"use client";

// src/app/oas/[id]/works/[workId]/riddles/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, riddleApi, getDevToken } from "@/lib/api-client";
import type { Riddle } from "@/types";

function StatusBadge({ status }: { status: Riddle["status"] }) {
  const published = status === "published";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      background: published ? "#dcfce7" : "#f3f4f6",
      color:      published ? "#16a34a" : "#6b7280",
    }}>
      {published ? "公開" : "非公開"}
    </span>
  );
}

function QuestionTypeBadge({ type }: { type: Riddle["question_type"] }) {
  const map: Record<Riddle["question_type"], string> = {
    text:     "📝 テキスト問題",
    image:    "🖼 画像問題",
    video:    "🎬 動画問題",
    carousel: "🎠 カルーセル問題",
  };
  return (
    <span style={{
      fontSize: 11,
      color: "#6b7280",
      background: "#f3f4f6",
      borderRadius: 6,
      padding: "2px 7px",
      fontWeight: 500,
    }}>
      {map[type] ?? type}
    </span>
  );
}

function RiddleCard({ r, oaId }: { r: Riddle; oaId: string }) {
  const hasImage = r.question_type === "image" && r.question_image_url;

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      {/* 上段: タイトル / 状態 / 編集 */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid #f3f4f6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontWeight: 600,
            fontSize: 14,
            color: "#111827",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {r.title}
          </span>
          <StatusBadge status={r.status} />
        </div>
        <Link
          href={`/oas/${oaId}/riddles/${r.id}`}
          className="btn btn-ghost"
          style={{ padding: "3px 12px", fontSize: 12, flexShrink: 0, marginLeft: 12 }}
        >
          編集
        </Link>
      </div>

      {/* 下段: 問題情報 */}
      <div style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* サムネイル（画像問題のみ） */}
        {hasImage && (
          <img
            src={r.question_image_url!}
            alt="問題画像"
            style={{
              width: 72,
              height: 72,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              flexShrink: 0,
            }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 問題形式 */}
          <div style={{ marginBottom: 6 }}>
            <QuestionTypeBadge type={r.question_type} />
          </div>

          {/* 問題内容 */}
          {r.question_text && (
            <p style={{
              fontSize: 13,
              color: "#374151",
              margin: "0 0 6px",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.5,
            }}>
              {r.question_text}
            </p>
          )}

          {/* 正解テキスト */}
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            正解：<span style={{ fontWeight: 600, color: "#374151" }}>{r.answer_text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkRiddlesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;

  const [workTitle, setWorkTitle] = useState("");
  const [riddles, setRiddles]     = useState<Riddle[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      workApi.get(token, workId),
      riddleApi.list(token, oaId),
    ])
      .then(([w, list]) => {
        setWorkTitle(w.title);
        setRiddles(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [oaId, workId]);

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "謎" },
          ]} />
          <h2>謎一覧</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            この OA に登録された謎問題の一覧です。
          </p>
        </div>
        <Link href={`/oas/${oaId}/riddles/new`} className="btn btn-primary">
          ＋ 謎を作成
        </Link>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <div className="skeleton" style={{ width: 180, height: 14, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: "60%", height: 12 }} />
            </div>
          ))}
        </div>
      ) : riddles.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: "32px 0" }}>
            <p className="empty-state-title">謎がまだありません</p>
            <p className="empty-state-desc">「＋ 謎を作成」から問題を追加してください。</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
            {riddles.length} 件
          </div>
          {riddles.map((r) => (
            <RiddleCard key={r.id} r={r} oaId={oaId} />
          ))}
        </div>
      )}
    </>
  );
}
