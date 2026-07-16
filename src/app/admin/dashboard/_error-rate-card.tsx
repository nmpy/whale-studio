"use client";

// エラー/失敗率カード（クリックで詳細パネルを開閉）。button + aria-expanded でアクセシブルに。
import { useState } from "react";
import Link from "next/link";
import { accountColor } from "@/lib/owner-dashboard/account-color";
import type { OwnerDashboardData } from "@/lib/owner-dashboard/aggregate";

export function ErrorRateCard({
  summary, errorBreakdown, periodLabel,
}: {
  summary: OwnerDashboardData["summary"];
  errorBreakdown: OwnerDashboardData["errorBreakdown"];
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = "owner-error-detail";

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col items-start rounded-[14px] border bg-surface px-4 py-4 text-left shadow-sm transition-shadow hover:shadow-card"
        style={{ borderColor: "#f2dcd9" }}
      >
        <span className="text-[11px] font-bold text-ink-3">エラー / 失敗率</span>
        <span className="mt-1 flex items-baseline gap-1">
          <span className="font-num text-[24px] font-bold" style={{ color: "#c2564d" }}>{summary.failureRatePct}</span>
          <span className="text-[12px] text-ink-3">%</span>
          <span aria-hidden="true" className="ml-1 text-[12px]" style={{ color: "#c2564d" }}>{open ? "▲" : "▼"}</span>
        </span>
        <span className="mt-1 text-[11px]" style={{ color: "#a8433b" }}>クリックで詳細 · 失敗 {summary.failCount}/{summary.procCount}</span>
      </button>

      {open && (
        <div id={panelId} className="col-span-full rounded-[14px] border px-5 py-4" style={{ background: "#fffafa", borderColor: "#f2dcd9" }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold" style={{ color: "#a8433b" }}>エラー / 失敗の内訳</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "#fdeeed", color: "#c2564d" }}>{periodLabel} · 全{errorBreakdown.total}件</span>
            </div>
            <Link href="/admin/error-log" className="text-[12px] font-semibold hover:underline" style={{ color: "#c2564d" }}>エラーログを見る ›</Link>
          </div>
          {errorBreakdown.rows.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-3">対象期間にエラー / 失敗はありません</p>
          ) : (
            <div className="flex flex-col gap-2">
              {errorBreakdown.rows.map((r, i) => {
                const c = accountColor(r.oaId);
                return (
                  <div key={`${r.oaId}-${r.cause}-${i}`} className="flex items-center gap-3">
                    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: c.bg, color: c.text }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
                      <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">{r.accountName}</span>
                    </span>
                    <span className="w-[110px] flex-shrink-0 text-[12px] text-ink-2">{r.cause}</span>
                    <span className="w-[52px] flex-shrink-0 text-right font-num text-[12px] font-bold text-ink">{r.count}件</span>
                    <span className="w-[44px] flex-shrink-0 text-right font-num text-[11px] text-ink-3">{r.pct}%</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "#f3e4e2" }}>
                      <span className="block h-full rounded-full" style={{ width: `${r.pct}%`, background: "#d47066" }} />
                    </span>
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
