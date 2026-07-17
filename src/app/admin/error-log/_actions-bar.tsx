"use client";

// エラーログ右上操作: CSV エクスポート（現在フィルタ全件）+ 表示中の未解決を一括解決。
//   - 一括解決は「表示中ページの未解決」のみ（件数確認ダイアログ + サーバー再検証 + 冪等処理）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";

type ActionItem = { source: string; sourceId: string };

export function ErrorLogActionsBar({
  exportQuery,
  unresolvedOnPage,
  disabled,
}: {
  exportQuery: string;
  unresolvedOnPage: ActionItem[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const count = unresolvedOnPage.length;

  async function bulkResolve() {
    if (busy || count === 0) return;
    if (!window.confirm(`表示中の未解決 ${count} 件をすべて解決します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/error-log/bulk-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: unresolvedOnPage }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error();
      const resolved = json.data?.resolved ?? 0;
      const skipped = json.data?.skipped ?? 0;
      showToast(`${resolved}件を解決しました${skipped ? `（${skipped}件はスキップ）` : ""}`, "success");
      router.refresh();
    } catch {
      showToast("一括解決に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={disabled ? undefined : `/api/admin/error-log/export${exportQuery}`}
        aria-disabled={disabled}
        className={
          "rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2 " +
          (disabled ? "pointer-events-none opacity-50" : "hover:border-brand hover:text-brand-ink")
        }
      >
        CSVエクスポート
      </a>
      <button
        type="button"
        onClick={bulkResolve}
        disabled={disabled || busy || count === 0}
        aria-label="表示中の未解決をすべて解決"
        className="rounded-full px-3 py-1.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "#e6f6ec", color: "#178a48" }}
      >
        {busy ? "処理中…" : `表示中の未解決を解決${count ? `（${count}）` : ""}`}
      </button>
    </div>
  );
}
