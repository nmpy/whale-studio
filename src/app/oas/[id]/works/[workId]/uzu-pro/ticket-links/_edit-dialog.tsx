"use client";

// for ウズプロ ＞ チケット連携の「内容を修正」ダイアログ（PR-C）。
//
//   - 保存すると現在の連携を無効にし、修正内容で新しい連携を作成する（replacement）。
//     既存行の上書きではないことを説明文で明示する。
//   - 予約番号は **現在値を prefill しない**（必ず再入力させる）。
//   - 人数はチケット種別から決まるため入力させない（read-only 表示）。
//   - チケット種別の変更で人数が変わったらコードネームを全クリアし、全員分を再入力させる
//     （旧 1 名分を新 1 人目へ流用しない）。
//   - 送信中は二重送信を防止し、overlay クリックでは閉じない（入力内容を失わせない）。
//   - 検証・正規化・人数解決はすべてサーバー側でも行う。ここでの制御は入力補助に過ぎない。
//   - PR-B の解除ダイアログと同じ overlay 構造・トーンを踏襲する。

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { getAuthHeaders } from "@/lib/api-client";
import { formatReservationNumberInput, RESERVATION_NUMBER_MAX_LENGTH } from "@/lib/ticket-link/reservation-number";
import { CODE_NAME_MAX_LENGTH } from "@/lib/ticket-link/rules";
import type { TicketLinkAdminRow } from "@/lib/uzupro/ticket-link-view";
import type { TicketLinkTicketTypeSetting } from "@/types";

interface Props {
  oaId: string;
  workId: string;
  row: TicketLinkAdminRow;
  /** 作品設定の**有効な**チケット種別のみ。人数の正はこちら。 */
  ticketTypes: TicketLinkTicketTypeSetting[];
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line px-3 py-2 first:border-t-0">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-right text-[12px] font-bold text-ink-2 [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

const INPUT =
  "w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function TicketLinkEditDialog({ oaId, workId, row, ticketTypes, onClose }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 二重送信防止: state 更新前の連打も弾く。
  const inFlight = useRef(false);

  // 現在の種別が設定上まだ有効ならそれを初期選択にする（無効化済みなら未選択のまま）。
  const initialKey = useMemo(
    () => (ticketTypes.some((t) => t.ticketTypeKey === row.ticketTypeKey) ? (row.ticketTypeKey as string) : ""),
    [ticketTypes, row.ticketTypeKey],
  );
  const [ticketTypeKey, setTicketTypeKey] = useState(initialKey);

  const selected = ticketTypes.find((t) => t.ticketTypeKey === ticketTypeKey) ?? null;
  const participantCount = selected?.participantCount ?? 0;

  // 初期のコードネーム: 人数が現在の登録数と一致するときだけ引き継ぐ。
  const [codeNames, setCodeNames] = useState<string[]>(() => {
    const initialCount = ticketTypes.find((t) => t.ticketTypeKey === initialKey)?.participantCount ?? 0;
    if (initialCount > 0 && initialCount === row.codeNames.length) return [...row.codeNames];
    return Array.from({ length: initialCount }, () => "");
  });

  // 予約番号は prefill しない（必ず再入力させる）。
  const [reservationNumber, setReservationNumber] = useState("");

