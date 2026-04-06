"use client";

// src/app/oas/[id]/works/[workId]/audience/page.tsx
// 作品レベルのオーディエンス — データ分析・リアルタイム・フロー・セグメント・トラッキング

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  oaApi, workApi, segmentApi, trackingApi, analyticsApi, segmentAnalyticsApi, getDevToken,
} from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { useToast } from "@/components/Toast";
import type {
  Segment, Tracking, AnalyticsData, AnalyticsPhaseStats, AnalyticsDropoutItem, SegmentAnalytics,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const FILTER_LABEL: Record<string, string> = {
  friend_7d:   "友だち追加 7 日以内",
  inactive_7d: "最終操作 7 日以上前",
  phase:       "フェーズ指定",
};
const FILTER_COLOR: Record<string, { bg: string; color: string }> = {
  friend_7d:   { bg: "#dbeafe", color: "#1d4ed8" },
  inactive_7d: { bg: "#fef3c7", color: "#92400e" },
  phase:       { bg: "#ede9fe", color: "#5b21b6" },
};
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: "有効", bg: "#dcfce7", color: "#16a34a" },
  inactive: { label: "無効", bg: "#f3f4f6", color: "#6b7280" },
};
const PLAYER_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  active:    { bg: "#dcfce7", color: "#16a34a", label: "プレイ中" },
  stuck:     { bg: "#fef3c7", color: "#d97706", label: "詰まり中" },
  dropped:   { bg: "#fee2e2", color: "#dc2626", label: "離脱" },
  completed: { bg: "#ede9fe", color: "#7c3aed", label: "クリア" },
};

function fmtMin(min: number): string {
  if (min < 1)  return "1分未満";
  if (min < 60) return `${Math.round(min)}分`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1)  return "たった今";
  if (m < 60) return `${m}分前`;
  if (h < 24) return `${h}時間前`;
  if (d < 7)  return `${d}日前`;
  return new Date(isoStr).toLocaleDateString("ja-JP");
}

function buildTrackingUrl(targetUrl: string, trackingId: string, utmEnabled: boolean): string {
  if (!targetUrl || !trackingId) return "";
  try {
    const url = new URL(targetUrl);
    if (utmEnabled) {
      url.searchParams.set("utm_source", "line");
      url.searchParams.set("utm_medium", "official_account");
      url.searchParams.set("utm_campaign", trackingId);
    } else {
      url.searchParams.set("trk", trackingId);
    }
    return url.toString();
  } catch { return targetUrl; }
}

