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
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import type { LocationVisitStats, LocationVisit, GpsAttemptStats } from "@/types";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── 地点到着トリガー状況（ユーザー別・参照のみ）──
const TRIGGER_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending:  { label: "待機中",       bg: "#dbeafe", color: "#1d4ed8" },
  consumed: { label: "通過済み",     bg: "#dcfce7", color: "#16a34a" },
  expired:  { label: "期限切れ",     bg: "#f3f4f6", color: "#6b7280" },
  canceled: { label: "キャンセル済み", bg: "#f3f4f6", color: "#6b7280" },
};
const TRIGGER_METHOD_LABEL: Record<string, string> = { qr: "QRコード", gps: "現在地（GPS）", beacon: "Beacon検知" };

type CheckinTriggerRow = {
  id: string; status: string; trigger_type: string;
  location_id: string; location_name: string | null;
  source_message_id: string | null; source_message_label: string | null;
  next_message_id: string | null; next_message_label: string | null;
  next_phase_id: string | null; next_phase_name: string | null;
  armed_at: string; consumed_at: string | null; expires_at: string | null;
  linked_beacon_count: number;
};
type CheckinTriggerStatusResponse = {
  line_user_id_prefix: string;
  current_phase: { id: string; name: string | null } | null;
  triggers: CheckinTriggerRow[];
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function LocationCheckinsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [stats, setStats] = useState<LocationVisitStats | null>(null);
  const [recentVisits, setRecentVisits] = useState<(LocationVisit & { location_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 地点到着トリガー状況（ユーザー別・参照のみ）。Pro Max / 委託 のみ表示。──
  const { effectivePlan } = useAccessPreview(oaId);
  const canUseLocationFeatures = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location }).allowed;
  const [triggerUserId, setTriggerUserId]   = useState("");
  const [triggerData, setTriggerData]       = useState<CheckinTriggerStatusResponse | null>(null);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerError, setTriggerError]     = useState<string | null>(null);

  async function lookupTriggerStatus(e: React.FormEvent) {
    e.preventDefault();
    const uid = triggerUserId.trim();
    if (!uid) return;
    setTriggerLoading(true);
    setTriggerError(null);
    setTriggerData(null);
    try {
      const res = await fetch(
        `/api/works/${workId}/checkin-triggers?line_user_id=${encodeURIComponent(uid)}`,
        { headers: authHeaders(getDevToken()), cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json.success) { setTriggerError(json?.error?.message ?? "取得に失敗しました"); return; }
      setTriggerData(json.data as CheckinTriggerStatusResponse);
    } catch {
      setTriggerError("通信エラーが発生しました");
    } finally {
      setTriggerLoading(false);
    }
  }

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

      {/* ── 地点到着トリガー状況（ユーザー別・参照のみ）── */}
      {canUseLocationFeatures && (
        <Section title="地点到着トリガー状況（ユーザー別）">
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.6 }}>
            参加者の LINE ユーザー ID を入力すると、いま待機中の地点・通過済みの地点を確認できます。
            「到着しても次のメッセージが届かない」原因の切り分けに使えます（参照のみ）。
          </p>
          <form onSubmit={lookupTriggerStatus} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input
              type="text"
              value={triggerUserId}
              onChange={(e) => setTriggerUserId(e.target.value)}
              placeholder="LINE ユーザー ID（U... ）"
              style={{ flex: "1 1 280px", minWidth: 220, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, fontFamily: "ui-monospace, monospace" }}
            />
            <button type="submit" disabled={triggerLoading || !triggerUserId.trim()}
              style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: triggerLoading || !triggerUserId.trim() ? "not-allowed" : "pointer", opacity: triggerLoading || !triggerUserId.trim() ? 0.6 : 1 }}>
              {triggerLoading ? "取得中…" : "状況を確認"}
            </button>
          </form>
          {triggerError && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 12, marginBottom: 8 }}>{triggerError}</div>
          )}
          {triggerData && <TriggerStatusView data={triggerData} />}
        </Section>
      )}

      {loading && <InlineWhaleLoader padding={40} />}
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
                            <Link href={`/oas/${oaId}/locations/${loc.location_id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
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
                                href={`/oas/${oaId}/locations/${loc.location_id}${loc.radius_suggestion ? `?suggested_radius=${loc.radius_suggestion.suggested_radius}` : ""}`}
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

// ── 地点到着トリガー状況の表示（参照のみ）──
function TriggerStatusBadge({ status }: { status: string }) {
  const m = TRIGGER_STATUS_META[status] ?? { label: status, bg: "#f3f4f6", color: "#6b7280" };
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color }}>{m.label}</span>;
}

function TriggerCard({ t }: { t: CheckinTriggerRow }) {
  const rows: [string, React.ReactNode][] = [
    ["検知方法",       TRIGGER_METHOD_LABEL[t.trigger_type] ?? t.trigger_type],
    ["対象地点",       t.location_name ?? <span style={{ color: "#b45309" }}>未設定/不明</span>],
    ["起点メッセージ",   t.source_message_label ?? "—"],
    ["到着時メッセージ", t.next_message_label ?? <span style={{ color: "#9ca3af" }}>なし</span>],
    ["到着後フェーズ",   t.next_phase_name ?? <span style={{ color: "#9ca3af" }}>なし</span>],
    ["作成日時",       fmtDateTime(t.armed_at)],
    ...(t.consumed_at ? [["消化日時", fmtDateTime(t.consumed_at)] as [string, React.ReactNode]] : []),
    ...(t.expires_at  ? [["有効期限", fmtDateTime(t.expires_at)]  as [string, React.ReactNode]] : []),
  ];
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ marginBottom: 6 }}><TriggerStatusBadge status={t.status} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12, color: "#374151" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <div style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{k}</div>
            <div style={{ minWidth: 0 }}>{v}</div>
          </div>
        ))}
      </div>
      {/* Beacon 切り分け補助: 対象地点に紐づく BeaconTrigger 数 */}
      {t.trigger_type === "beacon" && (
        t.linked_beacon_count > 0
          ? <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280" }}>この地点に紐づくBeacon: {t.linked_beacon_count} 件</div>
          : <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, padding: "4px 8px", borderRadius: 5, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
              ⚠ この地点に紐づくBeaconがありません。Beacon検知では進行しません（ビーコン編集で同じ地点を紐づけてください）。
            </div>
      )}
    </div>
  );
}

function TriggerStatusView({ data }: { data: CheckinTriggerStatusResponse }) {
  const pending  = data.triggers.filter((t) => t.status === "pending");
  const consumed = data.triggers.filter((t) => t.status === "consumed");
  const others   = data.triggers.filter((t) => t.status === "expired" || t.status === "canceled");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "#6b7280" }}>
        対象ユーザー: <code style={{ fontFamily: "ui-monospace, monospace" }}>{data.line_user_id_prefix}…</code>
        {data.current_phase && <span style={{ marginLeft: 12 }}>現在フェーズ: <strong style={{ color: "#374151" }}>{data.current_phase.name ?? data.current_phase.id}</strong></span>}
      </div>

      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>現在待機中の地点</p>
        {pending.length === 0
          ? <p style={{ fontSize: 12, color: "#9ca3af" }}>現在待機中の地点到着トリガーはありません。</p>
          : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{pending.map((t) => <TriggerCard key={t.id} t={t} />)}</div>}
      </div>

      {consumed.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>通過済みの地点（{consumed.length}）</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{consumed.map((t) => <TriggerCard key={t.id} t={t} />)}</div>
        </div>
      )}

      {others.length > 0 && (
        <details>
          <summary style={{ fontSize: 12, color: "#6b7280", cursor: "pointer" }}>期限切れ / キャンセル済み（{others.length}）</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{others.map((t) => <TriggerCard key={t.id} t={t} />)}</div>
        </details>
      )}
    </div>
  );
}

const thL: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "#6b7280", fontSize: 12 };
const thR: React.CSSProperties = { ...thL, textAlign: "right" };
const tdL: React.CSSProperties = { padding: "10px 12px", color: "#374151" };
const tdR: React.CSSProperties = { ...tdL, textAlign: "right" };
