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
import { liffPrimaryAction } from "@/lib/uzupro/liff-actions";

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
  canManage,
}: {
  oaId: string;
  workId: string;
  bookings: UzuProBookingGroup[];
  /** LIFF 管理者のみ 発行/再発行/手動登録/手動解除 が可能（UI 非表示 + API でも強制）。 */
  canManage: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // 発行 / 再発行で一度だけ返る平文 URL をコピー用に保持（DB には保存されない）。
  const [urls, setUrls] = useState<Record<string, string>>({});
  // URL 表示モーダル（発行/再発行の直後に可視表示 + コピー導線）。
  const [revealUrl, setRevealUrl] = useState<{ playerId: string; url: string } | null>(null);
  // 手動登録 / 手動解除モーダル（LIFF 管理者のみ）。
  const [manualLink, setManualLink] = useState<UzuProPlayerRow | null>(null);
  const [manualUnlink, setManualUnlink] = useState<UzuProPlayerRow | null>(null);

  const base = `/api/oas/${oaId}/works/${workId}/uzu-pro/players`;

  function openManualLink(p: UzuProPlayerRow) {
    setOpenMenu(null);
    setManualLink(p);
  }
  function openManualUnlink(p: UzuProPlayerRow) {
    setOpenMenu(null);
    setManualUnlink(p);
  }
  function onManualDone() {
    setManualLink(null);
    setManualUnlink(null);
    router.refresh();
  }

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
      if (data.status === "issued" && typeof data.url === "string") {
        // 平文 URL は今回のみ取得可能。キャッシュしてモーダルで可視表示（コピー導線）。
        setUrls((u) => ({ ...u, [p.id]: data.url }));
        setRevealUrl({ playerId: p.id, url: data.url });
        showToast(kind === "liff" ? "LIFF URLを発行しました" : "URLを再発行しました（旧URLは失効）", "success");
      } else if (data.status === "already_issued") {
        // 既存の有効リンクの平文は保存していないため再取得不可 → 再発行で新 URL を得る。
        showToast("すでに有効なURLがあります。URLを取得するには「URLを再発行」してください。", "info");
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

  function copy(p: UzuProPlayerRow) {
    setOpenMenu(null);
    const url = urls[p.id];
    if (!url) {
      showToast("URLを表示するには「発行」または「再発行」してください。", "info");
      return;
    }
    // モーダルで可視表示（中のコピーボタンでクリップボードへ）。
    setRevealUrl({ playerId: p.id, url });
  }

  if (bookings.length === 0) {
    return (
      <section className="rounded-[14px] border border-line bg-surface px-5 py-10 text-center shadow-sm">
        <p className="text-[13px] text-ink-3">条件に一致するプレイヤーはいません</p>
      </section>
    );
  }

  return (
    <>
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
                  cachedUrl={urls}
                  issue={issue}
                  copy={copy}
                  canManage={canManage}
                  onManualLink={openManualLink}
                  onManualUnlink={openManualUnlink}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

    {revealUrl && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        role="dialog"
        aria-modal="true"
        aria-label="LIFF URL"
      >
        <div className="w-full max-w-lg rounded-[16px] border border-line bg-surface p-5 shadow-xl">
          <h3 className="text-[15px] font-bold text-ink">LIFF URL</h3>
          <p className="mt-1 text-[12px] text-ink-3">
            このURLは一度だけ表示されます。コピーして予約者へご案内ください（再表示するには「URLを再発行」が必要です）。
          </p>
          <input
            readOnly
            value={revealUrl.url}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 w-full rounded-[10px] border border-line bg-bg-tint px-3 py-2 font-num text-[12px] text-ink-2"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRevealUrl(null)}
              className="rounded-[10px] border border-line px-3 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-line-2"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={async () => {
                const okCopy = await copyUrlToClipboard(revealUrl.url);
                showToast(okCopy ? "URLをコピーしました" : "コピーに失敗しました", okCopy ? "success" : "error");
              }}
              className="rounded-[10px] border border-brand-ink/20 bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand-ink hover:opacity-90"
            >
              コピー
            </button>
          </div>
        </div>
      </div>
    )}

    {manualLink && (
      <ManualLinkModal oaId={oaId} workId={workId} player={manualLink} onClose={() => setManualLink(null)} onDone={onManualDone} />
    )}
    {manualUnlink && (
      <ManualUnlinkModal oaId={oaId} workId={workId} player={manualUnlink} onClose={() => setManualUnlink(null)} onDone={onManualDone} />
    )}
    </>
  );
}

