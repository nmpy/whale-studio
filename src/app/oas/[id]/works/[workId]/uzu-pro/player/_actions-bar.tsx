"use client";

// for ウズプロ ＞ プレイヤー右上操作: 未発行の LIFF を一括生成。
//   - 確認ダイアログで 対象作品 / 対象プレイヤー数（未発行 active）/ 除外件数と理由 を提示。
//   - 「実行後は通常変更できない」「キャンセル済みは対象外」を明示してから実行。
//   - 実行は POST .../players/liff/bulk。結果（生成/既発行/除外/失敗）を toast し router.refresh。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/shared/Button";
import type { UzuProBulkTargets } from "@/lib/uzupro/player-view";

export function UzuProPlayerActionsBar({
  oaId,
  workId,
  workTitle,
  bulk,
  canManage,
}: {
  oaId: string;
  workId: string;
  workTitle: string;
  bulk: UzuProBulkTargets;
  /** LIFF 管理者のみ一括発行可。false の場合はボタン自体を描画しない（API でも強制）。 */
  canManage: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { target, excludedCancelled, excludedIssued } = bulk;
  const excludedTotal = excludedCancelled + excludedIssued;

  // 権限のないユーザーには一括発行導線を出さない（サーバー側 authorizeUzuProManager でも拒否）。
  if (!canManage) return null;

  async function run() {
    if (busy || target === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/works/${workId}/uzu-pro/players/liff/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (json?.error?.code === "LIFF_NOT_CONFIGURED") showToast("このアカウントのLIFFが未設定です", "error");
        else showToast("一括生成に失敗しました。時間をおいて再度お試しください。", "error");
        return;
      }
      const d = json.data ?? {};
      const parts = [`生成 ${d.generated ?? 0}件`];
      if (d.alreadyIssued) parts.push(`既発行 ${d.alreadyIssued}件`);
      if (d.excluded) parts.push(`除外 ${d.excluded}件`);
      if (d.failed) parts.push(`失敗 ${d.failed}件`);
      showToast(parts.join(" / "), d.failed ? "error" : "success");
      setOpen(false);
      router.refresh();
    } catch {
      showToast("一括生成に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={target === 0} aria-haspopup="dialog">
        未発行のLIFFを一括生成{target ? `（${target}）` : ""}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="未発行のLIFFを一括生成"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[16px] border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-round text-[15px] font-bold text-ink">未発行のLIFFを一括生成</h2>

            <dl className="mt-3 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">対象作品</dt>
                <dd className="font-semibold text-ink-2">{workTitle}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">対象プレイヤー数（未発行）</dt>
                <dd className="font-num font-bold text-brand-ink">{target}名</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">除外件数</dt>
                <dd className="font-num font-semibold text-ink-2">{excludedTotal}件</dd>
              </div>
            </dl>

            {excludedTotal > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-lg bg-bg-tint px-3 py-2 text-[12px] text-ink-3">
                {excludedCancelled > 0 && <li>キャンセル済み: {excludedCancelled}件</li>}
                {excludedIssued > 0 && <li>発行済み: {excludedIssued}件</li>}
              </ul>
            )}

            <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] font-semibold text-warn">
              <p>実行後は通常変更できません。</p>
              <p>キャンセル済みのプレイヤーは対象外です。</p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>キャンセル</Button>
              <Button variant="primary" size="sm" onClick={run} disabled={busy || target === 0}>
                {busy ? "生成中…" : `${target}名に生成`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
