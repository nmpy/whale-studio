"use client";

// src/app/oas/[id]/locations/logs/page.tsx
// 統合ロケーションログ（GPS / QR / Beacon）。read 専用・既存ログテーブルを集約表示。
// フィルタ: 作品 / 種別 / status / 日付 / userId。raw 展開・JST 表示。

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/shared";
import { getAuthHeaders, getDevToken, workApi } from "@/lib/api-client";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { getPlanAccessState, FEATURE } from "@/lib/constants/plans";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { CHECKIN_OUTCOME_META, checkinOutcomeLabel, type UnifiedLogRow, type LocationLogKind } from "@/lib/location-log";
import { BEACON_OUTCOME_META, beaconOutcomeLabel } from "@/lib/beacon-utils";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

const inputCls = "rounded-field border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-brand";

// status フィルタ候補（GPS/QR + Beacon の全 outcome を結合・重複排除）
const STATUS_OPTIONS: [string, string][] = (() => {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(CHECKIN_OUTCOME_META)) m.set(k, v.label);
  for (const [k, v] of Object.entries(BEACON_OUTCOME_META)) if (!m.has(k)) m.set(k, v.label);
  return [...m.entries()];
})();

function fmtJst(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}
function tailUserId(uid: string | null): string {
  if (!uid) return "—";
  return uid.length > 6 ? `…${uid.slice(-6)}` : uid;
}
function outcomeMeta(row: UnifiedLogRow): { label: string; kind: LocationLogKind } {
  return row.source === "beacon"
    ? beaconOutcomeLabel(row.outcome) as { label: string; kind: LocationLogKind }
    : checkinOutcomeLabel(row.outcome);
}
function kindCls(kind: LocationLogKind): string {
  if (kind === "success" || kind === "sent") return "bg-brand-soft text-brand-ink";
  if (kind === "matched") return "bg-brand-mist text-brand-ink";
  if (kind === "failed") return "bg-danger-soft text-danger";
  return "bg-line/60 text-ink-2"; // skipped / attempted / unknown
}
function typeCls(type: string): string {
  if (type === "GPS") return "bg-[#dcfce7] text-[#166534]";
  if (type === "QR") return "bg-[#ede9fe] text-[#6d28d9]";
  if (type === "GPS+QR") return "bg-brand-soft text-brand-ink";
  return "bg-[#dbeafe] text-[#1e40af]"; // Beacon
}

