"use client";

// for ウズプロ ＞ チケット連携のフィルタ（状態 / 予約番号 / コードネーム / チケット種別）。
// URL クエリ（status / rn / cn / tt / page）と同期する。
// 予約番号は業務上の照合キーとして検索できるが、**URL には検索語しか載せない**
// （行の予約番号を query に埋め込む導線は作らない）。
// 既存 uzu-pro/player の _filters.tsx と同じ操作感・同じ class を使う。

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
// prisma を読み込まない純粋モジュールから import する
// （view 側から取ると Prisma が client bundle に入り build が落ちる）。
import {
  TICKET_LINK_STATUSES,
  TICKET_LINK_STATUS_LABEL,
  type TicketLinkAdminFilters,
} from "@/lib/uzupro/ticket-link-status";
import type { TicketLinkStatus } from "@prisma/client";

const SELECT_CLS =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";
const INPUT_CLS =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 placeholder:font-normal placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

type PatchKey = "status" | "rn" | "cn" | "tt" | "page";

export function TicketLinkFilters({
  oaId,
  workId,
  filters,
  statusCounts,
}: {
  oaId: string;
  workId: string;
  filters: TicketLinkAdminFilters;
  statusCounts: Record<TicketLinkStatus, number>;
}) {
  const router = useRouter();
  const base = `/oas/${oaId}/works/${workId}/uzu-pro/ticket-links`;

  const [rnText, setRnText] = useState(filters.reservationNumber ?? "");
  const [cnText, setCnText] = useState(filters.codeName ?? "");
  const [ttText, setTtText] = useState(filters.ticketType ?? "");

  const current = useCallback(
    (): Record<PatchKey, string> => ({
      status: filters.status ?? "",
      rn: filters.reservationNumber ?? "",
      cn: filters.codeName ?? "",
      tt: filters.ticketType ?? "",
      page: "", // 条件を変えたら 1 ページ目へ戻す
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
      // replace: 戻る操作でフィルタ履歴が積み上がらないようにする（既存 player 画面と同じ）。
      router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
    },
    [base, current, router],
  );

  const total = TICKET_LINK_STATUSES.reduce((n, s) => n + (statusCounts[s] ?? 0), 0);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-sm">
      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        状態
        <select
          className={SELECT_CLS}
          value={filters.status ?? ""}
          onChange={(e) => apply({ status: e.target.value })}
          aria-label="連携状態で絞り込み"
        >
          <option value="">すべて（{total}）</option>
          {TICKET_LINK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_LINK_STATUS_LABEL[s]}（{statusCounts[s] ?? 0}）
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        予約番号
        <input
          type="text"
          value={rnText}
          onChange={(e) => setRnText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply({ rn: rnText.trim() }); }}
          onBlur={() => { if (rnText.trim() !== (filters.reservationNumber ?? "")) apply({ rn: rnText.trim() }); }}
          placeholder="123-456 / 123456"
          className={INPUT_CLS}
          aria-label="予約番号で絞り込み"
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        コードネーム
        <input
          type="text"
          value={cnText}
          onChange={(e) => setCnText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply({ cn: cnText.trim() }); }}
          onBlur={() => { if (cnText.trim() !== (filters.codeName ?? "")) apply({ cn: cnText.trim() }); }}
          placeholder="部分一致"
          className={INPUT_CLS}
          aria-label="コードネームで絞り込み"
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-3">
        チケット種別
        <input
          type="text"
          value={ttText}
          onChange={(e) => setTtText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply({ tt: ttText.trim() }); }}
          onBlur={() => { if (ttText.trim() !== (filters.ticketType ?? "")) apply({ tt: ttText.trim() }); }}
          placeholder="部分一致"
          className={INPUT_CLS}
          aria-label="チケット種別で絞り込み"
        />
      </label>

      {(filters.status || filters.reservationNumber || filters.codeName || filters.ticketType) && (
        <button
          type="button"
          onClick={() => { setRnText(""); setCnText(""); setTtText(""); router.replace(base, { scroll: false }); }}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink-3 hover:text-ink-2"
        >
          条件をクリア
        </button>
      )}
    </div>
  );
}
