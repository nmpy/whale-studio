"use client";

// src/app/oas/[id]/broadcasts/[broadcastId]/page.tsx
// 配信メッセージの詳細 / 進捗 / 失敗分の再送。
//
// 既存「応答メッセージ」の実行履歴・Runtime ログとは混ぜない（このページは配信のみを扱う）。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { broadcastApi, BROADCAST_STATUS_LABEL, contentKindOf, type BroadcastDetailDto } from "../_client";
import { BroadcastPageHeading, Card, BroadcastContentPreview, ContentKindBadge, ErrorBanner } from "../_components";

function fmt(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")} ` +
         `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

export default function BroadcastDetailPage() {
  const { id: oaId, broadcastId } = useParams<{ id: string; broadcastId: string }>();
  const { isOwner, isAdmin } = useWorkspaceRole(oaId);
  const canSend = isOwner || isAdmin;

  const [row, setRow] = useState<BroadcastDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRow(await broadcastApi.get(oaId, broadcastId)); }
    catch (e) { setError((e as Error).message); }
  }, [oaId, broadcastId]);

  useEffect(() => { void load(); }, [load]);

  // 送信中は進捗を定期的に取り直す
  useEffect(() => {
    if (row?.status !== "sending") return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [row?.status, load]);

  /**
   * 失敗した宛先だけを再送対象に戻す。成功済みには送らない。
   * 実際の送信は 1 chunk だけ即時に行い、残りは cron worker が引き継ぐ。
   */
  const handleRetry = async () => {
    setBusy(true);
    setError(null);
    try {
      await broadcastApi.retry(oaId, broadcastId);
      try { await broadcastApi.process(oaId, broadcastId); } catch { /* 続きは cron worker */ }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 手動で 1 chunk だけ進める（通常は cron worker が自動で処理するので操作不要）。
   * cron を待たずに今すぐ動かしたいとき用の補助導線。
   */
  const handleResume = async () => {
    setBusy(true);
    setError(null);
    try {
      await broadcastApi.process(oaId, broadcastId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BroadcastPageHeading subtitle={row?.name} />
      <ErrorBanner message={error} />

      <div className="mb-4">
        <Link href={`/oas/${oaId}/broadcasts`} className="text-[12px] text-ink-3 no-underline hover:underline">
          ← 配信メッセージ一覧
        </Link>
      </div>

      {row == null ? (
        <p className="text-[12px] text-ink-3">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card title="配信結果">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-[13px]">
              <dt className="text-ink-3">状態</dt>
              <dd className="font-semibold text-ink">{BROADCAST_STATUS_LABEL[row.status]}</dd>
              <dt className="text-ink-3">対象</dt>
              <dd className="text-ink">{row.target_type === "all" ? "全体" : "セグメント"}</dd>
              <dt className="text-ink-3">人数</dt>
              <dd className="tabular-nums text-ink">{row.recipient_count.toLocaleString()}人</dd>
              <dt className="text-ink-3">成功</dt>
              <dd className="tabular-nums text-ink">{row.success_count.toLocaleString()}</dd>
              <dt className="text-ink-3">失敗</dt>
              <dd className="tabular-nums text-ink">
                {row.failure_count.toLocaleString()}
                {row.failure_count > 0 && (
                  <span className="ml-2 text-[11px] text-ink-3">
                    （再送可能 {row.retryable_failure_count.toLocaleString()}件 / 再送不可 {row.non_retryable_failure_count.toLocaleString()}件）
                  </span>
                )}
              </dd>
              <dt className="text-ink-3">未送信</dt>
              <dd className="tabular-nums text-ink">{row.pending_count.toLocaleString()}</dd>
              {row.skipped_count > 0 && (
                <>
                  <dt className="text-ink-3">要確認</dt>
                  <dd className="tabular-nums text-ink">{row.skipped_count.toLocaleString()}</dd>
                </>
              )}
              <dt className="text-ink-3">開始</dt><dd className="text-ink">{fmt(row.started_at)}</dd>
              <dt className="text-ink-3">完了</dt><dd className="text-ink">{fmt(row.completed_at)}</dd>
            </dl>

            {row.status === "sending" && (
              <p className="mt-3 rounded-card border border-line bg-bg px-3 py-2 text-[12px] leading-[1.6] text-ink-2">
                配信処理中です。<strong>この画面を閉じてもバックグラウンドで送信は継続します。</strong>
                進捗は自動で更新され、あとで開き直しても最新の状態が表示されます。
              </p>
            )}

            {canSend && (
              <div className="mt-4 flex gap-2">
                {row.status === "sending" && (
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={handleResume}>
                    {busy ? "処理中…" : "今すぐ続きを1回分処理"}
                  </button>
                )}
                {/* 再送可能な失敗が 0 件ならボタンを出さない（failure_count だけを根拠にしない）。 */}
                {(row.status === "partial_failed" || row.status === "failed") && row.retryable_failure_count > 0 && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={handleRetry}>
                    {busy ? "再送中…" : `再送可能な ${row.retryable_failure_count.toLocaleString()}件を再送`}
                  </button>
                )}
              </div>
            )}
            {(row.status === "partial_failed" || row.status === "failed") && (
              <p className="mt-2 text-[11px] text-ink-3">
                再送できるのは、通信エラーや LINE 側の一時エラー（5xx）で失敗し、再試行の有効期間（24時間）内にある宛先だけです。
                宛先やリクエストの不備による失敗（4xx）は、送り直しても結果が変わらないため再送対象になりません。
                成功済みの宛先へは再送されません。
              </p>
            )}
            {row.skipped_count > 0 && (
              <p className="mt-2 text-[11px] text-ink-3">
                「要確認」は、LINE 側で受理されたかどうかが確定できないまま再試行の有効期間（24時間）を過ぎた宛先です。
                二重配信を避けるため自動再送・手動再送のどちらの対象にもしていません。
              </p>
            )}
          </Card>

          <Card title="送信内容">
            {(() => {
              const c = row.content;
              // 未知・破損 content でも履歴画面を壊さない（配信基盤側は parse 失敗として扱う）
              if (!contentKindOf(c)) {
                return <p className="text-[12px] text-ink-3">この配信の内容を表示できません（保存形式が不明です）。</p>;
              }
              return (
                <>
                  <div className="mb-3"><ContentKindBadge kind={c.kind} /></div>
                  {c.kind === "text" && (
                    <div className="mb-3 whitespace-pre-wrap rounded-card border border-line bg-bg px-3 py-2 text-[13px] leading-[1.7] text-ink">
                      {c.text}
                    </div>
                  )}
                  {c.kind === "image" && (
                    <dl className="mb-3 grid grid-cols-[7rem_1fr] gap-y-1.5 text-[12px]">
                      <dt className="text-ink-3">元画像</dt>
                      <dd className="break-all font-mono text-[11px] text-ink-2">{c.originalContentUrl}</dd>
                      <dt className="text-ink-3">プレビュー</dt>
                      <dd className="break-all font-mono text-[11px] text-ink-2">{c.previewImageUrl}</dd>
                    </dl>
                  )}
                  <BroadcastContentPreview content={c} />
                </>
              );
            })()}
          </Card>

          {row.failed_samples.length > 0 && (
            <Card title="失敗した宛先（最大 50 件）">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-2 pr-3 font-semibold">宛先</th>
                    <th className="py-2 pr-3 font-semibold">HTTP</th>
                    <th className="py-2 pr-3 font-semibold">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {row.failed_samples.map((f, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-2 pr-3 font-mono">{f.line_user_id_prefix}…</td>
                      <td className="py-2 pr-3 tabular-nums">{f.http_status ?? "—"}</td>
                      <td className="py-2 pr-3">{f.error_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