function BookingRows({
  booking,
  collapsed,
  onToggle,
  openMenu,
  setOpenMenu,
  pending,
  cachedUrl,
  issue,
  copy,
  canManage,
  onManualLink,
  onManualUnlink,
}: {
  booking: UzuProBookingGroup;
  collapsed: boolean;
  onToggle: () => void;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  pending: Record<string, boolean>;
  cachedUrl: Record<string, string>;
  issue: (kind: "liff" | "reissue", p: UzuProPlayerRow) => void;
  copy: (p: UzuProPlayerRow) => void;
  canManage: boolean;
  onManualLink: (p: UzuProPlayerRow) => void;
  onManualUnlink: (p: UzuProPlayerRow) => void;
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
          const primary = liffPrimaryAction(p.liffStatus); // 状態に応じた主要アクション（発行 / 再発行）
          const hasUrl = !!cachedUrl[p.id]; // 今セッションで取得済みの平文 URL があるか
          return (
            <tr key={p.id} className={"border-t border-[#f5f7f4] hover:bg-[#fafcfa] " + (muted ? "opacity-55" : "")}>
              <td className="whitespace-nowrap px-4 py-3 font-num text-ink-2">{p.id.slice(0, 8)}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{booking.externalBookingId}</td>
              <td className="px-2 py-3 text-ink-3">{booking.sessionTitle ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{formatDateTime(booking.startsAt)}</td>
              <td className="px-2 py-3 text-right font-num text-ink-2">{p.playerIndex}</td>
              <td className="px-2 py-3"><Chip tone={liff.tone}>{liff.label}</Chip></td>
              <td className="px-2 py-3">
                {p.lineLinked ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <Chip tone="green">連携済み</Chip>
                      {/* 連携元バッジ: LIFF 自動 / 手動登録 を小さく区別表示。 */}
                      {p.lineLinkSource === "MANUAL" ? (
                        <Chip tone="amber">手動登録</Chip>
                      ) : p.lineLinkSource === "LIFF" ? (
                        <Chip tone="blue">LIFF</Chip>
                      ) : null}
                      {p.lineLinkedMaskedId && (
                        <span className="font-num text-[11px] text-ink-3">{p.lineLinkedMaskedId}</span>
                      )}
                    </span>
                    {p.linkedAt && (
                      <span className="font-num text-[10px] text-ink-3">{formatDateTime(p.linkedAt)}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-ink-3">未連携</span>
                )}
              </td>
              <td className="px-2 py-3">{bookingChip(p.bookingStatus)}</td>
              <td className="whitespace-nowrap px-2 py-3 font-num text-ink-3">{formatDateTime(p.lastSyncedAt)}</td>
              <td className="relative px-4 py-3 text-right">
                {/* 操作メニューは LIFF 管理者のみ。権限がなければ表示しない（API でも強制）。 */}
                {!canManage ? (
                  <span className="text-[12px] text-ink-3" aria-hidden="true">—</span>
                ) : (
                  <>
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
                          className="absolute right-4 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 text-left shadow-lg"
                        >
                          {/* 状態に応じた主要アクション: 未発行→発行 / それ以外→再発行（旧URL失効）。 */}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => issue(primary.kind === "issue" ? "liff" : "reissue", p)}
                            className={
                              "block w-full px-3 py-1.5 text-left text-[12px] font-semibold " +
                              (primary.destructive ? "text-danger hover:bg-danger-soft" : "text-ink-2 hover:bg-brand-mist")
                            }
                          >
                            {primary.label}
                          </button>
                          {/* 今セッションで取得済みの URL がある場合のみ「URLを表示・コピー」。 */}
                          {hasUrl && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => copy(p)}
                              className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-brand-mist"
                            >
                              URLを表示・コピー
                            </button>
                          )}
                          {/* 緊急運用（LIFF 利用不可時）: 未連携なら手動登録 / 連携済みなら手動解除。 */}
                          <div className="my-1 border-t border-line-2" role="separator" />
                          {!p.lineLinked ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => onManualLink(p)}
                              className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-brand-mist"
                            >
                              LINE User IDを手動登録
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => onManualUnlink(p)}
                              className="block w-full px-3 py-1.5 text-left text-[12px] font-semibold text-danger hover:bg-danger-soft"
                            >
                              LINE連携を手動解除
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

// LINE User ID = "U" + 32桁hex（ID token の sub と整合）。クライアント側は軽い形式チェックのみ（正はサーバー）。
const LINE_USER_ID_RE = /^U[0-9a-fA-F]{32}$/;

/** 手動登録モーダル（LIFF 管理者のみ・入力→確認の 2 段階）。フル UID は入力/確認時のみ表示。 */
function ManualLinkModal({
  oaId,
  workId,
  player,
  onClose,
  onDone,
}: {
  oaId: string;
  workId: string;
  player: UzuProPlayerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [lineUserId, setLineUserId] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const uid = lineUserId.trim();
  const cid = confirmId.trim();
  const rsn = reason.trim();
  const formatOk = LINE_USER_ID_RE.test(uid);
  const matchOk = uid.length > 0 && uid === cid;
  const canProceed = formatOk && matchOk && rsn.length > 0;

  async function submit() {
    if (busy || !canProceed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/works/${workId}/uzu-pro/players/${player.id}/line/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: uid, lineUserIdConfirm: cid, reason: rsn }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const status = json?.data?.status;
        if (res.status === 409 && status === "conflict_other_account") showToast("別の LINE アカウントが登録済みです。変更は手動解除してから。", "error");
        else if (res.status === 409 && status === "conflict_booking_duplicate") showToast("同じ予約内の別プレイヤーに登録済みの LINE アカウントです。", "error");
        else if (res.status === 409 && status === "work_disabled") showToast("この作品は for UZU Pro が無効化されています。", "error");
        else if (res.status === 400) showToast("入力内容をご確認ください。", "error");
        else if (res.status === 404) showToast("対象プレイヤーが見つかりません。", "error");
        else showToast("登録に失敗しました。時間をおいて再度お試しください。", "error");
        return;
      }
      const status = json.data?.status;
      showToast(status === "already_linked" ? "すでに同じ LINE User ID が登録済みです" : "LINE User ID を手動登録しました", "success");
      onDone();
    } catch {
      showToast("登録に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="LINE User IDを手動登録" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-lg rounded-[16px] border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-ink">LINE User IDを手動登録</h3>
        <p className="mt-1 text-[12px] text-ink-3">
          プレイヤー <span className="font-num text-ink-2">{player.id.slice(0, 8)}</span>（番号 {player.playerIndex}）
        </p>

        {step === "input" ? (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-2">LINE User ID</span>
              <input
                value={lineUserId}
                onChange={(e) => setLineUserId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="U から始まる 33 文字"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg-tint px-3 py-2 font-num text-[12px] text-ink-2"
              />
              {uid.length > 0 && !formatOk && <span className="mt-1 block text-[11px] font-semibold text-danger">形式が不正です（U + 32桁の英数字）</span>}
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-2">確認用 LINE User ID</span>
              <input
                value={confirmId}
                onChange={(e) => setConfirmId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                onPaste={(e) => e.preventDefault()}
                placeholder="もう一度入力"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg-tint px-3 py-2 font-num text-[12px] text-ink-2"
              />
              {cid.length > 0 && !matchOk && <span className="mt-1 block text-[11px] font-semibold text-danger">確認用と一致しません</span>}
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-2">登録理由</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="例: LIFF が開けないため運営が代理登録"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg-tint px-3 py-2 text-[12px] text-ink-2"
              />
            </label>
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-[10px] border border-line px-3 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-line-2">キャンセル</button>
              <button type="button" disabled={!canProceed} onClick={() => setStep("confirm")} className="rounded-[10px] border border-brand-ink/20 bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand-ink hover:opacity-90 disabled:opacity-50">確認へ</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] font-semibold text-warn">
              この操作はLIFF認証を経由せず、LINE User IDを直接登録します。<br />
              対象プレイヤーとLINE User IDが正しいことを確認してください。
            </div>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-3"><dt className="text-ink-3">LINE User ID</dt><dd className="font-num font-semibold text-ink-2 break-all">{uid}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">登録理由</dt><dd className="font-semibold text-ink-2 break-all">{rsn}</dd></div>
            </dl>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep("input")} disabled={busy} className="rounded-[10px] border border-line px-3 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-line-2 disabled:opacity-50">戻る</button>
              <button type="button" onClick={submit} disabled={busy || !canProceed} className="rounded-[10px] border border-brand-ink/20 bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand-ink hover:opacity-90 disabled:opacity-50">{busy ? "登録中…" : "この内容で登録"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 手動解除モーダル（LIFF 管理者のみ）。LINE 連携のみ解除・LIFF URL は失効/再発行しない。 */
function ManualUnlinkModal({
  oaId,
  workId,
  player,
  onClose,
  onDone,
}: {
  oaId: string;
  workId: string;
  player: UzuProPlayerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const rsn = reason.trim();

  async function submit() {
    if (busy || rsn.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/works/${workId}/uzu-pro/players/${player.id}/line/manual`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rsn }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (res.status === 404) showToast("対象プレイヤーが見つかりません。", "error");
        else if (res.status === 400) showToast("解除理由を入力してください。", "error");
        else showToast("解除に失敗しました。時間をおいて再度お試しください。", "error");
        return;
      }
      const status = json.data?.status;
      showToast(status === "already_unlinked" ? "すでに未連携です" : "LINE連携を手動解除しました", "success");
      onDone();
    } catch {
      showToast("解除に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="LINE連携を手動解除" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-lg rounded-[16px] border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-ink">LINE連携を手動解除</h3>
        <p className="mt-1 text-[12px] text-ink-3">
          プレイヤー <span className="font-num text-ink-2">{player.id.slice(0, 8)}</span>（番号 {player.playerIndex}）
          {player.lineLinkedMaskedId && <> ・ <span className="font-num">{player.lineLinkedMaskedId}</span></>}
        </p>
        <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] font-semibold text-warn">
          LINE User ID の連携のみを解除します。LIFF URL は失効・再発行されません（既存 URL はそのまま利用可能）。
        </div>
        <label className="mt-3 block">
          <span className="text-[12px] font-semibold text-ink-2">解除理由</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="例: 誤登録の訂正"
            className="mt-1 w-full rounded-[10px] border border-line bg-bg-tint px-3 py-2 text-[12px] text-ink-2"
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-[10px] border border-line px-3 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-line-2 disabled:opacity-50">キャンセル</button>
          <button type="button" onClick={submit} disabled={busy || rsn.length === 0} className="rounded-[10px] border border-danger/30 bg-danger-soft px-3 py-1.5 text-[12px] font-bold text-danger hover:opacity-90 disabled:opacity-50">{busy ? "解除中…" : "手動解除する"}</button>
        </div>
      </div>
    </div>
  );
}
