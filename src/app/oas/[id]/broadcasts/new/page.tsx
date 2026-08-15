"use client";

// src/app/oas/[id]/broadcasts/new/page.tsx
// 配信メッセージの作成（STEP 1 メッセージ内容 → STEP 2 配信対象 → STEP 3 確認・配信）。
//
// 既存「応答メッセージ」の編集 UI とは別画面・別コンポーネント。
// この画面から応答メッセージを編集する導線は置かない。

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getAuthHeaders } from "@/lib/api-client";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { broadcastApi, type TargetInput } from "../_client";
import {
  BroadcastPageHeading, Card, LinePreview, AudienceCount, ConfirmSendModal, ErrorBanner,
} from "../_components";

const TEXT_MAX = 5000;

interface SegmentRow { id: string; name: string; filter_type: string }
interface WorkRow { id: string; title: string }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { ...getAuthHeaders() }, cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? "取得に失敗しました");
  return json.data as T;
}

export default function NewBroadcastPage() {
  const { id: oaId } = useParams<{ id: string }>();
  const router = useRouter();
  const { isOwner, isAdmin } = useWorkspaceRole(oaId);
  /** 本配信は admin 以上。応答メッセージを編集できる editor には出さない。 */
  const canSend = isOwner || isAdmin;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);

  // STEP 1
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  // STEP 2
  const [targetType, setTargetType] = useState<"all" | "segment">("all");
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [workId, setWorkId] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  // テスト送信
  const [testUserId, setTestUserId] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // STEP 3
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number } | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<SegmentRow[]>(`/api/segments?oa_id=${oaId}`).catch(() => []),
      getJson<WorkRow[]>(`/api/works?oa_id=${oaId}`).catch(() => []),
    ]).then(([s, w]) => { setSegments(s); setWorks(w); });
  }, [oaId]);

  const target: TargetInput | null = useMemo(() => {
    if (targetType === "all") return { target_type: "all" };
    if (segmentId && workId) return { target_type: "segment", segment_id: segmentId, work_id: workId };
    return null;
  }, [targetType, segmentId, workId]);

  // 対象が決まるたびに人数を取り直す（人数を出さずに進ませない）
  const refreshCount = useCallback(async () => {
    if (!target) { setCount(null); return; }
    setCountLoading(true);
    try {
      const { count: c } = await broadcastApi.audienceCount(oaId, target);
      setCount(c);
    } catch (e) {
      setError((e as Error).message);
      setCount(null);
    } finally {
      setCountLoading(false);
    }
  }, [oaId, target]);

  useEffect(() => { if (step === 2 || step === 3) void refreshCount(); }, [step, refreshCount]);

  const step1Valid = name.trim() !== "" && text.trim() !== "" && text.length <= TEXT_MAX;
  const step2Valid = target != null && (count ?? 0) > 0;

  const handleTestSend = async () => {
    setTestResult(null);
    setError(null);
    try {
      const r = await broadcastApi.testSend(oaId, { line_user_id: testUserId.trim(), content: { kind: "text", text } });
      setTestResult(r.sent ? "テスト送信しました（配信実績には残りません）" : `送信できませんでした（HTTP ${r.http_status ?? "?"}）`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 作成 → 開始 → chunk を送り切るまで process を繰り返す。 */
  const handleSend = async () => {
    if (!target) return;
    setSending(true);
    setError(null);
    try {
      const created = await broadcastApi.create(oaId, { name: name.trim(), content: { kind: "text", text }, ...target });
      await broadcastApi.start(oaId, created.id);

      let guard = 0;
      for (;;) {
        const r = await broadcastApi.process(oaId, created.id);
        setProgress({ sent: r.sent, failed: r.failed });
        if (!r.has_more) break;
        if (++guard > 1000) break; // 念のための上限（1000 chunk）
      }
      router.push(`/oas/${oaId}/broadcasts/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const stepLabel = ["メッセージ内容", "配信対象", "確認・配信"][step - 1];

  return (
    <>
      <BroadcastPageHeading subtitle={`STEP ${step} / 3 — ${stepLabel}`} />
      <ErrorBanner message={error} />

      {/* ── STEP 1 メッセージ内容 ── */}
      {step === 1 && (
        <Card title="STEP 1 メッセージ内容">
          <label className="mb-1 block text-[12px] font-semibold text-ink">配信名（管理用・LINE には表示されません）</label>
          <input
            className="mb-4 w-full rounded-lg border border-line px-3 py-2 text-[13px]"
            value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
            placeholder="例: 8月イベント告知"
          />

          <label className="mb-1 block text-[12px] font-semibold text-ink">本文</label>
          <textarea
            className="w-full rounded-lg border border-line px-3 py-2 text-[13px]"
            rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX}
            placeholder="LINE で送るテキストを入力してください"
          />
          <div className="mt-1 text-right text-[11px] text-ink-3">{text.length} / {TEXT_MAX}</div>

          <div className="mt-4"><LinePreview text={text} /></div>

          <div className="mt-4 rounded-card border border-line bg-bg px-3 py-3">
            <div className="mb-1 text-[12px] font-semibold text-ink">テスト送信</div>
            <p className="mb-2 text-[11px] leading-[1.5] text-ink-3">
              指定した 1 名にだけ送って見え方を確認できます。配信実績（人数・成功数・失敗数）には残りません。
            </p>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[12px]"
                value={testUserId} onChange={(e) => setTestUserId(e.target.value)}
                placeholder="送信先の LINE ユーザー ID（U から始まる 33 文字）"
              />
              <button type="button" className="btn btn-ghost" disabled={!text.trim() || !testUserId.trim()} onClick={handleTestSend}>
                テスト送信
              </button>
            </div>
            {testResult && <p className="mt-2 text-[11px] text-ink-2">{testResult}</p>}
          </div>

          <div className="mt-5 flex justify-between">
            <Link href={`/oas/${oaId}/broadcasts`} className="btn btn-ghost">キャンセル</Link>
            <button type="button" className="btn btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>
              次へ（配信対象）
            </button>
          </div>
        </Card>
      )}

      {/* ── STEP 2 配信対象 ── */}
      {step === 2 && (
        <Card title="STEP 2 配信対象">
          <div className="mb-4 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" checked={targetType === "all"} onChange={() => setTargetType("all")} />
              全体（このアカウントの配信可能ユーザー）
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" checked={targetType === "segment"} onChange={() => setTargetType("segment")} />
              セグメント
            </label>
          </div>

          {targetType === "segment" && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-ink">セグメント</label>
                <select className="w-full rounded-lg border border-line px-3 py-2 text-[13px]"
                        value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  <option value="">選択してください</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-ink">評価する作品</label>
                <select className="w-full rounded-lg border border-line px-3 py-2 text-[13px]"
                        value={workId} onChange={(e) => setWorkId(e.target.value)}>
                  <option value="">選択してください</option>
                  {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-ink-3">
                  セグメントの条件（フェーズ / 未接触 など）は作品ごとの進行状況で判定されます。
                </p>
              </div>
            </div>
          )}

          <AudienceCount count={count} loading={countLoading} />

          <div className="mt-5 flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>戻る</button>
            <button type="button" className="btn btn-primary" disabled={!step2Valid} onClick={() => setStep(3)}>
              次へ（確認）
            </button>
          </div>
        </Card>
      )}

      {/* ── STEP 3 確認・配信 ── */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <Card title="STEP 3 確認・配信">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-[13px]">
              <dt className="text-ink-3">配信名</dt><dd className="font-semibold text-ink">{name}</dd>
              <dt className="text-ink-3">対象</dt>
              <dd className="text-ink">
                {targetType === "all"
                  ? "全体"
                  : `セグメント: ${segments.find((s) => s.id === segmentId)?.name ?? "—"}（${works.find((w) => w.id === workId)?.title ?? "—"}）`}
              </dd>
              <dt className="text-ink-3">人数</dt>
              <dd className="font-semibold text-ink">{count == null ? "—" : `${count.toLocaleString()}人`}</dd>
            </dl>

            <div className="mt-3 whitespace-pre-wrap rounded-card border border-line bg-bg px-3 py-2 text-[13px] leading-[1.7] text-ink">
              {text}
            </div>
            <div className="mt-3"><LinePreview text={text} /></div>
          </Card>

          {!canSend && (
            <div className="rounded-card border border-line bg-bg px-3 py-2 text-[12px] text-ink-2">
              本配信の実行には管理者（owner / admin）権限が必要です。
            </div>
          )}

          {progress && (
            <div className="rounded-card border border-line bg-surface px-3 py-2 text-[12px] text-ink-2">
              送信中… 成功 {progress.sent} / 失敗 {progress.failed}
            </div>
          )}

          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => setStep(2)}>戻る</button>
            <button
              type="button" className="btn btn-primary"
              disabled={!canSend || sending || !step2Valid}
              onClick={() => setConfirmOpen(true)}
            >
              配信する
            </button>
          </div>
        </div>
      )}

      <ConfirmSendModal
        open={confirmOpen}
        count={count ?? 0}
        sending={sending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleSend}
      />
    </>
  );
}
