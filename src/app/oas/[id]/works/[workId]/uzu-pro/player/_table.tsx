"use client";

// for ウズプロ ＞ プレイヤー一覧テーブル（予約単位でグルーピング + 行ごとの操作）。
//   - View Model のみ受け取り、生 DB モデル・個人情報は扱わない。
//   - 予約ヘッダ行はクリックで開閉。プレイヤー行の kebab から 生成 / URLコピー / 失効して再発行。
//   - 平文 LIFF URL は「生成 / 再発行」レスポンスで一度だけ返るため、コピー用にその場限りで保持する。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format-datetime";
import { ACTIVITY_TONE_CLASS, type ActivityTone } from "@/lib/activity-feed";
import type {
  UzuProBookingGroup,
  UzuProLiffState,
  UzuProPlayerRow,
} from "@/lib/uzupro/player-view";

const LIFF_META: Record<UzuProLiffState, { label: string; tone: ActivityTone }> = {
  linked: { label: "LINE連携済み", tone: "green" },
  issued: { label: "発行済み", tone: "blue" },
  revoked: { label: "失効", tone: "gray" },
  error: { label: "エラー", tone: "red" },
  unissued: { label: "未発行", tone: "amber" },
};

const BOOKING_META: Record<string, { label: string; tone: ActivityTone }> = {
  confirmed: { label: "確定", tone: "green" },
  attended: { label: "参加済み", tone: "blue" },
  waitlist: { label: "キャンセル待ち", tone: "amber" },
  cancelled: { label: "キャンセル", tone: "gray" },
};

function Chip({ tone, children }: { tone: ActivityTone; children: React.ReactNode }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold " + ACTIVITY_TONE_CLASS[tone]}>
      {children}
    </span>
  );
}

