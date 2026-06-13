"use client";

// src/app/oas/[id]/locations/beacons/logs/page.tsx
// ビーコン発火ログ一覧。フィルタ（作品 / hwid / outcome / 日付 / userId）+ raw event 展開。

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Button } from "@/components/shared";
import { getAuthHeaders, getDevToken, workApi } from "@/lib/api-client";
import { beaconOutcomeLabel, BEACON_OUTCOME_META } from "@/lib/beacon-utils";

type LogRow = {
  id: string;
  work_id: string | null;
  work_title: string | null;
  trigger_name: string | null;
  beacon_trigger_id: string | null;
  line_user_id: string | null;
  hwid: string;
  beacon_type: string;
  device_message: string | null;
  action_status: string;
  error_message: string | null;
  message_id: string | null;
  is_test: boolean;
  is_redelivery: boolean;
  raw_event: unknown;
  created_at: string;
};

const inputCls = "rounded-field border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-brand";

function fmtJst(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}
function tailUserId(uid: string | null): string {
  if (!uid) return "—";
  return uid.length > 6 ? `…${uid.slice(-6)}` : uid;
}

export default function BeaconLogsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const sp = useSearchParams();

  const [works, setWorks] = useState<{ id: string; title: string }[]>([]);
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // filters
  const [workId, setWorkId] = useState<string>("");
  const [hwid, setHwid] = useState<string>(sp.get("hwid") ?? "");
  const [outcome, setOutcome] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    workApi.list(getDevToken(), oaId)
      .then((list) => setWorks(list.map((w) => ({ id: w.id, title: w.title }))))
      .catch(() => {});
  }, [oaId]);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const qs = new URLSearchParams();
      if (workId) qs.set("work_id", workId);
      if (hwid.trim()) qs.set("hwid", hwid.trim());
      if (outcome) qs.set("outcome", outcome);
      if (userId.trim()) qs.set("user_id", userId.trim());
      if (from) qs.set("from", new Date(from).toISOString());
      if (to) qs.set("to", new Date(to).toISOString());
      const res = await fetch(`/api/oas/${oaId}/beacons/logs?${qs.toString()}`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const json = await res.json();
      if (!json?.success) { setError(json?.error ?? "読み込みに失敗しました"); return; }
      setRows(json.data as LogRow[]);
    } catch {
      setError("通信エラーが発生しました");
    }
  }, [oaId, workId, hwid, outcome, userId, from, to]);

  useEffect(() => { load(); /* 初回 + フィルタ確定時は手動 */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oaId]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "ビーコン", href: `/oas/${oaId}/locations/beacons` },
          { label: "ログ" },
        ]}
      />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-round text-[clamp(18px,3.5vw,22px)] font-extrabold tracking-[-0.02em] text-ink">ビーコン発火ログ</h1>
        <div className="flex items-center gap-3">
          <Link href={`/oas/${oaId}/locations/logs?type=beacon`} className="text-[12px] font-semibold text-brand-ink underline">統合ログを見る</Link>
          <Link href={`/oas/${oaId}/locations/beacons`} className="text-[12px] font-semibold text-brand-ink underline">一覧へ戻る</Link>
        </div>
      </div>

      {/* フィルタ */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface px-3 py-3">
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">作品
          <select className={inputCls} value={workId} onChange={(e) => setWorkId(e.target.value)}>
            <option value="">すべて</option>
            <option value="common">OA 共通</option>
            {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">hwid
          <input className={`${inputCls} font-mono`} value={hwid} onChange={(e) => setHwid(e.target.value)} placeholder="部分一致" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">outcome
          <select className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">すべて</option>
            {Object.entries(BEACON_OUTCOME_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
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

      {error && <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>}

      {rows === null ? (
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-bg px-4 py-10 text-center text-[13px] text-ink-3">該当するログがありません。</div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-bg text-left text-[11px] text-ink-3">
                <th className="px-3 py-2 font-semibold">日時 (JST)</th>
                <th className="px-3 py-2 font-semibold">ビーコン</th>
                <th className="px-3 py-2 font-semibold">作品</th>
                <th className="px-3 py-2 font-semibold">type</th>
                <th className="px-3 py-2 font-semibold">userId</th>
                <th className="px-3 py-2 font-semibold">outcome</th>
                <th className="px-3 py-2 font-semibold">raw</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const o = beaconOutcomeLabel(r.action_status);
                const badgeCls = o.kind === "sent" ? "bg-brand-soft text-brand-ink" : o.kind === "failed" ? "bg-danger-soft text-danger" : o.kind === "matched" ? "bg-brand-mist text-brand-ink" : "bg-line/60 text-ink-2";
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                      {fmtJst(r.created_at)}
                      {r.is_test && <span className="ml-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[9px] font-bold text-warning">TEST</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{r.trigger_name ?? "—"}</div>
                      <div className="font-mono text-[10px] text-ink-3">{r.hwid}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{r.work_id ? (r.work_title ?? "作品") : "OA 共通"}</td>
                    <td className="px-3 py-2 text-ink-2">{r.beacon_type}</td>
                    <td className="px-3 py-2 font-mono text-ink-2">{tailUserId(r.line_user_id)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>{o.label}</span>
                      {r.error_message && <div className="mt-0.5 max-w-[200px] truncate text-[10px] text-danger" title={r.error_message}>⚠ {r.error_message}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-[11px] font-semibold text-brand-ink underline" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? "閉じる" : "表示"}
                      </button>
                      {expanded === r.id && (
                        <pre className="mt-1 max-w-[420px] overflow-x-auto rounded bg-bg p-2 text-[10px] leading-[1.5] text-ink-2">{JSON.stringify(r.raw_event, null, 2)}</pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
