"use client";

// src/app/oas/[id]/broadcasts/page.tsx
// 配信メッセージ 一覧 / 配信履歴。
//
// 既存「応答メッセージ」(/oas/[id]/works/[workId]/messages) とは完全に別の入口。
// この画面から応答メッセージを編集する導線は置かない。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { broadcastApi, BROADCAST_STATUS_LABEL, BROADCAST_KIND_LABEL, contentKindOf, type BroadcastDto } from "./_client";
import { BroadcastPageHeading, Card, ErrorBanner } from "./_components";

function fmt(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")} ` +
         `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

export default function BroadcastListPage() {
  const { id: oaId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<BroadcastDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    broadcastApi.list(oaId).then(setRows).catch((e: Error) => setError(e.message));
  }, [oaId]);

  return (
    <>
      <BroadcastPageHeading />
      <ErrorBanner message={error} />

      <div className="mb-4 flex justify-end">
        <Link href={`/oas/${oaId}/broadcasts/new`} className="btn btn-primary">
          ＋ 配信メッセージを作成
        </Link>
      </div>

      <Card title="配信履歴">
        {rows == null ? (
          <p className="text-[12px] text-ink-3">読み込み中…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            まだ配信メッセージはありません。「＋ 配信メッセージを作成」から作成できます。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="py-2 pr-3 font-semibold">配信名</th>
                  <th className="py-2 pr-3 font-semibold">形式</th>
                  <th className="py-2 pr-3 font-semibold">対象</th>
                  <th className="py-2 pr-3 font-semibold">人数</th>
                  <th className="py-2 pr-3 font-semibold">成功</th>
                  <th className="py-2 pr-3 font-semibold">失敗</th>
                  <th className="py-2 pr-3 font-semibold">状態</th>
                  <th className="py-2 pr-3 font-semibold">開始</th>
                  <th className="py-2 pr-3 font-semibold">完了</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <Link href={`/oas/${oaId}/broadcasts/${b.id}`} className="font-semibold text-brand-ink no-underline hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {(() => { const k = contentKindOf(b.content); return k ? BROADCAST_KIND_LABEL[k] : "—"; })()}
                    </td>
                    <td className="py-2 pr-3">{b.target_type === "all" ? "全体" : "セグメント"}</td>
                    <td className="py-2 pr-3 tabular-nums">{b.recipient_count.toLocaleString()}</td>
                    <td className="py-2 pr-3 tabular-nums">{b.success_count.toLocaleString()}</td>
                    <td className="py-2 pr-3 tabular-nums">{b.failure_count.toLocaleString()}</td>
                    <td className="py-2 pr-3">{BROADCAST_STATUS_LABEL[b.status]}</td>
                    <td className="py-2 pr-3">{fmt(b.started_at)}</td>
                    <td className="py-2 pr-3">{fmt(b.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink-3">
          ここに表示されるのは配信メッセージの履歴のみです。応答メッセージの実行履歴は含みません。
        </p>
      </Card>
    </>
  );
}