function bookingChip(status: string) {
  const m = BOOKING_META[status] ?? { label: status, tone: "gray" as ActivityTone };
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

/** URL をクリップボードへ（navigator.clipboard + execCommand フォールバック）。 */
async function copyUrlToClipboard(url: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // フォールバックに進む
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export function UzuProPlayerTable({
  oaId,
  workId,
  bookings,
}: {
  oaId: string;
  workId: string;
  bookings: UzuProBookingGroup[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // 生成 / 再発行で一度だけ返る平文 URL をコピー用に保持（DB には保存されない）。
  const [urls, setUrls] = useState<Record<string, string>>({});

  const base = `/api/oas/${oaId}/works/${workId}/uzu-pro/players`;

  async function issue(kind: "liff" | "reissue", p: UzuProPlayerRow) {
    if (pending[p.id]) return;
    if (kind === "reissue" && !window.confirm("現在のLIFF URLを失効し、新しいURLを再発行します。旧URLは開けなくなります。よろしいですか？")) {
      return;
    }
    setOpenMenu(null);
    setPending((s) => ({ ...s, [p.id]: true }));
    try {
      const path = kind === "liff" ? `${base}/${p.id}/liff` : `${base}/${p.id}/liff/reissue`;
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const code = json?.error?.code;
        if (code === "CONFLICT") showToast("キャンセル済みのプレイヤーには発行できません", "error");
        else if (code === "LIFF_NOT_CONFIGURED") showToast("このアカウントのLIFFが未設定です", "error");
        else showToast("操作に失敗しました。時間をおいて再度お試しください。", "error");
        return;
      }
      const data = json.data ?? {};
      if (data.status === "issued") {
        if (data.url) setUrls((u) => ({ ...u, [p.id]: data.url }));
        showToast(kind === "liff" ? "LIFFを生成しました" : "失効して再発行しました", "success");
      } else if (data.status === "already_issued") {
        showToast("すでに発行済みです", "info");
      } else {
        showToast("完了しました", "success");
      }
      router.refresh();
    } catch {
      showToast("操作に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setPending((s) => ({ ...s, [p.id]: false }));
    }
  }

  async function copy(p: UzuProPlayerRow) {
    setOpenMenu(null);
    const url = urls[p.id];
    if (!url) {
      showToast("先に「生成」してURLを取得してください", "info");
      return;
    }
    const okCopy = await copyUrlToClipboard(url);
    showToast(okCopy ? "URLをコピーしました" : "コピーに失敗しました", okCopy ? "success" : "error");
  }

  if (bookings.length === 0) {
    return (
      <section className="rounded-[14px] border border-line bg-surface px-5 py-10 text-center shadow-sm">
        <p className="text-[13px] text-ink-3">条件に一致するプレイヤーはいません</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              <th scope="col" className="px-4 py-2.5 font-semibold">プレイヤーID</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">予約ID</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">公演回</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">公演日時</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">番号</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">LIFF</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">LINE連携</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">予約ステータス</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">最終同期</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const isCollapsed = !!collapsed[b.externalBookingId];
              return (
                <BookingRows
                  key={b.externalBookingId}
                  booking={b}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((c) => ({ ...c, [b.externalBookingId]: !c[b.externalBookingId] }))
                  }
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  pending={pending}
                  issue={issue}
                  copy={copy}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BookingRows({
  booking,
  collapsed,
  onToggle,
  openMenu,
  setOpenMenu,
  pending,
  issue,
  copy,
}: {
  booking: UzuProBookingGroup;
  collapsed: boolean;
  onToggle: () => void;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  pending: Record<string, boolean>;
  issue: (kind: "liff" | "reissue", p: UzuProPlayerRow) => void;
  copy: (p: UzuProPlayerRow) => void;
}) {
  return (
    <>
      {/* 予約ヘッダ行（クリックで開閉）。 */}
      <tr className="border-t border-line-2 bg-bg-tint/60">
        <td colSpan={10} className="px-4 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className={"text-ink-3 transition-transform " + (collapsed ? "-rotate-90" : "rotate-0")} aria-hidden="true">▾</span>
            <span className="font-num font-bold text-ink-2">{booking.externalBookingId}</span>
            <span className="text-ink-3">・{booking.participantCount}名</span>
            {booking.sessionTitle && <span className="text-ink-3">・{booking.sessionTitle}</span>}
            <span className="font-num text-ink-3">・{formatDateTime(booking.startsAt)}</span>
            <span className="ml-1">{bookingChip(booking.bookingStatus)}</span>
          </button>
        </td>
      </tr>

      {/* プレイヤー行。 */}
      {!collapsed &&
        booking.players.map((p) => {
          const liff = LIFF_META[p.liffStatus];
          const busy = !!pending[p.id];
          const menuOpen = openMenu === p.id;
          const muted = p.playerStatus === "cancelled";
          return (
            <tr key={p.id} className={"border-t border-[#f5f7f4] hover:bg-[#fafcfa] " + (muted ? "opacity-55" : "")}>
              <td className="whitespace-nowrap px-4 py-3 font-num text-ink-2">{p.id.slice(0, 8)}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{booking.externalBookingId}</td>
              <td className="px-2 py-3 text-ink-3">{booking.sessionTitle ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{formatDateTime(booking.startsAt)}</td>
              <td className="px-2 py-3 text-right font-num text-ink-2">{p.playerIndex}</td>
              <td className="px-2 py-3"><Chip tone={liff.tone}>{liff.label}</Chip></td>
              <td className="px-2 py-3">
                {p.lineLinked ? <Chip tone="green">連携済み</Chip> : <span className="text-[11px] text-ink-3">未連携</span>}
              </td>
              <td className="px-2 py-3">{bookingChip(p.bookingStatus)}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{formatDateTime(p.lastSyncedAt)}</td>
              <td className="relative px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => setOpenMenu(menuOpen ? null : p.id)}
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`プレイヤー ${p.id.slice(0, 8)} の操作`}
                  className="rounded-full px-2 py-1 text-[14px] font-bold leading-none text-ink-2 hover:bg-line-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "…" : "⋯"}
                </button>
                {menuOpen && (
                  <>
                    {/* 外側クリックで閉じる透明バックドロップ。 */}
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setOpenMenu(null)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-4 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 text-left shadow-lg"
                    >
                      <button type="button" role="menuitem" onClick={() => issue("liff", p)} className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-brand-mist">生成</button>
                      <button type="button" role="menuitem" onClick={() => copy(p)} className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-brand-mist">URLをコピー</button>
                      <button type="button" role="menuitem" onClick={() => issue("reissue", p)} className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-danger hover:bg-danger-soft">失効して再発行</button>
                    </div>
                  </>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}