  const onTicketTypeChange = useCallback(
    (nextKey: string) => {
      const nextCount = ticketTypes.find((t) => t.ticketTypeKey === nextKey)?.participantCount ?? 0;
      if (nextCount !== participantCount) {
        // 人数が変わったら流用せず全員分を入力し直させる。
        setCodeNames(Array.from({ length: nextCount }, () => ""));
        setNotice("人数が変更されたため、コードネームを新しい人数分入力してください。");
      }
      setTicketTypeKey(nextKey);
      setError(null);
    },
    [ticketTypes, participantCount],
  );

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oas/${encodeURIComponent(oaId)}/works/${encodeURIComponent(workId)}` +
          `/uzu-pro/ticket-links/${encodeURIComponent(row.id)}/replace`,
        {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          // 編集内容のみを送る。oaId / workId / lineUserId 等は送らない（サーバーが確定する）。
          body: JSON.stringify({ ticketTypeKey, reservationNumber, codeNames }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 文言はサーバー側の日本語をそのまま使う（内部情報を含まない）。
        setError(json?.error?.message ?? "修正できませんでした。時間をおいて再度お試しください。");
        return;
      }
      if (json?.data?.status === "no_change") {
        // 何も書き込まれていない。閉じずに案内する。
        setError("変更内容がありません");
        return;
      }
      showToast("チケット連携を修正しました。UZU Pro 照合待ちに戻りました");
      onClose();
      // 一覧・サマリ・件数を最新化する（Server Component を再取得）。
      router.refresh();
    } catch {
      setError("修正できませんでした。通信状況をご確認のうえ、もう一度お試しください。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [oaId, workId, row.id, ticketTypeKey, reservationNumber, codeNames, showToast, onClose, router]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="チケット連携の内容を修正"
      /* overlay クリックでは閉じない（入力中の内容を失わせない）。 */
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 16, overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 520,
          margin: "40px 0", boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
        }}
      >
        <h2 className="mb-1 text-[16px] font-extrabold text-ink">チケット連携の内容を修正</h2>
        <p className="mb-4 text-[12px] leading-[1.8] text-ink-3">
          保存すると現在の連携を無効にし、修正内容で新しい連携を作成します。修正後は UZU Pro 照合待ちに戻ります。
          <br />
          変更前の内容は履歴として残ります。
        </p>

        {/* 現在の内容（read-only）。この画面は既に予約番号フル値を表示する認可境界。 */}
        <div className="mb-4 rounded-[10px] border border-line bg-surface">
          <Field label="現在の予約番号">
            <span className="font-num">{row.reservationNumber}</span>
          </Field>
          <Field label="現在のチケット種別">{row.ticketType ?? "—"}</Field>
          <Field label="現在の人数">{row.participantCount} 名</Field>
          <Field label="現在のコードネーム">
            {row.codeNames.length === 0 ? "—" : (
              <span className="inline-block text-left">
                {row.codeNames.map((c, i) => (
                  <span key={i} className="block">・{c}</span>
                ))}
              </span>
            )}
          </Field>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="tl-edit-type" className="mb-1 block text-[12px] font-bold text-ink-2">
              チケット種別
            </label>
            <select
              id="tl-edit-type"
              className={INPUT}
              value={ticketTypeKey}
              disabled={busy}
              onChange={(e) => onTicketTypeChange(e.target.value)}
            >
              <option value="">選択してください</option>
              {ticketTypes.map((t) => (
                <option key={t.ticketTypeKey} value={t.ticketTypeKey}>
                  {t.ticketTypeLabel}（{t.participantCount}名）
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-[12px] font-bold text-ink-2">人数</span>
            {/* 人数はチケット種別から決まる。自由入力させない。 */}
            <p aria-label="修正後の人数" className="text-[13px] text-ink">
              {participantCount > 0 ? `${participantCount} 名` : "チケット種別を選択してください"}
            </p>
          </div>

          <div>
            <label htmlFor="tl-edit-rn" className="mb-1 block text-[12px] font-bold text-ink-2">
              予約番号
            </label>
            <input
              id="tl-edit-rn"
              type="text"
              inputMode="numeric"
              className={INPUT + " font-num"}
              placeholder="123-456"
              maxLength={RESERVATION_NUMBER_MAX_LENGTH}
              value={reservationNumber}
              disabled={busy}
              /* 表示整形のみ。正規化・検証はサーバー側の既存関数で行う。 */
              onChange={(e) => setReservationNumber(formatReservationNumberInput(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-ink-3">確認のため、修正後の予約番号を入力してください。</p>
          </div>

          {participantCount > 0 && (
            <div>
              <span className="mb-1 block text-[12px] font-bold text-ink-2">コードネーム（{participantCount} 名分）</span>
              {notice && <p className="mb-1.5 text-[11px] text-warn">{notice}</p>}
              <div className="space-y-2">
                {Array.from({ length: participantCount }, (_, i) => (
                  <input
                    key={i}
                    type="text"
                    className={INPUT}
                    aria-label={`コードネーム ${i + 1} 人目`}
                    placeholder={`${i + 1} 人目`}
                    maxLength={CODE_NAME_MAX_LENGTH}
                    value={codeNames[i] ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const next = Array.from({ length: participantCount }, (_, j) => codeNames[j] ?? "");
                      next[i] = e.target.value;
                      setCodeNames(next);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-[8px] border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            キャンセル
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={submit}>
            {busy ? "保存しています…" : "修正内容を保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
