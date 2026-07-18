"use client";

// エラーログのフィルタ（状態・アカウント・種別・期間）。URL クエリと同期し、変更時は page=1 へ戻す。

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { OwnerErrorLogFilters } from "@/lib/owner-error-log/types";

const SELECT_CLS =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

export function ErrorLogFilters({
  filters,
  accounts,
}: {
  filters: OwnerErrorLogFilters;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();

  const apply = useCallback(
    (patch: Partial<Record<"status" | "oa" | "type" | "period", string>>) => {
      const p = new URLSearchParams();
      const status = patch.status ?? filters.status;
      const oa = "oa" in patch ? patch.oa : (filters.oaId ?? "");
      const type = patch.type ?? filters.type;
      const period = patch.period ?? filters.period;
      if (status !== "unresolved") p.set("status", status);
      if (oa) p.set("oa", oa);
      if (type !== "all") p.set("type", type);
      if (period !== "7d") p.set("period", period);
      // フィルタ変更時は必ず 1 ページ目へ戻す（page は付与しない）。
      const qs = p.toString();
      router.replace(qs ? `/admin/error-log?${qs}` : "/admin/error-log", { scroll: false });
    },
    [filters, router],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-sm">
      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        状態
        <select className={SELECT_CLS} value={filters.status} onChange={(e) => apply({ status: e.target.value })} aria-label="状態で絞り込み">
          <option value="unresolved">未解決</option>
          <option value="resolved">解決済み</option>
          <option value="all">すべて</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        アカウント
        <select className={SELECT_CLS} value={filters.oaId ?? ""} onChange={(e) => apply({ oa: e.target.value })} aria-label="アカウントで絞り込み">
          <option value="">すべて</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        種別
        <select className={SELECT_CLS} value={filters.type} onChange={(e) => apply({ type: e.target.value })} aria-label="種別で絞り込み">
          <option value="all">すべて</option>
          <option value="beacon">Beacon</option>
          <option value="checkin">現地</option>
          <option value="message">メッセージ</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        期間
        <select className={SELECT_CLS} value={filters.period} onChange={(e) => apply({ period: e.target.value })} aria-label="期間で絞り込み">
          <option value="7d">直近7日</option>
          <option value="30d">直近30日</option>
          <option value="month">今月</option>
          <option value="all">全期間</option>
        </select>
      </label>
    </div>
  );
}
