"use client";

// src/app/oas/[id]/works/[workId]/locations/[locationId]/page.tsx
// ロケーション編集ページ（分析サマリー + 訪問履歴 + 削除）

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { locationApi, getDevToken } from "@/lib/api-client";
import { LocationForm } from "../_form";
import type { LocationWithTransition, LocationVisit } from "@/types";

// ── 分析サマリー型（location-stats API の by_location 要素） ──
interface LocAnalytics {
  total_visits: number;
  gps_success_rate?: number;
  out_of_range_count?: number;
  last_visited_at?: string;
}

export default function EditLocationPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const locationId = params.locationId as string;
  const suggestedRadius = searchParams.get("suggested_radius");

  const [location, setLocation] = useState<LocationWithTransition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visits, setVisits] = useState<LocationVisit[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [analytics, setAnalytics] = useState<LocAnalytics | null>(null);

  useEffect(() => {
    const token = getDevToken();
    (async () => {
      try {
        const data = await locationApi.get(token, locationId);
        setLocation(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
    // 訪問履歴を並行取得
    fetch(`/api/locations/${locationId}/visits?limit=20`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json?.success) setVisits(json.data); })
      .catch(() => {})
      .finally(() => setVisitsLoading(false));
    // 分析データを取得
    fetch(`/api/works/${workId}/location-stats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.success && json.data?.by_location) {
          const found = json.data.by_location.find(
            (s: { location_id: string }) => s.location_id === locationId,
          );
          if (found) {
            setAnalytics({
              total_visits: found.total_visits ?? 0,
              gps_success_rate: found.gps_success_rate,
              out_of_range_count: found.out_of_range_count,
              last_visited_at: found.last_visited_at,
            });
          }
        }
      })
      .catch(() => {});
  }, [locationId, workId]);

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await locationApi.update(getDevToken(), locationId, formData as Parameters<typeof locationApi.update>[2]);
      router.push(`/oas/${oaId}/works/${workId}/locations`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const hasVisits = visits.length > 0;
    const msg = hasVisits
      ? `このロケーションには${visits.length}件以上のチェックイン履歴があります。\n削除すると履歴も消えます。本当に削除しますか？`
      : "このロケーションを削除しますか？";
    if (!confirm(msg)) return;
    try {
      await locationApi.delete(getDevToken(), locationId);
      router.push(`/oas/${oaId}/works/${workId}/locations`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

  if (loading) {
    return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}><p style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>読み込み中...</p></div>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[
        { label: "OA一覧", href: "/oas" },
        { label: "作品", href: `/oas/${oaId}` },
        { label: "ロケーション", href: `/oas/${oaId}/works/${workId}/locations` },
        { label: location?.name ?? "編集" },
      ]} />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>ロケーション編集</h1>

      {error && <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", marginBottom: 16, fontSize: 14 }}>{error}</div>}

      {liffId && location && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, fontSize: 12, color: "#3b82f6", wordBreak: "break-all", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>
            <strong>LIFF URL:</strong> https://liff.line.me/{liffId}?location_id={location.id}&work_id={workId}
          </span>
          <button
            type="button"
            onClick={() => window.open(`https://liff.line.me/${liffId}?location_id=${location.id}&work_id=${workId}`, "_blank")}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              background: "#ecfdf5", color: "#059669",
              border: "1px solid #86efac", borderRadius: 6, cursor: "pointer", flexShrink: 0,
            }}
          >
            テスト
          </button>
        </div>
      )}

      {suggestedRadius && location && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
          <strong>提案:</strong> 半径を <strong>{location.radius_meters}m → {suggestedRadius}m</strong> に広げることで GPS 成功率が改善する可能性があります。
          <span style={{ fontSize: 12, color: "#b45309" }}> 地図で範囲を確認しながら調整してください。</span>
        </div>
      )}

      {/* ── 分析サマリー ── */}
      {analytics && (
        <div style={{
          marginBottom: 20, display: "flex", gap: 12, flexWrap: "wrap",
        }}>
          {[
            { label: "チェックイン数", value: analytics.total_visits.toLocaleString(), color: analytics.total_visits > 0 ? "#059669" : "#9ca3af" },
            ...(analytics.gps_success_rate !== undefined ? [{ label: "GPS成功率", value: `${analytics.gps_success_rate}%`, color: analytics.gps_success_rate >= 80 ? "#059669" : analytics.gps_success_rate >= 50 ? "#d97706" : "#dc2626" }] : []),
            ...(analytics.out_of_range_count !== undefined ? [{ label: "範囲外", value: String(analytics.out_of_range_count), color: analytics.out_of_range_count > 0 ? "#d97706" : "#9ca3af" }] : []),
            ...(analytics.last_visited_at ? [{ label: "最終チェックイン", value: new Date(analytics.last_visited_at).toLocaleDateString("ja-JP"), color: "#374151" }] : []),
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: "1 1 120px", padding: "12px 16px",
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {location && (
        <LocationForm
          onSubmit={handleSubmit}
          saving={saving}
          workId={workId}
          defaultValues={{
            name: location.name,
            description: location.description ?? "",
            beacon_uuid: location.beacon_uuid ?? "",
            beacon_major: location.beacon_major,
            beacon_minor: location.beacon_minor,
            latitude: location.latitude,
            longitude: location.longitude,
            radius_meters: location.radius_meters,
            checkin_mode: location.checkin_mode,
            cooldown_seconds: location.cooldown_seconds,
            transition_id: location.transition_id ?? "",
            set_flags: location.set_flags,
            is_active: location.is_active,
            stamp_enabled: location.stamp_enabled,
            stamp_label: location.stamp_label ?? "",
            stamp_order: location.stamp_order,
          }}
        />
      )}

      {/* ── 訪問履歴セクション ── */}
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #e5e7eb" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "#374151" }}>直近のチェックイン履歴</h2>
        {visitsLoading && <p style={{ fontSize: 13, color: "#9ca3af" }}>読み込み中...</p>}
        {!visitsLoading && visits.length === 0 && (
          <p style={{ fontSize: 13, color: "#9ca3af", padding: "16px 0" }}>まだチェックイン履歴がありません</p>
        )}
        {!visitsLoading && visits.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "8px 4px", fontWeight: 600, color: "#6b7280" }}>日時</th>
                  <th style={{ textAlign: "left", padding: "8px 4px", fontWeight: 600, color: "#6b7280" }}>方式</th>
                  <th style={{ textAlign: "left", padding: "8px 4px", fontWeight: 600, color: "#6b7280" }}>LINE User ID</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 4px", color: "#374151" }}>
                      {new Date(v.visited_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "8px 4px" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                        ...(v.checkin_method === "gps" ? { background: "#ecfdf5", color: "#059669" } :
                          v.checkin_method === "qr_and_gps" ? { background: "#eff6ff", color: "#2563eb" } :
                          { background: "#f5f3ff", color: "#7c3aed" }),
                      }}>
                        {v.checkin_method === "gps" ? "GPS" : v.checkin_method === "qr_and_gps" ? "QR+GPS" : "QR"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 4px", color: "#6b7280", fontFamily: "monospace", fontSize: 11 }}>
                      {v.line_user_id.slice(0, 12)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 削除 ── */}
      <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid #e5e7eb" }}>
        <button
          onClick={handleDelete}
          style={{ padding: "10px 20px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
        >
          このロケーションを削除
        </button>
      </div>
    </div>
  );
}