export default function LocationLogsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const sp = useSearchParams();
  // 作品コンテキスト（?workId=）を「現地トリガーへ」戻りリンクに引き継ぐ（共通サイドバー維持）。フィルタ挙動は不変。
  const ambientWorkId = sp.get("workId");

  const { effectivePlan, loading: planLoading } = useAccessPreview(oaId);
  const planAccess = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location });

  const [works, setWorks] = useState<{ id: string; title: string }[]>([]);
  const [rows, setRows] = useState<UnifiedLogRow[] | null>(null);
  const [meta, setMeta] = useState<{ truncated?: boolean; sources?: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // filters（deep-link 用に初期値を query から）
  const [workId, setWorkId] = useState(sp.get("workId") ?? "");
  const [type, setType] = useState(sp.get("type") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [userId, setUserId] = useState(sp.get("userId") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // deep-link 専用（UI セレクタは持たないが query があれば送る）
  const locationId = sp.get("locationId");
  const beaconTriggerId = sp.get("beaconTriggerId");

  useEffect(() => {
    workApi.list(getDevToken(), oaId).then((l) => setWorks(l.map((w) => ({ id: w.id, title: w.title })))).catch(() => {});
  }, [oaId]);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const qs = new URLSearchParams();
      if (workId) qs.set("workId", workId);
      if (type) qs.set("type", type);
      if (status) qs.set("status", status);
      if (userId.trim()) qs.set("userId", userId.trim());
      if (from) qs.set("from", new Date(from).toISOString());
      if (to) qs.set("to", new Date(to).toISOString());
      if (locationId) qs.set("locationId", locationId);
      if (beaconTriggerId) qs.set("beaconTriggerId", beaconTriggerId);
      const res = await fetch(`/api/oas/${oaId}/locations/logs?${qs.toString()}`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const json = await res.json();
      if (!json?.success) { setError(json?.error ?? "読み込みに失敗しました"); return; }
      setRows(json.data as UnifiedLogRow[]);
      setMeta(json.meta ?? null);
    } catch {
      setError("通信エラーが発生しました");
    }
  }, [oaId, workId, type, status, userId, from, to, locationId, beaconTriggerId]);

  useEffect(() => { load(); /* 初回のみ自動 */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oaId]);

  // CSV エクスポート URL（現在の絞り込み条件を引き継ぐ）
  const exportHref = (() => {
    const qs = new URLSearchParams();
    if (workId) qs.set("workId", workId);
    if (type) qs.set("type", type);
    if (status) qs.set("status", status);
    if (userId.trim()) qs.set("userId", userId.trim());
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) qs.set("from", d.toISOString()); }
    if (to) { const d = new Date(to); if (!isNaN(d.getTime())) qs.set("to", d.toISOString()); }
    if (locationId) qs.set("locationId", locationId);
    if (beaconTriggerId) qs.set("beaconTriggerId", beaconTriggerId);
    return `/api/oas/${oaId}/locations/logs/export?${qs.toString()}`;
  })();

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[
        { label: "アカウントリスト", href: "/oas" },
        { label: "現地トリガー", href: `/oas/${oaId}/locations` },
        { label: "ログ" },
      ]} />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-round text-[clamp(18px,3.5vw,22px)] font-extrabold tracking-[-0.02em] text-ink">現地トリガーログ</h1>
        <div className="flex items-center gap-3">
          {planAccess.allowed && (
            <a href={exportHref} className="text-[12px] font-semibold text-brand-ink underline" download>ログをCSVでエクスポート</a>
          )}
          <Link href={`/oas/${oaId}/locations${ambientWorkId ? `?workId=${encodeURIComponent(ambientWorkId)}` : ""}`} className="text-[12px] font-semibold text-brand-ink underline">現地トリガーへ</Link>
        </div>
      </div>

      {planLoading ? (
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>
      ) : !planAccess.allowed ? (
        <PlanRequiredCard oaId={oaId} featureKey={FEATURE.location} currentPlan={effectivePlan} featureLabel="ロケーション" />
      ) : (
        <>
          <p className="mb-3 text-[12px] leading-[1.7] text-ink-3">
            GPS / QR チェックインと Beacon 発火の実行ログを統合表示します（read 専用）。
            ※ クールダウン中の再チェックイン（GPS/QR）はログに残りません。
          </p>

          {/* フィルタ */}
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface px-3 py-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">作品
              <select className={inputCls} value={workId} onChange={(e) => setWorkId(e.target.value)}>
                <option value="">すべて</option>
                {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">種別
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">すべて</option>
                <option value="gps">GPS</option>
                <option value="qr">QR</option>
                <option value="beacon">Beacon</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">status
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">すべて</option>
                {STATUS_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">userId
              <input className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="部分一致" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">開始
              <input type="datetime-local" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">終了
              <input type="datetime-local" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <Button type="button" variant="primary" size="sm" onClick={load}>絞り込む</Button>
          </div>

          {meta?.sources && Object.values(meta.sources).some((s) => s !== "fulfilled") && (
            <div className="mb-3 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-warning">
              一部のログソースを取得できませんでした（表示が不完全な可能性があります）。
            </div>
          )}
          {error && <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>}

          {rows === null ? (
            <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-card border border-dashed border-line bg-bg px-4 py-10 text-center text-[13px] text-ink-3">該当するログがありません。</div>
          ) : (
            <>
              {meta?.truncated && (
                <p className="mb-2 text-[11px] text-ink-3">最新 {rows.length} 件を表示中（さらに絞り込むと精度が上がります）。</p>
              )}
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-bg text-left text-[11px] text-ink-3">
                      <th className="px-3 py-2 font-semibold">日時 (JST)</th>
                      <th className="px-3 py-2 font-semibold">種別</th>
                      <th className="px-3 py-2 font-semibold">地点 / Beacon</th>
                      <th className="px-3 py-2 font-semibold">作品</th>
                      <th className="px-3 py-2 font-semibold">userId</th>
                      <th className="px-3 py-2 font-semibold">outcome</th>
                      <th className="px-3 py-2 font-semibold">raw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const o = outcomeMeta(r);
                      return (
                        <tr key={r.id} className="border-t border-line align-top">
                          <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                            {fmtJst(r.ts)}
                            {r.is_test && <span className="ml-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[9px] font-bold text-warning">TEST</span>}
                          </td>
                          <td className="px-3 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeCls(r.type)}`}>{r.type}</span></td>
                          <td className="px-3 py-2 text-ink">
                            {r.point_name ?? "—"}
                            {r.message_id && <div className="text-[10px] text-ink-3">msg: {r.message_id.slice(0, 8)}</div>}
                          </td>
                          <td className="px-3 py-2 text-ink-2">{r.work_title ?? (r.work_id ? "作品" : "—")}</td>
                          <td className="px-3 py-2 font-mono text-ink-2">{tailUserId(r.line_user_id)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${kindCls(o.kind)}`}>{o.label}</span>
                            {r.error_message && <div className="mt-0.5 max-w-[200px] truncate text-[10px] text-danger" title={r.error_message}>⚠ {r.error_message}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" className="text-[11px] font-semibold text-brand-ink underline" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                              {expanded === r.id ? "閉じる" : "表示"}
                            </button>
                            {expanded === r.id && (
                              <pre className="mt-1 max-w-[420px] overflow-x-auto rounded bg-bg p-2 text-[10px] leading-[1.5] text-ink-2">{JSON.stringify(r.raw, null, 2)}</pre>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
