"use client";

// src/app/liff/_stamp-rally-progress.tsx
// スタンプラリー進捗表示コンポーネント（LIFF ページ内で使用）
//
// 表示ルール:
//   - stamp_enabled=true の location が 0 件 → 非表示
//   - stampLabel 未設定 → location.name で代用（API 側で処理済み）
//   - 並び順: stampOrder asc → sortOrder asc → createdAt asc

import { useEffect, useState } from "react";
import type { StampRallyProgress } from "@/types";

interface StampRallyProps {
  workId: string;
  lineUserId: string;
  /** チェックイン成功時にインクリメントしてリフレッシュ */
  refreshKey: number;
}

export function StampRallyProgressView({ workId, lineUserId, refreshKey }: StampRallyProps) {
  const [progress, setProgress] = useState<StampRallyProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/liff/stamp-rally?work_id=${workId}&line_user_id=${lineUserId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) setProgress(json.data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workId, lineUserId, refreshKey]);

  // スタンプ対象 0 件 or ロード中 → 非表示
  if (loading || !progress || progress.total_count === 0) return null;

  const pct = Math.round((progress.completed_count / progress.total_count) * 100);

  return (
    <div style={{
      padding: "16px 20px", width: "100%",
      background: "var(--liff-surface,#ffffff)", borderRadius: 20,
      border: "1px solid #eaf0f4", boxShadow: "0 6px 20px rgba(31,64,92,0.06)",
    }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--liff-primary-text,#1F2329)" }}>スタンプラリー</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: progress.is_completed ? "#0f9d58" : "var(--liff-secondary-text,#5B6168)" }}>
          {progress.completed_count} / {progress.total_count}
        </span>
      </div>

      {/* 進捗バー */}
      <div style={{ height: 8, background: "#eef2f5", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--liff-line-green,#06C755)",
          borderRadius: 999,
          transition: "width 0.5s ease",
          minWidth: pct > 0 ? 4 : 0,
        }} />
      </div>

      {/* コンプリートメッセージ */}
      {progress.is_completed && (
        <div style={{
          textAlign: "center", padding: "10px 0", marginBottom: 10,
          background: "#e7f7ee", borderRadius: 12,
          fontSize: 14, fontWeight: 700, color: "#0f9d58",
        }}>
          全スポット達成！おめでとうございます！
        </div>
      )}

      {/* スポット一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {progress.locations.map((loc) => (
          <div
            key={loc.location_id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 13,
              color: loc.checked_in ? "var(--liff-primary-text,#1F2329)" : "var(--liff-tertiary-text,#8C8C8C)",
            }}
          >
            {/* 達成マーク */}
            <span style={{
              width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
              background: loc.checked_in ? "#e7f7ee" : "#f1f4f7",
              color: loc.checked_in ? "#0f9d58" : "#cbd5e1",
              boxShadow: loc.checked_in ? "0 0 0 1px #bfe9d2" : "0 0 0 1px #e6ebf0",
            }}>
              {loc.checked_in ? "✓" : ""}
            </span>

            {/* ラベル */}
            <span style={{ flex: 1 }}>{loc.stamp_label}</span>

            {/* 日時 */}
            {loc.checked_in && loc.checked_in_at && (
              <span style={{ fontSize: 10, color: "var(--liff-tertiary-text,#8C8C8C)", flexShrink: 0 }}>
                {new Date(loc.checked_in_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
