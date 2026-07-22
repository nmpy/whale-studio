"use client";

// for ウズプロ ＞ プレイヤーのフィルタ（予約ID / 公演回 / LIFF状態 / 予約状態 / LINE連携状態）。
// URL クエリ（booking / session / liff / bstatus / line）と同期する。個人情報はフィルタ対象にしない。

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { UzuProPlayerViewFilters } from "@/lib/uzupro/player-view";

const SELECT_CLS =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";
const INPUT_CLS =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 placeholder:font-normal placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

const LIFF_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "linked", label: "LINE連携済み" },
  { value: "issued", label: "発行済み" },
  { value: "revoked", label: "失効" },
  { value: "error", label: "エラー" },
  { value: "unissued", label: "未発行" },
];

const BOOKING_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "confirmed", label: "確定" },
  { value: "waitlist", label: "キャンセル待ち" },
  { value: "cancelled", label: "キャンセル" },
  { value: "attended", label: "参加済み" },
];

const LINE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "linked", label: "連携済み" },
  { value: "unlinked", label: "未連携" },
];

type PatchKey = "booking" | "session" | "liff" | "bstatus" | "line";

export function UzuProPlayerFilters({
  oaId,
  workId,
  filters,
  sessions,
}: {
  oaId: string;
  workId: string;
  filters: UzuProPlayerViewFilters;
  sessions: { id: string; title: string | null }[];
}) {
  const router = useRouter();
  const base = `/oas/${oaId}/works/${workId}/uzu-pro/player`;
  const [bookingText, setBookingText] = useState(filters.bookingId ?? "");

  const current = useCallback(
    (): Record<PatchKey, string> => ({
      booking: filters.bookingId ?? "",
      session: filters.session ?? "",
      liff: filters.liffStatus ?? "",
      bstatus: filters.bookingStatus ?? "",
      line: filters.lineLinked === true ? "linked" : filters.lineLinked === false ? "unlinked" : "",
    }),
    [filters],
  );

  const apply = useCallback(
    (patch: Partial<Record<PatchKey, string>>) => {
      const next = { ...current(), ...patch };
      const p = new URLSearchParams();
      (Object.keys(next) as PatchKey[]).forEach((k) => {
        if (next[k]) p.set(k, next[k]);
      });
      const qs = p.toString();
      router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
    },
    [base, current, router],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-sm">
      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        予約ID検索
        <input
          type="text"
          value={bookingText}
          onChange={(e) => setBookingText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ booking: bookingText.trim() });
          }}
          onBlur={() => {
            if ((bookingText.trim() || "") !== (filters.bookingId ?? "")) apply({ booking: bookingText.trim() });
          }}
          placeholder="UZ… を含む"
          className={INPUT_CLS}
          aria-label="予約IDで絞り込み"
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        公演回
        <select
          className={SELECT_CLS}
          value={filters.session ?? ""}
          onChange={(e) => apply({ session: e.target.value })}
          aria-label="公演回で絞り込み"
        >
          <option value="">すべて</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.title ?? s.id}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        LIFF状態
        <select
          className={SELECT_CLS}
          value={filters.liffStatus ?? ""}
          onChange={(e) => apply({ liff: e.target.value })}
          aria-label="LIFF状態で絞り込み"
        >
          {LIFF_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        予約状態
        <select
          className={SELECT_CLS}
          value={filters.bookingStatus ?? ""}
          onChange={(e) => apply({ bstatus: e.target.value })}
          aria-label="予約状態で絞り込み"
        >
          {BOOKING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        LINE連携状態
        <select
          className={SELECT_CLS}
          value={filters.lineLinked === true ? "linked" : filters.lineLinked === false ? "unlinked" : ""}
          onChange={(e) => apply({ line: e.target.value })}
          aria-label="LINE連携状態で絞り込み"
        >
          {LINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
