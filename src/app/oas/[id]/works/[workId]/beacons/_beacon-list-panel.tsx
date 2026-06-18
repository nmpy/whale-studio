"use client";

// src/app/oas/[id]/works/[workId]/beacons/_beacon-list-panel.tsx
//
// ビーコントリガー一覧の本体UI（共通コンポーネント）。
// /locations?tab=beacons と /beacons/page.tsx の両方から再利用される。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { getAuthHeaders } from "@/lib/api-client";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

type BeaconTriggerItem = {
  id: string;
  name: string;
  hwid: string;
  enabled: boolean;
  event_types: string;
  cooldown_seconds: number;
  action_type: string;
  last_event_at: string | null;
  last_action_status: string | null;
  /** 地点到着トリガー用の紐づけ地点。null = 未設定（地点到着トリガーには使われない）。 */
  location_id?: string | null;
};

function fmtCooldown(sec: number): string {
  if (sec <= 0) return "なし";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0 && s > 0) return `${m}分${s}秒`;
  if (m > 0) return `${m}分`;
  return `${s}秒`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface Props {
  oaId: string;
  workId: string;
  /** タイトル h2 を表示するかどうか。タブUIから使うときは true 推奨 */
  showHeading?: boolean;
}

export default function BeaconListPanel({ oaId, workId, showHeading = true }: Props) {
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const [items, setItems] = useState<BeaconTriggerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/works/${workId}/beacons`, {
      headers: getAuthHeaders(),
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setItems(json.data);
        else setError(json.error?.message ?? "読み込みに失敗しました");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  return (
    <div data-panel="beacons">
      {/* ── 移行バナー: ビーコン管理は OA 配下（ロケーション）に集約された ── */}
      <div
        role="status"
        style={{
          display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
          background: "#e9f8ef", border: "1px solid rgba(34,197,94,.3)", borderRadius: 12,
          padding: "14px 16px", marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#0f7a3d", marginBottom: 4 }}>
            ビーコン管理はロケーション配下に移動しました
          </p>
          <p style={{ fontSize: 12, color: "#33403a", lineHeight: 1.6 }}>
            この作品に紐づくビーコントリガーも、新しいビーコン管理画面でまとめて確認・編集できます。
          </p>
        </div>
        <Link
          href={`/oas/${oaId}/locations/beacons?workId=${workId}`}
          style={{
            flexShrink: 0, padding: "9px 18px", background: "#22c55e", color: "#fff",
            borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
          }}
        >
          ビーコン管理を開く →
        </Link>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        {showHeading && <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>LINE Beacon トリガー</h2>}
        {!isReadOnly && (
          <Link
            href={`/oas/${oaId}/works/${workId}/beacons/new`}
            style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none", marginLeft: "auto" }}
          >
            + ビーコンを追加
          </Link>
        )}
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 12, color: "#334155", lineHeight: 1.7 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>使い方</p>
        <ul style={{ marginLeft: 18, listStyle: "disc" }}>
          <li>LINE 公式アカウント側でビーコン端末を登録し、発行/確認した HWID を入力してください。</li>
          <li>ユーザー側で Bluetooth と LINE Beacon 設定が ON、かつ LINE 公式アカウントを友だち追加済みの場合に検知されます。</li>
          <li>重要な進行には QR / GPS などの代替導線を併用してください（演出トリガーとしての使用を推奨）。</li>
        </ul>
      </div>

      {(loading || roleLoading) && <InlineWhaleLoader padding={40} />}
      {error && (
        <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, background: "#f9fafb", borderRadius: 12, border: "1px dashed #d1d5db", color: "#6b7280" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>ビーコントリガーはまだ未登録です</p>
          <p style={{ fontSize: 12 }}>HWID を登録すると、ユーザーが受信圏に入った際の演出を発火できます。</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((b) => (
            <Link
              key={b.id}
              href={isReadOnly ? "#" : `/oas/${oaId}/works/${workId}/beacons/${b.id}/edit`}
              style={{
                display: "block",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "14px 18px",
                textDecoration: "none",
                color: "inherit",
                pointerEvents: isReadOnly ? "none" : "auto",
                opacity: isReadOnly ? 0.85 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{b.name}</span>
                    {!b.enabled && (
                      <span style={{ fontSize: 10, background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>無効</span>
                    )}
                    <span style={{ fontSize: 10, background: "#eef2ff", color: "#4338ca", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                      {b.action_type}
                    </span>
                    {!b.location_id && (
                      <span
                        title="地点に紐づいていないBeaconは、地点到着トリガー（送信後に地点到着を待つ）には使用されません。"
                        style={{ fontSize: 10, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}
                      >
                        地点未設定
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    HWID: <code style={{ fontFamily: "ui-monospace, monospace" }}>{b.hwid}</code>
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#9ca3af", flexWrap: "wrap" }}>
                    <span>発火: {b.event_types}</span>
                    <span>再発火防止: {fmtCooldown(b.cooldown_seconds)}</span>
                    <span>最終検知: {fmtDate(b.last_event_at)}</span>
                    {b.last_action_status && <span>結果: {b.last_action_status}</span>}
                  </div>
                </div>
                <span style={{ color: "#9ca3af", fontSize: 20 }}>›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
