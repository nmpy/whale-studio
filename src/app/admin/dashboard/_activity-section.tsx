// src/app/admin/dashboard/_activity-section.tsx
// 全アカウント横断アクティビティ（直近8件）。Server Component（インタラクションなし）。
// View Model（OwnerActivityItem）のみ受け取り、内部 DB モデルは扱わない。

import Link from "next/link";
import { ACTIVITY_META, ACTIVITY_TONE_CLASS } from "@/lib/activity-feed";
import { accountColor } from "@/lib/owner-dashboard/account-color";
import type { OwnerActivityItem } from "@/lib/owner-dashboard/activity";

/** ISO(UTC) → JST。当日は HH:mm、前日以前は M/D HH:mm。 */
function fmtTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  const nowJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hh = g("hour") === "24" ? "00" : g("hour");
  const sameDay = nowJst === `${g("year")}-${g("month")}-${g("day")}`;
  return sameDay ? `${hh}:${g("minute")}` : `${Number(g("month"))}/${Number(g("day"))} ${hh}:${g("minute")}`;
}

export function ActivitySection({ items }: { items: OwnerActivityItem[] }) {
  const now = new Date();
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3.5">
        <h2 className="text-[13px] font-bold text-ink">全アカウント横断アクティビティ</h2>
        <span className="rounded-full border border-line bg-bg-tint px-2 py-0.5 text-[11px] text-ink-3">直近8件</span>
      </div>

      {items.length === 0 ? (
        <p className="px-5 pb-6 text-center text-[13px] text-ink-3">まだ表示できるアクティビティはありません</p>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-t border-line text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              <th className="px-5 py-2 font-semibold">時刻</th>
              <th className="px-2 py-2 font-semibold">アカウント</th>
              <th className="px-2 py-2 font-semibold">プレイヤー</th>
              <th className="px-2 py-2 font-semibold">種別</th>
              <th className="px-5 py-2 font-semibold">内容</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const c = accountColor(a.oaId);
              const meta = ACTIVITY_META[a.type];
              return (
                <tr key={a.id} className="border-t border-[#f5f7f4] hover:bg-[#fafcfa]">
                  <td className="px-5 py-2.5 font-num text-ink-3 whitespace-nowrap">{fmtTime(a.occurredAt, now)}</td>
                  <td className="px-2 py-2.5">
                    <Link href={`/oas/${a.oaId}/works`} className="inline-flex max-w-[150px] items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold hover:underline" style={{ background: c.bg, color: c.text }}>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: c.dot }} />
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{a.accountName}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-2.5"><span className="block max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-ink-2">{a.player}</span></td>
                  <td className="px-2 py-2.5">
                    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold " + ACTIVITY_TONE_CLASS[meta.tone]}>{meta.label}</span>
                  </td>
                  <td className="px-5 py-2.5"><span className="block max-w-[640px] overflow-hidden text-ellipsis whitespace-nowrap text-ink-2">{a.title}{a.detail ? ` · ${a.detail}` : ""}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
