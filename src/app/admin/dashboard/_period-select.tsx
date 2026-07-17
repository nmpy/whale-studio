"use client";

// 期間セレクト（?period= を更新。Server Component 側が再集計する）。
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { DashboardPeriod } from "@/lib/owner-dashboard/aggregate";

const OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "7d", label: "直近7日間" },
  { value: "30d", label: "直近30日間" },
  { value: "month", label: "今月" },
];

export function PeriodSelect({ period }: { period: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/admin/dashboard";
  const searchParams = useSearchParams();

  function change(next: DashboardPeriod) {
    const q = new URLSearchParams(searchParams.toString());
    if (next === "7d") q.delete("period"); else q.set("period", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div role="group" aria-label="集計期間" className="inline-flex rounded-full border border-line bg-surface p-1">
      {OPTIONS.map((o) => {
        const active = period === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => change(o.value)}
            className={"rounded-full px-3 py-1 text-[12px] font-bold transition-colors " + (active ? "bg-brand text-white" : "text-ink-3 hover:text-ink-2")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
