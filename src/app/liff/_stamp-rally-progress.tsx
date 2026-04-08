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
    <div style={{ marginTop: 20, padding: "16px 20px", background: "#f9fafb", borderRadius: 12, width: "100%", maxWidth: 360 }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>スタンプラリー</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: progress.is_completed ? "#16a34a" : "#2563eb" }}>
          {progress.completed_count} / {progress.total_count}
        </span>
      </div>

      {/* 進捗バー */}
      <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: progress.is_completed ? "#16a34a" : "#2563eb",
          borderRadius: 4,
          transition: "width 0.5s ease",
          minWidth: pct > 0 ? 4 : 0,
        }} />
      </div>

      {/* コンプリートメッセージ */}
      {progress.is_completed && (
        <div style={{
          textAlign: "center", padding: "10px 0", marginBottom: 8,
          background: "#f0fdf4", borderRadius: 8,
          fontSize: 14, fontWeight: 600, color: "#16a34a",
        }}>
          全スポット達成！おめでとうございます！
        </div>
      )}

      {/* スポット一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {progress.locations.map((loc) => (
          <div
            key={loc.location_id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13,
              color: loc.checked_in ? "#374151" : "#9ca3af",
            }}
          >
            {/* 達成マーク */}
            <span style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
              background: loc.checked_in ? "#dcfce7" : "#f3f4f6",
              color: loc.checked_in ? "#16a34a" : "#d1d5db",
              border: `1.5px solid ${loc.checked_in ? "#86efac" : "#e5e7eb"}`,
            }}>
              {loc.checked_in ? "✓" : ""}
            </span>

            {/* ラベル */}
            <span style={{ flex: 1 }}>{loc.stamp_label}</span>

            {/* 日時 */}
            {loc.checked_in && loc.checked_in_at && (
              <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>
                {new Date(loc.checked_in_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
