"use client";

// for ウズプロ ＞ チケット連携の「連携を解除」確認ダイアログ。
//
//   - 一覧の控えめなテキストボタンから開く。押しただけでは変更しない。
//   - 予約番号 / チケット種別 / コードネームを提示してから最終 CTA を押させる。
//   - 送信中は二重送信を防止（busy 中はボタンを無効化し、再入も弾く）。
//   - 予約実体は削除しないことを明記する。
//   - エラーはサーバーの日本語メッセージをそのまま出す（予約番号等は含めない）。
//   - 既存モーダル（audience/_ExclusionModal）と同じ overlay 構造・トーンを踏襲する。

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { getAuthHeaders } from "@/lib/api-client";
import type { TicketLinkAdminRow } from "@/lib/uzupro/ticket-link-view";

interface Props {
  oaId: string;
  workId: string;
  row: TicketLinkAdminRow;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line px-3 py-2.5 first:border-t-0">
      <span className="shrink-0 text-[12px] text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-right text-[12px] font-bold text-ink-2 [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

export function TicketLinkRevokeDialog({ oaId, workId, row, onClose }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 二重送信防止: state 更新前の連打も弾く。
  const inFlight = useRef(false);

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oas/${encodeURIComponent(oaId)}/works/${encodeURIComponent(workId)}` +
          `/uzu-pro/ticket-links/${encodeURIComponent(row.id)}/revoke`,
        { method: "POST", headers: { ...getAuthHeaders() } },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 権限なし / 対象なしは 404、遷移不可は 409。文言はサーバー側の日本語をそのまま使う。
        setError(json?.error?.message ?? "解除できませんでした。時間をおいて再度お試しください。");
        return;
      }
      const already = json?.data?.status === "already_revoked";
      showToast(already ? "このチケット連携はすでに解除されています" : "チケット連携を解除しました");
      onClose();
      // 一覧・サマリ・件数を最新化する（Server Component を再取得）。
      router.refresh();
    } catch {
      setError("解除できませんでした。通信状況をご確認のうえ、もう一度お試しください。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [oaId, workId, row.id, showToast, onClose, router]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="チケット連携の解除"
      onClick={() => { if (!busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 16, overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 480,
          margin: "40px 0", boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
        }}
      >
        <h2 className="mb-1 text-[16px] font-extrabold text-ink">チケット連携を解除しますか？</h2>
        <p className="mb-4 text-[12px] leading-[1.8] text-ink-3">
          このチケット連携を解除します。解除後、プレイヤーはこの予約との連携状態を失います。
          <br />
          予約データそのものは削除されません。状態は「無効」として履歴に残ります。
        </p>

        <div className="mb-4 rounded-[10px] border border-line bg-surface">
          <Field label="予約番号">
            <span className="font-num">{row.reservationNumber}</span>
          </Field>
          <Field label="チケット種別">{row.ticketType ?? "—"}</Field>
          <Field label="コードネーム">
            {row.codeNames.length === 0 ? "—" : (
              <span className="inline-block text-left">
                {row.codeNames.map((c, i) => (
                  <span key={i} className="block">・{c}</span>
                ))}
              </span>
            )}
          </Field>
        </div>

        {error && (
          <div role="alert" className="mb-3 rounded-[8px] border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            キャンセル
          </Button>
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={submit}>
            {busy ? "解除しています…" : "連携を解除"}
          </Button>
        </div>
      </div>
    </div>
  );
}