// ── PhaseRow ──────────────────────────────────────────────────────────────────
function PhaseRow({ ps, total }: { ps: AnalyticsPhaseStats; total: number }) {
  const reachPct = total > 0 ? Math.round((ps.reached / total) * 100) : 0;
  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
      <td style={{ padding: "12px 14px", fontWeight: 500, color: "#111827" }}>
        {ps.phase_name}
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>到達率 {reachPct}%</div>
      </td>
      <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600, color: "#374151" }}>{ps.reached}</td>
      <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600, color: "#16a34a" }}>{ps.cleared}</td>
      <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600, color: "#2563eb" }}>{ps.currently_at}</td>
      <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600, color: "#dc2626" }}>{ps.dropped_out}</td>
      <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600, color: "#d97706" }}>{ps.stuck}</td>
      <td style={{ padding: "12px 14px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
          <div style={{ width: 48, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, width: `${ps.clear_rate}%`,
              background: ps.clear_rate >= 70 ? "#16a34a" : ps.clear_rate >= 40 ? "#d97706" : "#dc2626" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: ps.clear_rate >= 70 ? "#16a34a" : ps.clear_rate >= 40 ? "#d97706" : "#dc2626" }}>
            {ps.clear_rate}%
          </span>
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkAudiencePage() {
  const params        = useParams<{ id: string; workId: string }>();
  const oaId          = params.id;
  const workId        = params.workId;
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const { showToast } = useToast();

  type TabType = "data" | "realtime" | "flow" | "segments" | "tracking";
  const activeTab = (searchParams.get("tab") as TabType) ?? "data";

  // ── State ─────────────────────────────────────────────────────────────────
  const [oaTitle,      setOaTitle]      = useState("");
  const [workTitle,    setWorkTitle]    = useState("");
  const [segments,     setSegments]     = useState<Segment[]>([]);
  const [trackings,    setTrackings]    = useState<Tracking[]>([]);
  const [baseLoading,  setBaseLoading]  = useState(true);
  const [baseError,    setBaseError]    = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [copiedId,     setCopiedId]     = useState<string | null>(null);

  const [analytics,     setAnalytics]    = useState<AnalyticsData | null>(null);
  const [anaLoading,    setAnaLoading]   = useState(false);
  const [anaError,      setAnaError]     = useState<string | null>(null);
  const [segAna,        setSegAna]       = useState<SegmentAnalytics[]>([]);
  const [segAnaLoading, setSegAnaLoading] = useState(false);
  const [autoRefresh,   setAutoRefresh]  = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadBase = useCallback(() => {
    const token = getDevToken();
    setBaseLoading(true);
    setBaseError(null);
    Promise.all([
      oaApi.get(token, oaId),
      workApi.get(token, workId),
      segmentApi.list(token, oaId),
      trackingApi.list(token, oaId),
    ])
      .then(([oa, work, segs, trks]) => {
        setOaTitle(oa.title);
        setWorkTitle(work.title);
        setSegments(segs);
        setTrackings(trks);
      })
      .catch((e) => setBaseError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setBaseLoading(false));
  }, [oaId, workId]);

  const loadAnalytics = useCallback(async () => {
    setAnaLoading(true);
    setAnaError(null);
    try {
      setAnalytics(await analyticsApi.get(getDevToken(), workId));
    } catch (e) {
      setAnaError(e instanceof Error ? e.message : "分析データの取得に失敗しました");
    } finally { setAnaLoading(false); }
  }, [workId]);

  const loadSegAna = useCallback(async () => {
    setSegAnaLoading(true);
    try {
      setSegAna(await segmentAnalyticsApi.list(getDevToken(), oaId, workId));
    } catch { setSegAna([]); }
    finally { setSegAnaLoading(false); }
  }, [oaId, workId]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadAnalytics(); loadSegAna(); }, [loadAnalytics, loadSegAna]);

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => loadAnalytics(), 30000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, loadAnalytics]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function switchTab(tab: TabType) {
    router.push(`/oas/${oaId}/works/${workId}/audience?tab=${tab}`);
  }

  async function handleDeleteSegment(id: string, name: string) {
    if (!confirm(`セグメント「${name}」を削除しますか？`)) return;
    setDeletingId(id);
    try {
      await segmentApi.delete(getDevToken(), id);
      showToast("セグメントを削除しました", "success");
      setSegments((prev) => prev.filter((s) => s.id !== id));
      setSegAna((prev) => prev.filter((s) => s.segment_id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally { setDeletingId(null); }
  }

  async function handleDeleteTracking(id: string, name: string) {
    if (!confirm(`トラッキング「${name}」を削除しますか？`)) return;
    setDeletingId(id);
    try {
      await trackingApi.delete(getDevToken(), id);
      showToast("トラッキングを削除しました", "success");
      setTrackings((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally { setDeletingId(null); }
  }

  async function copyTrackingUrl(trk: Tracking) {
    const url = buildTrackingUrl(trk.target_url, trk.tracking_id, trk.utm_enabled);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(trk.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { showToast("コピーに失敗しました", "error"); }
  }

  // ── Shared sub-components ─────────────────────────────────────────────────
  const tabStyle = (tab: TabType) => ({
    padding: "8px 18px", fontSize: 13, fontWeight: 600,
    cursor: "pointer", background: "none", border: "none",
    borderBottom: activeTab === tab ? "2px solid #06C755" : "2px solid transparent",
    color: activeTab === tab ? "#06C755" : "#6b7280",
    transition: "color .15s, border-color .15s", whiteSpace: "nowrap",
  } as React.CSSProperties);

  function RefreshButton() {
    return (
      <button
        onClick={() => { loadAnalytics(); loadSegAna(); }}
        className="btn btn-ghost"
        disabled={anaLoading}
        style={{ fontSize: 12, padding: "6px 14px" }}
      >
        {anaLoading ? <><span className="spinner" /> 更新中</> : "🔃 更新"}
      </button>
    );
  }

  function AnaErrorBanner() {
    if (!anaError) return null;
    return (
      <div className="alert alert-error" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{anaError}</span>
        <button onClick={() => loadAnalytics()}
          style={{ marginLeft: 12, padding: "4px 12px", fontSize: 12, background: "#991b1b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
          再試行
        </button>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ヘッダー */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle, href: `/oas/${oaId}/works` }] : []),
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "オーディエンス" },
          ]} />
          <h2>オーディエンス</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            全体・現在・フロー・ユーザー・流入を一画面で把握できます。
          </p>
        </div>
      </div>

      <HelpAccordion items={[
        { title: "この画面でできること", points: [
          "プレイヤーの進捗・離脱・クリア率などの統計を確認できます",
          "リアルタイムで現在プレイ中のユーザーを把握できます",
          "セグメントでユーザーをグループ化して分析できます",
        ]},
        { title: "各タブの説明", points: [
          "データ分析: 総合統計・フェーズ別クリア率・離脱ポイント",
          "リアルタイム: 現在プレイ中・詰まり中のユーザー一覧",
          "フロー分析: フェーズごとの到達・クリア・離脱の詳細",
          "セグメント: 条件でユーザーをグループ化",
          "トラッキング: 流入元の計測とユーザー帰属",
        ]},
        { title: "注意点", points: [
          "データは LINE webhook の受信時に更新されます",
          "リアルタイムは 30 秒間隔で自動更新できます（自動更新ボタン）",
        ]},
      ]} />

      {baseError && (
        <div className="alert alert-error" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span>{baseError}</span>
          <button onClick={loadBase} style={{ marginLeft: 12, padding: "4px 12px", fontSize: 12, background: "#991b1b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* タブ */}
      <div style={{ borderBottom: "1px solid #e5e5e5", marginBottom: 20, display: "flex", gap: 0, overflowX: "auto" }}>
        <button style={tabStyle("data")}     onClick={() => switchTab("data")}>データ分析</button>
        <button style={tabStyle("realtime")} onClick={() => switchTab("realtime")}>🔴 リアルタイム</button>
        <button style={tabStyle("flow")}     onClick={() => switchTab("flow")}>🧭 フロー分析</button>
        <button style={tabStyle("segments")} onClick={() => switchTab("segments")}>
          セグメント{!baseLoading && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>({segments.length})</span>}
        </button>
        <button style={tabStyle("tracking")} onClick={() => switchTab("tracking")}>
          🔗 トラッキング{!baseLoading && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>({trackings.length})</span>}
        </button>
      </div>

      {/* ══ データ分析 ══════════════════════════════════════════════════════════ */}
      {activeTab === "data" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <RefreshButton />
          </div>
          <AnaErrorBanner />

          {/* KPI カード */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <KpiCard label="プレイヤー数"
              value={analytics?.summary.total_players}
              color="#111827" loading={anaLoading} />
            <KpiCard label="クリア率"
              value={analytics ? `${analytics.summary.clear_rate}%` : undefined}
              color={analytics ? (analytics.summary.clear_rate >= 70 ? "#16a34a" : analytics.summary.clear_rate >= 40 ? "#d97706" : "#ef4444") : "#9ca3af"}
              loading={anaLoading}
              note={analytics ? `${analytics.summary.total_clears}人クリア` : undefined} />
            <KpiCard label="離脱率"
              value={analytics ? `${analytics.summary.dropout_rate}%` : undefined}
              color={analytics ? (analytics.summary.dropout_rate <= 20 ? "#16a34a" : analytics.summary.dropout_rate <= 40 ? "#d97706" : "#ef4444") : "#9ca3af"}
              loading={anaLoading} note="24h以上未操作" />
            <KpiCard label="ヒント使用率"
              value={analytics ? `${analytics.summary.hint_usage_rate}%` : undefined}
              color="#7c3aed" loading={anaLoading} note="1回以上使用" />
          </div>

          {/* プレイ時間統計 */}
          <div className="card">
            <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280", marginBottom: 14 }}>⏱ プレイ時間統計</div>
            {anaLoading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                {[1,2,3,4,5,6].map((i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />)}
              </div>
            ) : !analytics || analytics.summary.total_players === 0 ? (
              <p style={{ fontSize: 13, color: "#9ca3af" }}>プレイヤーがいません。</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                {[
                  { label: "総クリア数",     value: `${analytics.summary.total_clears}人`,                   note: "" },
                  { label: "平均プレイ時間", value: fmtMin(analytics.summary.avg_play_time_min),             note: "全プレイヤー" },
                  { label: "中央値",         value: fmtMin(analytics.summary.median_play_time_min),          note: "全プレイヤー" },
                  { label: "最短",           value: fmtMin(analytics.summary.min_play_time_min),             note: "" },
                  { label: "最長",           value: fmtMin(analytics.summary.max_play_time_min),             note: "" },
                  { label: "クリア者の平均", value: analytics.summary.total_clears > 0 ? fmtMin(analytics.summary.avg_completed_play_time_min) : "—", note: "クリア者のみ" },
                ].map(({ label, value, note }) => (
                  <div key={label} style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4, fontWeight: 400 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0891b2" }}>{value}</div>
                    {note && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 問題別分析 */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid #e5e5e5" }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280" }}>📋 問題別分析</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>各フェーズの到達・クリア・離脱・詰まり</div>
            </div>
            {anaLoading ? (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 36, borderRadius: 6 }} />)}
              </div>
            ) : !analytics || analytics.phase_stats.length === 0 ? (
              <div style={{ padding: "24px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                フェーズが登録されていません。
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e5e5", background: "#f9fafb" }}>
                      {["フェーズ名", "到達", "クリア", "現在地", "離脱", "詰まり", "クリア率"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: h === "フェーズ名" ? "left" : "center", fontWeight: 600, color: "#374151", fontSize: 12, whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.phase_stats.map((ps) => (
                      <PhaseRow key={ps.phase_id} ps={ps} total={analytics.summary.total_players} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 離脱分布 */}
          {!anaLoading && analytics && analytics.dropout_distribution.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280", marginBottom: 14 }}>離脱分布</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {analytics.dropout_distribution.map((d) => (
                  <div key={d.phase_id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: "#374151", fontWeight: 500 }}>{d.phase_name}</span>
                      <span style={{ fontWeight: 700, color: "#dc2626" }}>
                        {d.dropout_count} 人 <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>({d.dropout_pct}%)</span>
                      </span>
                    </div>
                    <div style={{ background: "#fef2f2", borderRadius: 4, height: 8 }}>
                      <div style={{ background: "#dc2626", borderRadius: 4, height: 8, width: `${d.dropout_pct}%`, transition: "width .4s" }} />
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>※ 離脱 = そのフェーズで 24 時間以上アクティビティがないプレイヤー</p>
            </div>
          )}
        </div>
      )}

      {/* ══ リアルタイム ════════════════════════════════════════════════════════ */}
      {activeTab === "realtime" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
            <button onClick={() => loadAnalytics()} className="btn btn-ghost"
              disabled={anaLoading} style={{ fontSize: 12, padding: "6px 14px" }}>
              {anaLoading ? <><span className="spinner" /> 更新中</> : "🔃 更新"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              30秒ごとに自動更新
            </label>
          </div>
          <AnaErrorBanner />

          {/* リアルタイムサマリー */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {[
              { label: "現在プレイ中",    v: analytics?.realtime.currently_playing, color: "#16a34a", note: "30分以内にアクティブ" },
              { label: "本日開始",        v: analytics?.realtime.started_today,     color: "#2563eb", note: "" },
              { label: "本日クリア",      v: analytics?.realtime.cleared_today,     color: "#7c3aed", note: "" },
              { label: "7日間アクティブ", v: analytics?.realtime.active_last_7d,   color: "#d97706", note: "" },
            ].map(({ label, v, color, note }) => (
              <div key={label} className="card" style={{ padding: "16px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, fontWeight: 400 }}>{label}</div>
                {anaLoading ? <div className="skeleton" style={{ width: 60, height: 28, margin: "0 auto" }} />
                  : <div style={{ fontSize: 30, fontWeight: 700, color }}>{v ?? "—"}</div>}
                {note && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{note}</div>}
              </div>
            ))}
          </div>

          {/* フェーズ別現在地 */}
          <div className="card">
            <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280", marginBottom: 14 }}>📍 フェーズ別現在地</div>
            {anaLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 36, borderRadius: 8 }} />)}
              </div>
            ) : !analytics || analytics.phase_stats.every((p) => p.currently_at === 0) ? (
              <p style={{ fontSize: 13, color: "#9ca3af" }}>現在プレイ中のユーザーはいません。</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {analytics.phase_stats.filter((p) => p.currently_at > 0).map((p) => {
                  const maxAt = Math.max(...analytics.phase_stats.map((x) => x.currently_at), 1);
                  return (
                    <div key={p.phase_id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 13, color: "#374151", fontWeight: 500, minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {p.phase_name}
                      </span>
                      <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 4, height: 8 }}>
                        <div style={{ background: "#06C755", borderRadius: 4, height: 8, width: `${Math.round((p.currently_at / maxAt) * 100)}%`, transition: "width .4s" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111827", minWidth: 48, textAlign: "right" }}>{p.currently_at} 人</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 詰まり検知 */}
          <div className="card">
            <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280", marginBottom: 4 }}>詰まり検知</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>10分以上同じフェーズに滞在（24時間未満）</div>
            {anaLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[1,2].map((i) => <div key={i} className="skeleton" style={{ height: 40, borderRadius: 8 }} />)}
              </div>
            ) : !analytics || analytics.stuck_players.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#f0fdf4", borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 500 }}>詰まっているプレイヤーはいません</span>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 8, fontSize: 13, color: "#d97706", fontWeight: 600 }}>{analytics.stuck_players.length} 人が詰まっています</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {analytics.stuck_players.map((sp) => (
                    <div key={sp.anonymous_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a" }}>
                      <code style={{ fontSize: 12, color: "#374151", background: "#fef3c7", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>{sp.anonymous_id}</code>
                      <span style={{ fontSize: 13, color: "#374151", flex: 1 }}>{sp.current_phase_name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#d97706", flexShrink: 0 }}>{sp.stuck_minutes}分停滞</span>
                      <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>{timeAgo(sp.last_active)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* プレイヤー詳細 */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid #e5e5e5" }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: "#6b7280" }}>プレイヤー詳細（最新100件）</div>
            </div>
            {anaLoading ? (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {[1,2,3,4,5].map((i) => <div key={i} className="skeleton" style={{ height: 36, borderRadius: 6 }} />)}
              </div>
            ) : !analytics || analytics.player_details.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>まだプレイヤーがいません。</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e5e5", background: "#f9fafb" }}>
                      {["匿名ID", "現在地", "プレイ時間", "状態", "最終アクティブ"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 12, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.player_details.map((pd) => {
                      const st = PLAYER_STATUS[pd.status] ?? PLAYER_STATUS.dropped;
                      return (
                        <tr key={pd.anonymous_id} style={{ borderBottom: "1px solid #f3f4f6" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                          <td style={{ padding: "10px 14px" }}>
                            <code style={{ fontSize: 12, background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>{pd.anonymous_id}</code>
                          </td>
                          <td style={{ padding: "10px 14px", color: "#374151" }}>{pd.current_phase_name ?? "—"}</td>
                          <td style={{ padding: "10px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>{fmtMin(pd.play_time_min)}</td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: st.bg, color: st.color }}>{st.label}</span>
                          </td>
                          <td style={{ padding: "10px 14px", color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(pd.last_active)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ フロー分析 ══════════════════════════════════════════════════════════ */}
      {activeTab === "flow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <RefreshButton />
            <Link href={`/oas/${oaId}/works/${workId}/scenario`} className="btn btn-ghost" style={{ fontSize: 12 }}>
              シナリオフロー（設計）→
            </Link>
          </div>
          <AnaErrorBanner />

          {/* サマリー */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <FlowMiniCard loading={anaLoading} label="総プレイヤー数" value={analytics?.summary.total_players} color="#111827" />
            <FlowMiniCard loading={anaLoading} label="現在プレイ中" value={analytics?.realtime.currently_playing} color="#2563eb" />
            <FlowMiniCard loading={anaLoading} label="クリア率"
              value={analytics ? `${analytics.summary.clear_rate}%` : undefined}
              color={analytics ? flowRateColor(analytics.summary.clear_rate) : "#9ca3af"}
            />
            <FlowMiniCard loading={anaLoading} label="詰まり中" value={analytics?.stuck_players.length} color="#d97706" />
          </div>

          {/* フェーズ別進行分析 */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e5e5e5", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#374151" }}>📍 フェーズ別進行分析</p>
                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  各フェーズへの到達・クリア・離脱の状況。「編集」からフェーズ設定を変更できます。
                </p>
              </div>
            </div>
            {anaLoading ? (
              <div style={{ padding: 16 }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div className="skeleton" style={{ width: 200, height: 14, marginBottom: 8 }} />
                    <div className="skeleton" style={{ height: 8, borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            ) : !analytics || analytics.phase_stats.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                まだデータがありません。プレイヤーが進行するとここに表示されます。
              </div>
            ) : (
              <FlowPhaseStats
                items={analytics.phase_stats}
                totalPlayers={analytics.summary.total_players}
                oaId={oaId}
                workId={workId}
              />
            )}
          </div>

          {/* 下段: 離脱分布 + 詰まり中プレイヤー */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
            {/* 離脱分布 */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e5e5e5" }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#374151" }}>🚪 フェーズ別離脱分布</p>
                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>どのフェーズで離脱が多いかを確認できます。</p>
              </div>
              {anaLoading ? (
                <div style={{ padding: 16 }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <div className="skeleton" style={{ width: 160, height: 13, marginBottom: 4 }} />
                      <div className="skeleton" style={{ height: 8, borderRadius: 4 }} />
                    </div>
                  ))}
                </div>
              ) : !analytics || analytics.dropout_distribution.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>離脱データなし</div>
              ) : (
                <FlowDropoutList items={analytics.dropout_distribution} oaId={oaId} workId={workId} />
              )}
            </div>

            {/* 詰まり中プレイヤー */}
            <div className="card" style={{ padding: 0, alignSelf: "start" }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e5e5e5" }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#374151" }}>⏳ 詰まり中のプレイヤー</p>
                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>長時間同じフェーズにいるプレイヤー</p>
              </div>
              {anaLoading ? (
                <div style={{ padding: 16 }}>
                  {[1, 2].map((i) => (
                    <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
                      <div className="skeleton" style={{ width: 80, height: 11 }} />
                    </div>
                  ))}
                </div>
              ) : !analytics || analytics.stuck_players.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                  詰まり中のプレイヤーなし
                </div>
              ) : (
                <div>
                  {analytics.stuck_players.map((p, i) => (
                    <div key={i} style={{
                      padding: "10px 16px",
                      borderBottom: i < analytics.stuck_players.length - 1 ? "1px solid #f3f4f6" : "none",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 2 }}>
                        {p.current_phase_name}
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280" }}>
                        <span>⏱ {fmtMin(p.stuck_minutes)}</span>
                        <span>最終: {timeAgo(p.last_active)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ セグメント ══════════════════════════════════════════════════════════ */}
      {activeTab === "segments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>セグメント管理</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>ユーザーグループを定義し、各グループの行動を分析します</div>
            </div>
            <Link href={`/oas/${oaId}/audience/segments/new`} className="btn btn-primary">＋ 新規作成</Link>
          </div>

          {baseLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1,2].map((i) => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />)}
            </div>
          ) : segments.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <p className="empty-state-title">セグメントがまだありません</p>
                <p className="empty-state-desc">ユーザーを絞り込み条件でグループ化して分析できます。</p>
                <Link href={`/oas/${oaId}/audience/segments/new`} className="btn btn-primary" style={{ marginTop: 8, display: "inline-block" }}>
                  ＋ 最初のセグメントを作成
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {segments.map((seg) => {
                const statusMeta  = STATUS_META[seg.status as keyof typeof STATUS_META] ?? STATUS_META.inactive;
                const filterColor = FILTER_COLOR[seg.filter_type] ?? { bg: "#f3f4f6", color: "#374151" };
                const ana = segAna.find((a) => a.segment_id === seg.id);
                return (
                  <div key={seg.id} className="card" style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{seg.name}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: statusMeta.bg, color: statusMeta.color }}>
                            {statusMeta.label}
                          </span>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: filterColor.bg, color: filterColor.color }}>
                            {FILTER_LABEL[seg.filter_type] ?? seg.filter_type}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <Link href={`/oas/${oaId}/audience/segments/${seg.id}`} className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: 12 }}>編集</Link>
                        <button className="btn btn-danger" style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={() => handleDeleteSegment(seg.id, seg.name)} disabled={deletingId === seg.id}>削除</button>
                      </div>
                    </div>
                    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                      {segAnaLoading ? (
                        <div style={{ display: "flex", gap: 10 }}>
                          {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ flex: 1, height: 44, borderRadius: 8 }} />)}
                        </div>
                      ) : !ana ? (
                        <p style={{ fontSize: 12, color: "#9ca3af" }}>データなし</p>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                          {[
                            { label: "対象人数",       value: `${ana.total_matched}人`,      color: "#111827" },
                            { label: "クリア率",       value: `${ana.clear_rate}%`,          color: "#16a34a" },
                            { label: "平均プレイ時間", value: fmtMin(ana.avg_play_time_min), color: "#0891b2" },
                            { label: "離脱率",         value: `${ana.dropout_rate}%`,        color: "#dc2626" },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                              <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color }}>{value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ トラッキング ════════════════════════════════════════════════════════ */}
      {activeTab === "tracking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>トラッキング管理</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>流入経路を計測するトラッキングリンクを作成・管理します</div>
            </div>
            <Link href={`/oas/${oaId}/audience/tracking/new`} className="btn btn-primary">＋ 新規作成</Link>
          </div>

          {baseLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1,2].map((i) => <div key={i} className="skeleton" style={{ height: 140, borderRadius: 12 }} />)}
            </div>
          ) : trackings.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">🔗</div>
                <p className="empty-state-title">トラッキングがまだありません</p>
                <p className="empty-state-desc">SNS・広告などの流入経路ごとにトラッキングリンクを作成できます。</p>
                <Link href={`/oas/${oaId}/audience/tracking/new`} className="btn btn-primary" style={{ marginTop: 8, display: "inline-block" }}>
                  ＋ 最初のトラッキングを作成
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {trackings.map((trk) => {
                const trkUrl = buildTrackingUrl(trk.target_url, trk.tracking_id, trk.utm_enabled);
                const isCopied = copiedId === trk.id;
                return (
                  <div key={trk.id} className="card" style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{trk.name}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: trk.utm_enabled ? "#dbeafe" : "#f3f4f6", color: trk.utm_enabled ? "#1d4ed8" : "#6b7280" }}>
                            {trk.utm_enabled ? "UTM 有効" : "UTM 無効"}
                          </span>
                        </div>
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "#6b7280" }}>ID:</span>
                          <code style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 6px", borderRadius: 4, color: "#374151" }}>{trk.tracking_id}</code>
                          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>計測URL:</span>
                          <span style={{ fontSize: 11, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{trk.target_url}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <Link href={`/oas/${oaId}/audience/tracking/${trk.id}`} className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: 12 }}>編集</Link>
                        <button className="btn btn-danger" style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={() => handleDeleteTracking(trk.id, trk.name)} disabled={deletingId === trk.id}>削除</button>
                      </div>
                    </div>
                    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 6 }}>トラッキング URL</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                          {trkUrl || "— 計測URL を入力してください —"}
                        </div>
                        {trkUrl && (
                          <button onClick={() => copyTrackingUrl(trk)} className="btn btn-ghost"
                            style={{ padding: "6px 14px", fontSize: 12, flexShrink: 0, color: isCopied ? "#16a34a" : undefined }}>
                            {isCopied ? "コピー済み" : "コピー"}
                          </button>
                        )}
                      </div>
                      <div style={{ marginTop: 10, padding: "8px 12px", background: "#eff6ff", borderRadius: 8, fontSize: 12, color: "#1d4ed8", display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <span style={{ flexShrink: 0 }}>ℹ️</span>
                        <span>クリック数・流入元の詳細分析は <strong>LINE公式アカウントマネージャー</strong> のアクセス解析でご確認ください。</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── flowRateColor ─────────────────────────────────────────────────────────────
function flowRateColor(rate: number): string {
  if (rate >= 70) return "#16a34a";
  if (rate >= 40) return "#d97706";
  return "#ef4444";
}

// ── FlowMiniCard ──────────────────────────────────────────────────────────────
function FlowMiniCard({
  loading, label, value, color,
}: {
  loading: boolean; label: string; value?: number | string; color: string;
}) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{label}</p>
      {loading ? (
        <div className="skeleton" style={{ height: 28, width: 80, margin: "0 auto" }} />
      ) : (
        <p style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</p>
      )}
    </div>
  );
}

// ── FlowPhaseStats ────────────────────────────────────────────────────────────
function FlowPhaseStats({
  items, totalPlayers, oaId, workId,
}: {
  items: AnalyticsPhaseStats[]; totalPlayers: number; oaId: string; workId: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px" }}>
      {items.map((ps) => {
        const reachPct   = totalPlayers > 0 ? Math.round((ps.reached / totalPlayers) * 100) : 0;
        const dropPct    = ps.reached > 0 ? Math.round((ps.dropped_out / ps.reached) * 100) : 0;
        const currentPct = ps.reached > 0 ? Math.round((ps.currently_at / ps.reached) * 100) : 0;
        const stuckPct   = ps.reached > 0 ? Math.round((ps.stuck / ps.reached) * 100) : 0;
        const hasStuck   = ps.stuck > 0;

        const segments = [
          { pct: ps.clear_rate, color: "#22c55e", label: `${ps.clear_rate}%` },
          { pct: dropPct,       color: "#ef4444", label: `${dropPct}%` },
          { pct: currentPct,    color: "#3b82f6", label: `${currentPct}%` },
          { pct: stuckPct,      color: "#f59e0b", label: `${stuckPct}%` },
        ].filter((s) => s.pct > 0);

        return (
          <div key={ps.phase_id} style={{
            background: hasStuck ? "#fffbeb" : "#fff",
            border: `1px solid ${hasStuck ? "#fcd34d" : "#e5e7eb"}`,
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {hasStuck && <span style={{ fontSize: 15 }}>⚠</span>}
                <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{ps.phase_name}</span>
                <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", borderRadius: 6, padding: "1px 7px" }}>
                  到達 {ps.reached}人 ({reachPct}%)
                </span>
              </div>
              <Link
                href={`/oas/${oaId}/works/${workId}/phases/${ps.phase_id}`}
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "2px 10px" }}
              >
                編集
              </Link>
            </div>

            {ps.reached > 0 ? (
              <>
                <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "#f3f4f6", marginBottom: 8 }}>
                  {segments.map((seg, i) => (
                    <div key={i} title={seg.label} style={{ width: `${seg.pct}%`, background: seg.color, transition: "width 0.4s ease", minWidth: seg.pct > 0 ? 2 : 0 }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {ps.cleared > 0 && <FlowSegLabel color="#22c55e" label="クリア" value={ps.cleared} pct={ps.clear_rate} />}
                  {ps.dropped_out > 0 && <FlowSegLabel color="#ef4444" label="離脱" value={ps.dropped_out} pct={dropPct} />}
                  {ps.currently_at > 0 && <FlowSegLabel color="#3b82f6" label="プレイ中" value={ps.currently_at} pct={currentPct} />}
                  {ps.stuck > 0 && <FlowSegLabel color="#f59e0b" label="詰まり" value={ps.stuck} pct={stuckPct} warn />}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12, color: "#9ca3af" }}>到達者なし</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── FlowSegLabel ──────────────────────────────────────────────────────────────
function FlowSegLabel({
  color, label, value, pct, warn,
}: {
  color: string; label: string; value: number; pct: number; warn?: boolean;
}) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11,
      color: warn ? "#92400e" : "#374151",
      background: warn ? "#fef3c7" : "#f9fafb",
      border: `1px solid ${color}44`, borderRadius: 6, padding: "2px 8px",
      fontWeight: warn ? 700 : 500,
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}人</span>
      <span style={{ color: "#9ca3af" }}>({pct}%)</span>
    </span>
  );
}

// ── FlowDropoutList ───────────────────────────────────────────────────────────
function FlowDropoutList({
  items, oaId, workId,
}: {
  items: AnalyticsDropoutItem[]; oaId: string; workId: string;
}) {
  const max = Math.max(...items.map((i) => i.dropout_count), 1);
  return (
    <div style={{ padding: "8px 16px 12px" }}>
      {items.map((item) => (
        <div key={item.phase_id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{item.phase_name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{item.dropout_count}人</span>
              <Link
                href={`/oas/${oaId}/works/${workId}/phases/${item.phase_id}`}
                style={{ fontSize: 10, color: "#6b7280", textDecoration: "none", background: "#f3f4f6", borderRadius: 4, padding: "1px 6px" }}
              >
                編集
              </Link>
            </div>
          </div>
          <div style={{ height: 6, background: "#fee2e2", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, background: "#ef4444", width: `${Math.round((item.dropout_count / max) * 100)}%`, transition: "width 0.4s ease" }} />
          </div>
          <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>離脱率 {item.dropout_pct}%</p>
        </div>
      ))}
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, color, loading, note,
}: {
  label: string; value?: number | string;
  color: string; loading: boolean; note?: string;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
      <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 400, marginBottom: 10, letterSpacing: "0.02em" }}>
        {label}
      </div>
      {loading ? (
        <div className="skeleton" style={{ width: 70, height: 36, margin: "0 auto" }} />
      ) : (
        <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value ?? "—"}</div>
      )}
      {note && !loading && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{note}</div>
      )}
    </div>
  );
}
