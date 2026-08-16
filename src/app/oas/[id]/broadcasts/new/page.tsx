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
import {
  BROADCAST_UPLOAD_MAX_BYTES, BROADCAST_UPLOAD_ALLOWED_TYPES, BROADCAST_UPLOAD_MAX_LABEL,
} from "@/lib/broadcast/upload-limits";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { broadcastApi, BROADCAST_KIND_LABEL, type TargetInput, type BroadcastContentDto } from "../_client";
import {
  BroadcastPageHeading, Card, BroadcastContentPreview, AudienceCount, ConfirmSendModal, ErrorBanner,
} from "../_components";

const TEXT_MAX = 5000;
/** LINE 仕様: Flex の altText 上限。 */
const ALT_TEXT_MAX = 1500;

type Kind = BroadcastContentDto["kind"];
const KINDS: Kind[] = ["text", "image", "flex"];

/** 貼り付けられた Flex JSON を検証して、原因が分かるメッセージを返す。 */
function parseFlexContents(raw: string): { ok: true; value: { type: string; [k: string]: unknown } } | { ok: false; message: string } {
  if (raw.trim() === "") return { ok: false, message: "Flex JSON を入力してください" };
  let v: unknown;
  try { v = JSON.parse(raw); }
  catch (e) { return { ok: false, message: `JSON の形式が正しくありません: ${(e as Error).message}` }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, message: "Flex JSON はオブジェクトである必要があります" };
  }
  const t = (v as { type?: unknown }).type;
  if (t !== "bubble" && t !== "carousel") {
    return { ok: false, message: `最上位の "type" は "bubble" または "carousel" にしてください（現在: ${t === undefined ? "未指定" : String(t)}）` };
  }
  return { ok: true, value: v as { type: string; [k: string]: unknown } };
}

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
  const [kind, setKind] = useState<Kind>("text");
  const [text, setText] = useState("");
  // 画像
  const [originalUrl, setOriginalUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  // Flex
  const [altText, setAltText] = useState("");
  const [flexJson, setFlexJson] = useState("");

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

  const flexParsed = useMemo(() => (kind === "flex" ? parseFlexContents(flexJson) : null), [kind, flexJson]);

  /** 送信する content。未完成なら null（null の間は次へ進めない・テスト送信もできない）。 */
  const content: BroadcastContentDto | null = useMemo(() => {
    if (kind === "text") {
      return text.trim() !== "" && text.length <= TEXT_MAX ? { kind: "text", text } : null;
    }
    if (kind === "image") {
      const o = originalUrl.trim(), p = previewUrl.trim();
      const https = (u: string) => u.startsWith("https://");
      return o !== "" && p !== "" && https(o) && https(p)
        ? { kind: "image", originalContentUrl: o, previewImageUrl: p } : null;
    }
    const at = altText.trim();
    if (at === "" || at.length > ALT_TEXT_MAX) return null;
    return flexParsed?.ok ? { kind: "flex", altText: at, contents: flexParsed.value } : null;
  }, [kind, text, originalUrl, previewUrl, altText, flexParsed]);

  const step1Valid = name.trim() !== "" && content != null;
  const step2Valid = target != null && (count ?? 0) > 0;

  const handleUpload = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    // server と同じ定数で事前検証する。上限超過は送信前に弾く
    // （Vercel の request body 上限に当たると route handler まで届かず 413 になるため）。
    if (!(BROADCAST_UPLOAD_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      setError("アップロードできる画像は JPEG / PNG のみです");
      return;
    }
    if (file.size > BROADCAST_UPLOAD_MAX_BYTES) {
      setError(`アップロードできる画像は ${BROADCAST_UPLOAD_MAX_LABEL} 以下です（選択: ${(file.size / 1024 / 1024).toFixed(2)} MB）。より大きい画像は、公開済みの HTTPS URL を直接指定してください。`);
      return;
    }
    setUploading(true);
    try {
      const r = await broadcastApi.uploadImage(oaId, file);
      setOriginalUrl(r.original_content_url);
      setPreviewUrl(r.preview_image_url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleTestSend = async () => {
    setTestResult(null);
    setError(null);
    try {
      if (!content) return;
      const r = await broadcastApi.testSend(oaId, { line_user_id: testUserId.trim(), content });
      setTestResult(r.sent ? "テスト送信しました（配信実績には残りません）" : `送信できませんでした（HTTP ${r.http_status ?? "?"}）`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * 作成 → 開始 → **最初の 1 chunk だけ**即時処理して詳細画面へ。
   *
   * 全 chunk をブラウザで回さない。開始時点で宛先 snapshot と status=sending が
   * 確定しているので、残りは server-side の cron worker が引き継ぐ。
   * 少人数（1 chunk = 50 件以内）ならこの 1 回で完了し、多人数でも
   * 管理者はここでブラウザを閉じてよい。
   */
  const handleSend = async () => {
    if (!target || !content) return;
    setSending(true);
    setError(null);
    try {
      const created = await broadcastApi.create(oaId, { name: name.trim(), content, ...target });
      await broadcastApi.start(oaId, created.id);

      // 即時フィードバックのための 1 chunk のみ。失敗しても配信は cron が続けるので握りつぶす。
      try {
        const r = await broadcastApi.process(oaId, created.id);
        setProgress({ sent: r.sent, failed: r.failed });
      } catch { /* 続きは cron worker が処理する */ }

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

          <label className="mb-1 block text-[12px] font-semibold text-ink">メッセージ形式</label>
          <div className="mb-4 flex gap-2">
            {KINDS.map((k) => (
              <button
                key={k} type="button"
                className={k === kind ? "btn btn-primary" : "btn btn-ghost"}
                onClick={() => setKind(k)}
              >
                {BROADCAST_KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {kind === "text" && (
            <>
              <label className="mb-1 block text-[12px] font-semibold text-ink">本文</label>
              <textarea
                className="w-full rounded-lg border border-line px-3 py-2 text-[13px]"
                rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX}
                placeholder="LINE で送るテキストを入力してください"
              />
              <div className="mt-1 text-right text-[11px] text-ink-3">{text.length} / {TEXT_MAX}</div>
            </>
          )}

          {kind === "image" && (
            <>
              <div className="mb-3 rounded-card border border-line bg-bg px-3 py-3">
                <div className="mb-1 text-[12px] font-semibold text-ink">画像をアップロード</div>
                <p className="mb-2 text-[11px] leading-[1.5] text-ink-3">
                  アップロードできる画像は JPEG / PNG、{BROADCAST_UPLOAD_MAX_LABEL} 以下です。
                  アップロードすると元画像とプレビュー画像の URL が自動で入ります。
                </p>
                <input
                  type="file" accept="image/jpeg,image/png" disabled={uploading}
                  className="text-[12px]"
                  onChange={(e) => { void handleUpload(e.target.files?.[0]); e.target.value = ""; }}
                />
                {uploading && <p className="mt-2 text-[11px] text-ink-2">アップロード中…</p>}
              </div>

              <label className="mb-1 block text-[12px] font-semibold text-ink">元画像 URL</label>
              <input
                className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
                value={originalUrl} onChange={(e) => setOriginalUrl(e.target.value)}
                placeholder="https://example.com/original.jpg"
              />
              <label className="mb-1 block text-[12px] font-semibold text-ink">プレビュー画像 URL</label>
              <input
                className="w-full rounded-lg border border-line px-3 py-2 text-[12px]"
                value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)}
                placeholder="https://example.com/preview.jpg"
              />
              <p className="mt-1 text-[11px] leading-[1.5] text-ink-3">
                どちらも <strong>https</strong> で公開されている JPEG / PNG が必要です。
                すでに公開されている画像を URL で指定する場合は、LINE の仕様どおり
                元画像 10 MB 以下・プレビュー画像 1 MB 以下が使えます
                （{BROADCAST_UPLOAD_MAX_LABEL} の制限は Whale Studio からアップロードする場合だけです）。
              </p>
            </>
          )}

          {kind === "flex" && (
            <>
              <label className="mb-1 block text-[12px] font-semibold text-ink">代替テキスト（通知・トーク一覧に表示）</label>
              <input
                className="mb-1 w-full rounded-lg border border-line px-3 py-2 text-[13px]"
                value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={ALT_TEXT_MAX}
                placeholder="例: 8月イベントのお知らせ"
              />
              <div className="mb-3 text-right text-[11px] text-ink-3">{altText.length} / {ALT_TEXT_MAX}</div>

              <label className="mb-1 block text-[12px] font-semibold text-ink">Flex JSON（bubble または carousel）</label>
              <textarea
                className="w-full rounded-lg border border-line px-3 py-2 font-mono text-[12px]"
                rows={12} value={flexJson} onChange={(e) => setFlexJson(e.target.value)}
                placeholder={'{\n  "type": "bubble",\n  "body": { "type": "box", "layout": "vertical", "contents": [] }\n}'}
              />
              <p className="mt-1 text-[11px] leading-[1.5] text-ink-3">
                LINE の Flex Message Simulator で作成した JSON のうち、<strong>contents 部分</strong>（最上位が
                <code> &quot;type&quot;: &quot;bubble&quot; </code>または<code> &quot;carousel&quot; </code>のオブジェクト）を貼り付けてください。
                <code> type: &quot;flex&quot; </code>と代替テキストは Whale Studio 側で付与します。
              </p>
              {flexJson.trim() !== "" && flexParsed && !flexParsed.ok && (
                <p role="alert" className="mt-2 rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
                  {flexParsed.message}
                </p>
              )}
              {flexParsed?.ok && (
                <p className="mt-2 text-[11px] text-ink-2">
                  JSON は有効です（コンテナ: {flexParsed.value.type}）。実際の見た目はテスト送信で確認してください。
                </p>
              )}
            </>
          )}

          <div className="mt-4">
            {content
              ? <BroadcastContentPreview content={content} />
              : <p className="text-[11px] text-ink-3">内容を入力するとプレビューが表示されます。</p>}
          </div>

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
              <button type="button" className="btn btn-ghost" disabled={!content || !testUserId.trim()} onClick={handleTestSend}>
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

            <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-2 text-[13px]">
              <dt className="text-ink-3">形式</dt>
              <dd className="text-ink">{BROADCAST_KIND_LABEL[kind]}</dd>
            </dl>
            <div className="mt-3">
              {content
                ? <BroadcastContentPreview content={content} />
                : <p className="text-[12px] text-danger">内容が未完成です。STEP 1 に戻って入力してください。</p>}
            </div>
          </Card>

          {!canSend && (
            <div className="rounded-card border border-line bg-bg px-3 py-2 text-[12px] text-ink-2">
              本配信の実行には管理者（owner / admin）権限が必要です。
            </div>
          )}

          {progress && (
            <div className="rounded-card border border-line bg-surface px-3 py-2 text-[12px] text-ink-2">
              送信を開始しました（成功 {progress.sent} / 失敗 {progress.failed}）。
              残りはバックグラウンドで続きます。この画面を閉じても配信は継続します。
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
