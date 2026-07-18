"use client";

// エラーログ一覧テーブル（行単位の解決 / 再オープン）。View Model のみ受け取り、内部 DB モデルは扱わない。
//   - 操作中は二重送信防止で disabled + loading。成功で router.refresh、失敗は toast で元状態維持。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/format-datetime";
import { accountColor } from "@/lib/owner-dashboard/account-color";
import { ACTIVITY_TONE_CLASS } from "@/lib/activity-feed";
import { TYPE_LABEL, TYPE_TONE } from "@/lib/owner-error-log/normalize";
import type { OwnerErrorLogItem } from "@/lib/owner-error-log/types";

export function ErrorLogTable({ items }: { items: OwnerErrorLogItem[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function act(kind: "resolve" | "reopen", it: OwnerErrorLogItem) {
    const key = `${it.source}:${it.sourceId}`;
    if (pending[key]) return;
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`/api/admin/error-log/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: it.source, sourceId: it.sourceId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast(kind === "resolve" ? "解決しました" : "再オープンしました", "success");
      router.refresh();
    } catch {
      showToast("操作に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-[14px] border border-line bg-surface px-5 py-10 text-center shadow-sm">
        <p className="text-[13px] text-ink-3">条件に一致するエラーログはありません</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              <th scope="col" className="px-5 py-2.5 font-semibold">日時</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">アカウント</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">種別</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">内容</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">状態</th>
              <th scope="col" className="px-5 py-2.5 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const c = accountColor(it.oaId);
              const key = `${it.source}:${it.sourceId}`;
              const busy = !!pending[key];
              return (
                <tr key={key} className="border-t border-[#f5f7f4] align-top hover:bg-[#fafcfa]">
                  <td className="whitespace-nowrap px-5 py-3 font-num text-ink-3">{formatDateTime(it.occurredAt)}</td>
                  <td className="px-2 py-3">
                    <Link href={`/oas/${it.oaId}/works`} className="inline-flex max-w-[150px] items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold hover:underline" style={{ background: c.bg, color: c.text }}>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: c.dot }} />
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{it.accountName}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-3">
                    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold " + ACTIVITY_TONE_CLASS[TYPE_TONE[it.type]]}>{TYPE_LABEL[it.type]}</span>
                  </td>
                  <td className="px-2 py-3">
                    <div className="max-w-[380px]">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-ink-2">{it.title}</div>
                      <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-ink-3">
                        {it.player ?? "—"}{it.detail ? ` · ${it.detail}` : ""}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    {it.isResolved ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold text-brand-ink" style={{ background: "#e6f6ec" }}>解決済み</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "#fdeeed", color: "#c2564d" }}>未解決</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {it.isResolved ? (
                      <button
                        type="button"
                        onClick={() => act("reopen", it)}
                        disabled={busy}
                        aria-label={`${it.accountName} の「${it.title}」を再オープン`}
                        className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-bold text-ink-2 hover:border-brand hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? "処理中…" : "再オープン"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => act("resolve", it)}
                        disabled={busy}
                        aria-label={`${it.accountName} の「${it.title}」を解決`}
                        className="rounded-full px-3 py-1 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: "#e6f6ec", color: "#178a48" }}
                      >
                        {busy ? "処理中…" : "解決"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
