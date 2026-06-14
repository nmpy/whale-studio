"use client";

// src/app/oas/[id]/locations/_checkpoint-list.tsx
// 統合チェックインポイント一覧（GPS/QR を同一 Location の checkinMode で扱う）。
// 作品横断で集約表示。mode / workId フィルタ・有効無効トグル・編集/分析・QR印刷導線。
//
// PR1: 編集 / 分析 / 印刷は既存の作品スコープ画面へリンク（壊さない）。
// 有効無効トグルは既存 PATCH /api/locations/[id]（is_active）を呼ぶ（既存 API を変更しない）。

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthHeaders, fetchOaLiffId } from "@/lib/api-client";
import { buildLiffCheckinUrl } from "@/lib/liff/config";
import { buttonClass } from "@/components/shared";
import { requiresGps, includesQr } from "@/lib/checkin-mode";

type Checkpoint = {
  id: string;
  work_id: string;
  work_title: string | null;
  name: string;
  checkin_mode: string;
  is_active: boolean;
  cooldown_seconds: number;
  visit_count: number;
};

type ModeFilter = "all" | "gps" | "qr" | "both";

/** checkinMode → 表示バッジ */
function modeBadge(mode: string): { label: string; cls: string } {
  if (mode === "qr_and_gps") return { label: "GPS + QR", cls: "bg-brand-soft text-brand-ink" };
  if (mode === "gps_only")   return { label: "GPS",      cls: "bg-[#dcfce7] text-[#166534]" };
  if (mode === "qr_only")    return { label: "QR",       cls: "bg-[#ede9fe] text-[#6d28d9]" };
  return { label: mode, cls: "bg-line/60 text-ink-2" };
}

export function CheckpointList({
  oaId,
  workIdFilter,
  readOnly,
}: {
  oaId: string;
  workIdFilter: string | null;
  readOnly: boolean;
}) {
  const [rows, setRows] = useState<Checkpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeFilter>("all");
  // チェックインURLコピー用。liffId は URL 生成専用に OA.liffId を取得（未設定なら null＝コピー不可表示）。
  const [liffId, setLiffId] = useState<string | null | undefined>(undefined);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => { fetchOaLiffId(oaId).then(setLiffId).catch(() => setLiffId(null)); }, [oaId]);

  async function copyCheckinUrl(c: Checkpoint) {
    const url = buildLiffCheckinUrl({ liffId, workId: c.work_id, locationId: c.id });
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(c.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === c.id ? null : prev)), 1800);
    } catch { /* コピー失敗時も画面は壊さない */ }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/oas/${oaId}/locations`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const json = await res.json();
      if (!json?.success) { setError(json?.error ?? "読み込みに失敗しました"); return; }
      setRows(json.data as Checkpoint[]);
    } catch {
      setError("通信エラーが発生しました");
    }
  }, [oaId]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(c: Checkpoint) {
    setTogglingId(c.id);
    try {
      const res = await fetch(`/api/locations/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (res.ok) setRows((prev) => prev?.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)) ?? null);
    } finally {
      setTogglingId(null);
    }
  }

  const visible = useMemo(() => {
    if (!rows) return null;
    return rows.filter((r) => {
      if (workIdFilter && r.work_id !== workIdFilter) return false;
      if (mode === "gps") return requiresGps(r.checkin_mode);
      if (mode === "qr") return includesQr(r.checkin_mode);
      if (mode === "both") return r.checkin_mode === "qr_and_gps";
      return true;
    });
  }, [rows, workIdFilter, mode]);

  if (error) return <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>;
  if (visible === null) return <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">読み込み中…</div>;

  return (
    <div>
      {/* フィルタ */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {([["all", "すべて"], ["gps", "GPSあり"], ["qr", "QRあり"], ["both", "GPS + QR"]] as [ModeFilter, string][]).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${mode === k ? "bg-brand text-white" : "bg-bg text-ink-2 hover:bg-line/60"}`}
          >
            {label}
          </button>
        ))}
        {workIdFilter && (
          <Link href={`/oas/${oaId}/locations`} className="ml-auto rounded-full bg-brand-mist px-3 py-1 text-[12px] font-semibold text-brand-ink">
            作品フィルタ解除 ✕
          </Link>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-bg px-4 py-10 text-center">
          <div className="mb-2 text-[28px]">📍</div>
          <p className="text-[13px] text-ink-3">該当するチェックインポイントがありません。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((c) => {
            const badge = modeBadge(c.checkin_mode);
            return (
              <div key={c.id} className="rounded-card border border-line bg-surface px-4 py-3.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-ink">{c.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      <span className="rounded-full bg-line/60 px-2 py-0.5 text-[10px] font-semibold text-ink-3">{c.work_title ?? "作品"}</span>
                      {!c.is_active && <span className="rounded-full bg-line/70 px-2 py-0.5 text-[10px] font-semibold text-ink-3">無効</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-3">
                      <span>チェックイン {c.visit_count} 件</span>
                      {c.cooldown_seconds > 0 && <span>· CD {Math.round(c.cooldown_seconds / 60)}分</span>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => toggleActive(c)}
                        disabled={togglingId === c.id}
                        className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${c.is_active ? "bg-brand-soft text-brand-ink hover:bg-brand/15" : "bg-line/60 text-ink-3 hover:bg-line"}`}
                      >
                        {c.is_active ? "有効" : "無効"}
                      </button>
                    )}
                    {liffId === null ? (
                      <span className="rounded-full bg-line/40 px-3 py-1 text-[11px] font-semibold text-ink-3" title="OA の LIFF ID が未設定のため、チェックインURLを生成できません">LIFF ID未設定</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => copyCheckinUrl(c)}
                        disabled={liffId === undefined}
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                        title="現地のチェックインURL（QR/GPS共通）をコピーします"
                      >
                        {copiedId === c.id ? "コピーしました" : "URLをコピー"}
                      </button>
                    )}
                    {includesQr(c.checkin_mode) && (
                      <Link href={`/oas/${oaId}/locations/print?workId=${c.work_id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>QR印刷</Link>
                    )}
                    <Link href={`/oas/${oaId}/locations/${c.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                      {readOnly ? "分析" : "編集 / 分析"}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
