"use client";

// src/app/oas/[id]/works/[workId]/audience/location-checkins/page.tsx
// ロケーションチェックイン分析ページ
// QR/GPS 内訳 + GPS 距離統計 + GPS 成功率 + 失敗理由内訳

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getDevToken } from "@/lib/api-client";
import { evaluateGpsHealth } from "@/lib/location-health";
import type { LocationVisitStats, LocationVisit, GpsAttemptStats } from "@/types";

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function LocationCheckinsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [stats, setStats] = useState<LocationVisitStats | null>(null);
  const [recentVisits, setRecentVisits] = useState<(LocationVisit & { location_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    const headers = authHeaders(token);
    Promise.all([
      fetch(`/api/works/${workId}/location-stats`, { headers }).then((r) => r.json()),
      fetch(`/api/locations?work_id=${workId}`, { headers }).then((r) => r.json()),
    ])
      .then(async ([statsJson, locsJson]) => {
        if (statsJson.success) setStats(statsJson.data);
        else setError(statsJson.error?.message ?? "統計の取得に失敗しました");
        if (locsJson.success && Array.isArray(locsJson.data)) {
          const locs = locsJson.data as Array<{ id: string; name: string }>;
          const locMap = new Map(locs.map((l) => [l.id, l.name]));
          const visitPromises = locs.slice(0, 10).map((loc) =>
            fetch(`/api/locations/${loc.id}/visits?limit=5`, { headers })
              .then((r) => r.json())
              .then((json) => json.success ? (json.data as LocationVisit[]).map((v) => ({ ...v, location_name: locMap.get(v.location_id) })) : [])
              .catch(() => [] as (LocationVisit & { location_name?: string })[])
          );
          const allVisits = (await Promise.all(visitPromises)).flat();
          allVisits.sort((a, b) => new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime());
          setRecentVisits(allVisits.slice(0, 20));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[
        { label: "OA一覧", href: "/oas" },
        { label: "作品", href: `/oas/${oaId}` },
        { label: "オーディエンス", href: `/oas/${oaId}/works/${workId}/audience` },
        { label: "ロケーション分析" },
      ]} />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>ロケーションチェックイン分析</h1>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>読み込み中...</div>}
      {error && <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {!loading && stats && (
        <>
          {/* ── 全体 KPI ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
            <KpiCard label="総チェックイン" value={stats.total_checkins} />
            <KpiCard label="ユニークユーザー" value={stats.unique_users} />
            <KpiCard label="QR のみ" value={stats.method_breakdown.qr_count} color="#2563eb" />
            <KpiCard label="GPS のみ" value={stats.method_breakdown.gps_count} color="#16a34a" />
            <KpiCard label="QR+GPS" value={stats.method_breakdown.qr_and_gps_count} color="#7c3aed" />
            <KpiCard label="ロケーション数" value={stats.location_count} />
            <KpiCard label="直近7日" value={stats.recent_7d_checkins} />
          </div>

          <MethodBreakdownBar qr={stats.method_breakdown.qr_count} gps={stats.method_breakdown.gps_count} qrAndGps={stats.method_breakdown.qr_and_gps_count} />
          <GpsDistanceSection stats={stats.gps_distance} />
          <GpsSuccessRateSection attempts={stats.gps_attempts} />

          {/* ── ロケーション別 ── */}
          <Section title="ロケーション別">
            {stats.by_location.length === 0 ? (
              <EmptyState text="まだチェックイン履歴がありません" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 780 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                      <th style={thL}>ロケーション</th>
                      <th style={thR}>訪問</th>
                      <th style={thR}>QR</th>
                      <th style={thR}>GPS</th>
                      <th style={thR}>QR+GPS</th>
                      <th style={thR}>GPS成功率</th>
                      <th style={{ ...thL, textAlign: "center" }}>状態</th>
                      <th style={{ ...thL, textAlign: "center" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.by_location.map((loc) => {
                      const health = evaluateGpsHealth({
                        gps_attempts: loc.gps_attempts,
                        gps_successes: loc.gps_successes,
                        gps_success_rate: loc.gps_success_rate,
                        out_of_range_count: loc.out_of_range_count,
                      });
                      const hasGpsIssue = health.status === "adjust" || health.status === "review";

                      return (
                        <tr key={loc.location_id} style={{ borderBottom: "1px solid #f3f4f6", background: health.status === "adjust" ? "#fef2f220" : undefined }}>
                          <td style={tdL}>
                            <Link href={`/oas/${oaId}/works/${workId}/locations/${loc.location_id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
                              {loc.location_name}
                            </Link>
                            {health.hint && hasGpsIssue && (
                              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, lineHeight: 1.4 }}>{health.hint}</p>
                            )}
                            {loc.radius_suggestion && (
                              <p style={{ fontSize: 11, color: "#d97706", marginTop: 2, fontWeight: 500 }}>
                                提案: 半径 {loc.radius_suggestion.current_radius}m → {loc.radius_suggestion.suggested_radius}m
                                <span style={{ fontWeight: 400, color: "#9ca3af" }}> ({loc.radius_suggestion.confidence})</span>
                              </p>
                            )}
                          </td>
                          <td style={tdR}><strong>{loc.total_visits}</strong></td>
                          <td style={tdR}>{loc.qr_count}</td>
                          <td style={tdR}>
                            {loc.gps_count + loc.qr_and_gps_count > 0 ? loc.gps_count : "—"}
                          </td>
                          <td style={tdR}>{loc.qr_and_gps_count || "—"}</td>
                          <td style={tdR}>{loc.gps_success_rate != null ? `${loc.gps_success_rate}%` : "—"}</td>
                          <td style={{ ...tdL, textAlign: "center" }}>
                            {health.status && (
                              <span style={{
                                display: "inline-block", padding: "2px 8px", borderRadius: 10,
                                fontSize: 11, fontWeight: 600,
                                background: health.bgColor, color: health.color,
                              }}>
                                {health.label}
                              </span>
                            )}
                          </td>
                          <td style={{ ...tdL, textAlign: "center" }}>
                            {hasGpsIssue && (
                              <Link
                                href={`/oas/${oaId}/works/${workId}/locations/${loc.location_id}${loc.radius_suggestion ? `?suggested_radius=${loc.radius_suggestion.suggested_radius}` : ""}`}
                                style={{
                                  display: "inline-block", padding: "3px 10px", borderRadius: 6,
                                  fontSize: 11, fontWeight: 600, textDecoration: "none",
                                  background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe",
                                }}
                              >
                                設定を見直す
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 直近の訪問 ── */}
          <Section title="直近のチェックイン（最大20件）">
            {recentVisits.length === 0 ? (
              <EmptyState text="まだチェックイン履歴がありません" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                      <th style={thL}>日時</th>
                      <th style={thL}>ロケーション</th>
                      <th style={thL}>方式</th>
                      <th style={thL}>LINE User ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentVisits.map((v) => (
                      <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={tdL}>{new Date(v.visited_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td style={tdL}>{v.location_name ?? "—"}</td>
                        <td style={tdL}><MethodBadge method={v.checkin_method} /></td>
                        <td style={{ ...tdL, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{v.line_user_id.slice(0, 12)}...</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

// ── サブコンポーネント ──

function KpiCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: color ?? "#111827" }}>{value.toLocaleString()}</p>
    </div>
  );
}

function MethodBreakdownBar({ qr, gps, qrAndGps }: { qr: number; gps: number; qrAndGps: number }) {
  const total = qr + gps + qrAndGps;
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  const segments = [
    { count: qr, color: "#2563eb", label: "QR" },
    { count: gps, color: "#16a34a", label: "GPS" },
    { count: qrAndGps, color: "#7c3aed", label: "QR+GPS" },
  ].filter((s) => s.count > 0);

  return (
    <Section title="チェックイン方法の内訳">
      <div style={{ height: 12, background: "#e5e7eb", borderRadius: 6, overflow: "hidden", display: "flex", marginBottom: 8 }}>
        {segments.map((s, i) => (
          <div key={s.label} style={{
            width: `${pct(s.count)}%`, background: s.color, minWidth: 4,
            borderRadius: segments.length === 1 ? 6 : i === 0 ? "6px 0 0 6px" : i === segments.length - 1 ? "0 6px 6px 0" : 0,
          }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            {s.label}: {s.count.toLocaleString()}件 ({pct(s.count)}%)
          </span>
        ))}
      </div>
    </Section>
  );
}

function GpsDistanceSection({ stats }: { stats: LocationVisitStats["gps_distance"] }) {
  if (!stats || stats.sample_count === 0) {
    return <Section title="GPS 距離統計"><p style={{ fontSize: 13, color: "#9ca3af" }}>GPS チェックインデータがまだありません</p></Section>;
  }
  return (
    <Section title="GPS 距離統計">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <MiniStat label="サンプル数" value={`${stats.sample_count}件`} />
        <MiniStat label="平均距離" value={`${stats.avg_distance_meters}m`} />
        <MiniStat label="最小距離" value={`${stats.min_distance_meters}m`} />
        <MiniStat label="最大距離" value={`${stats.max_distance_meters}m`} />
      </div>
    </Section>
  );
}

function GpsSuccessRateSection({ attempts }: { attempts: GpsAttemptStats }) {
  if (attempts.total_attempts === 0) {
    return <Section title="GPS 成功率"><p style={{ fontSize: 13, color: "#9ca3af" }}>GPS チェックイン試行データがまだありません</p></Section>;
  }

  const fb = attempts.failure_breakdown;
  const failureItems: Array<{ label: string; count: number }> = [
    { label: "範囲外", count: fb.out_of_range },
    { label: "権限拒否", count: fb.permission_denied },
    { label: "GPS取得不可", count: fb.gps_unavailable },
    { label: "リクエスト不正", count: fb.invalid_request },
    { label: "GPS未対応地点", count: fb.location_not_supported },
    { label: "設定不備", count: fb.location_config_incomplete },
  ].filter((item) => item.count > 0);

  return (
    <Section title="GPS 成功率">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: failureItems.length > 0 ? 16 : 0 }}>
        <MiniStat label="試行数" value={`${attempts.total_attempts}件`} />
        <MiniStat label="成功" value={`${attempts.successes}件`} color="#16a34a" />
        <MiniStat label="失敗" value={`${attempts.failures}件`} color={attempts.failures > 0 ? "#dc2626" : undefined} />
        <MiniStat label="成功率" value={attempts.success_rate != null ? `${attempts.success_rate}%` : "—"} color="#2563eb" />
      </div>

      {failureItems.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>失敗理由の内訳</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {failureItems.map((item) => (
              <span key={item.label} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", background: "#fef2f2", borderRadius: 6,
                fontSize: 12, color: "#dc2626",
              }}>
                {item.label}: <strong>{item.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "10px 14px", background: "#f9fafb", borderRadius: 8 }}>
      <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 600, color: color ?? "#374151" }}>{value}</p>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const meta: Record<string, { bg: string; color: string; label: string }> = {
    qr:          { bg: "#dbeafe", color: "#2563eb", label: "QR" },
    gps:         { bg: "#dcfce7", color: "#16a34a", label: "GPS" },
    qr_and_gps:  { bg: "#ede9fe", color: "#7c3aed", label: "QR+GPS" },
    beacon:      { bg: "#fef3c7", color: "#d97706", label: "Beacon" },
  };
  const m = meta[method] ?? { bg: "#f3f4f6", color: "#6b7280", label: method };
  return (
    <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, fontSize: 14, color: "#374151" }}>{title}</div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 16, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>{text}</div>;
}

const thL: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "#6b7280", fontSize: 12 };
const thR: React.CSSProperties = { ...thL, textAlign: "right" };
const tdL: React.CSSProperties = { padding: "10px 12px", color: "#374151" };
const tdR: React.CSSProperties = { ...tdL, textAlign: "right" };
