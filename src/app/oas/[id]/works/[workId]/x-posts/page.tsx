"use client";

// src/app/oas/[id]/works/[workId]/x-posts/page.tsx
// X投稿管理（旧「SNS投稿管理」を作品配下へ移動・X専用に拡張）。
// タブ: X投稿（PR1・機能実装）/ 流入分析（PR2）/ 感情分析（PR3）。初期は X投稿。
// X API / スクレイピングは使わない。計測は /r/[trackingCode] クリックのみ。

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { getAuthHeaders } from "@/lib/api-client";
import { ImageUploadField } from "@/components/ImageUploadField";
import { parseImportFile } from "@/lib/x-posts/file-parse";
import { buildUtmUrl, parseHashtagsInput } from "@/lib/x-posts/format";
import type { XPost, XPostStatus, CreateXPostBody, XPostAnalytics, XPostSentiment } from "@/types";

type Tab = "posts" | "inflow" | "sentiment";

const STATUS_LABEL: Record<XPostStatus, string> = {
  draft: "下書き", scheduled: "予約", posted: "投稿済み", archived: "アーカイブ",
};

export default function XPostsPage() {
  const params = useParams<{ id: string; workId: string }>();
  const oaId = params.id;
  const workId = params.workId;
  const { showToast } = useToast();
  const { canEdit } = useWorkspaceRole(oaId);

  const [tab, setTab] = useState<Tab>("posts");
  const [posts, setPosts] = useState<XPost[] | null>(null);
  const [editing, setEditing] = useState<XPost | "new" | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/works/${workId}/x-posts`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setPosts(res.ok && Array.isArray(json?.data) ? json.data : []);
    } catch {
      setPosts([]);
    }
  }, [workId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  return (
    <>
      <div className="mb-5">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト", href: `/oas/${oaId}/works` },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "X投稿管理" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          X投稿管理
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          作品ごとの告知ポスト、計測URL、流入分析、CSVインポートによる反応分析を管理できます。
        </p>
      </div>

      {/* タブ */}
      <div role="tablist" aria-label="X投稿管理セクション" className="mb-5 flex gap-0 border-b border-line">
        {([
          { key: "posts",     label: "X投稿" },
          { key: "inflow",    label: "流入分析" },
          { key: "sentiment", label: "感情分析" },
        ] as const).map(({ key, label }) => {
          const isActive = tab === key;
          return (
            <button
              key={key} type="button" role="tab" aria-selected={isActive}
              onClick={() => setTab(key)}
              className={
                "-mb-px border-b-2 px-5 py-2.5 text-[13px] transition-colors " +
                (isActive ? "border-brand font-bold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink-2")
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === "posts" && (
        <XPostsTab
          oaId={oaId} workId={workId} posts={posts} canEdit={canEdit}
          editing={editing} setEditing={setEditing}
          onChanged={fetchPosts} showToast={showToast}
        />
      )}

      {tab === "inflow" && <InflowTab workId={workId} />}

      {tab === "sentiment" && <SentimentTab workId={workId} canEdit={canEdit} />}
    </>
  );
}

// ── X投稿タブ（一覧 + フォーム）──────────────────────────
function XPostsTab({
  oaId, workId, posts, canEdit, editing, setEditing, onChanged, showToast,
}: {
  oaId: string;
  workId: string;
  posts: XPost[] | null;
  canEdit: boolean;
  editing: XPost | "new" | null;
  setEditing: (v: XPost | "new" | null) => void;
  onChanged: () => void;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  async function handleDelete(p: XPost) {
    if (!confirm(`「${p.title || "無題のX投稿"}」を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/works/${workId}/x-posts/${p.id}`, { method: "DELETE", headers: { ...getAuthHeaders() } });
    if (res.ok) { showToast("削除しました", "success"); onChanged(); }
    else showToast("削除に失敗しました", "error");
  }

  if (editing) {
    return (
      <XPostForm
        oaId={oaId} workId={workId}
        post={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div>
          <button type="button" onClick={() => setEditing("new")} className="btn btn-primary">＋ 新規X投稿</button>
        </div>
      )}

      {posts === null ? (
        <div className="card" style={{ padding: 20 }}><div className="skeleton" style={{ height: 16, width: 200 }} /></div>
      ) : posts.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
          まだX投稿がありません。作品の告知文や計測URLを管理できます。
        </div>
      ) : (
        posts.map((p) => (
          <div key={p.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold text-ink">{p.title || "無題のX投稿"}</span>
                  <span className="rounded-full bg-bg-tint px-2 py-0.5 text-[11px] font-semibold text-ink-2">{STATUS_LABEL[p.status]}</span>
                </div>
                {p.body && <p className="mt-1 text-[12px] text-ink-2 line-clamp-2 whitespace-pre-wrap">{p.body}</p>}
                {p.hashtags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.hashtags.map((t) => <span key={t} className="rounded bg-sky-soft px-1.5 py-0.5 text-[11px] text-sky-ink">{t}</span>)}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
                  {p.tracking_url && <span>計測URL: <code className="break-all">{p.tracking_url}</code></span>}
                  <span>クリック数: <strong>{p.click_count}</strong>（参考値）</span>
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-shrink-0 gap-2">
                  <button type="button" onClick={() => setEditing(p)} className="btn btn-ghost btn-sm">編集</button>
                  <button type="button" onClick={() => handleDelete(p)} className="btn btn-ghost btn-sm" style={{ color: "#dc2626" }}>削除</button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── 作成/編集フォーム ───────────────────────────────────
function XPostForm({
  oaId, workId, post, onCancel, onSaved, showToast,
}: {
  oaId: string;
  workId: string;
  post: XPost | null;
  onCancel: () => void;
  onSaved: () => void;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  void oaId;
  const isNew = post === null;
  const [title, setTitle]       = useState(post?.title ?? "");
  const [body, setBody]         = useState(post?.body ?? "");
  const [hashtags, setHashtags] = useState<string[]>(post?.hashtags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [imageUrl, setImageUrl] = useState(post?.image_url ?? "");
  const [uploadedImageUrl, setUploadedImageUrl] = useState(post?.uploaded_image_url ?? "");
  const [linkUrl, setLinkUrl]   = useState(post?.link_url ?? "");
  const [utmEnabled, setUtmEnabled] = useState(post?.utm_enabled ?? false);
  const [utmName, setUtmName]     = useState(post?.utm_name ?? "");
  const [utmSource, setUtmSource] = useState(post?.utm_source ?? "x");
  const [utmMedium, setUtmMedium] = useState(post?.utm_medium ?? "social");
  const [utmCampaign, setUtmCampaign] = useState(post?.utm_campaign ?? workId);
  const [utmContent, setUtmContent]   = useState(post?.utm_content ?? (post?.title ?? ""));
  const [utmTerm, setUtmTerm]     = useState(post?.utm_term ?? "");
  const [generatedUrl, setGeneratedUrl] = useState(post?.generated_url ?? "");
  const [status, setStatus]       = useState<XPostStatus>(post?.status ?? "draft");
  const [postedAt, setPostedAt]   = useState(toLocalInput(post?.posted_at));
  const [xPostUrl, setXPostUrl]   = useState(post?.x_post_url ?? "");
  const [note, setNote]           = useState(post?.note ?? "");
  const [saving, setSaving]       = useState(false);
  const [copied, setCopied]       = useState<string | null>(null);

  function addTagsFromInput() {
    const next = parseHashtagsInput(tagInput);
    if (next.length) setHashtags((cur) => Array.from(new Set([...cur, ...next])));
    setTagInput("");
  }

  function handleGenerateUtm() {
    const url = buildUtmUrl(linkUrl, { source: utmSource, medium: utmMedium, campaign: utmCampaign, content: utmContent, term: utmTerm });
    if (!url) { showToast("遷移先URLが不正です（http/httpsのURLを入力）", "error"); return; }
    setGeneratedUrl(url);
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const payload: CreateXPostBody = {
      title: title.trim() || null,
      body: body.trim() || null,
      hashtags,
      image_url: imageUrl.trim() || null,
      uploaded_image_url: uploadedImageUrl.trim() || null,
      link_url: linkUrl.trim() || null,
      utm_enabled: utmEnabled,
      utm_name: utmName.trim() || null,
      utm_source: utmSource.trim() || null,
      utm_medium: utmMedium.trim() || null,
      utm_campaign: utmCampaign.trim() || null,
      utm_content: utmContent.trim() || null,
      utm_term: utmTerm.trim() || null,
      generated_url: generatedUrl.trim() || null,
      x_post_url: xPostUrl.trim() || null,
      status,
      note: note.trim() || null,
      posted_at: postedAt ? new Date(postedAt).toISOString() : null,
    };
    try {
      const res = await fetch(
        isNew ? `/api/works/${workId}/x-posts` : `/api/works/${workId}/x-posts/${post!.id}`,
        { method: isNew ? "POST" : "PATCH", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
      if (!res.ok) { showToast("保存に失敗しました", "error"); return; }
      showToast(isNew ? "X投稿を作成しました（計測URLを発行しました）" : "保存しました", "success");
      onSaved();
    } catch {
      showToast("保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  const previewImage = uploadedImageUrl.trim() || imageUrl.trim();
  const lbl = "block text-[12px] font-semibold text-ink-2 mb-1";

  return (
    <div className="w-full max-w-[680px] rounded-card border border-line bg-surface p-5 shadow-sm">
      <p className="mb-4 text-[14px] font-bold text-ink">{isNew ? "新規X投稿" : "X投稿を編集"}</p>

      <div className="flex flex-col gap-4">
        {/* 投稿タイトル / 本文 */}
        <div><label className={lbl}>投稿タイトル</label>
          <input className="form-input w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="例: 初回告知" /></div>
        <div><label className={lbl}>投稿本文</label>
          <textarea className="form-input w-full" style={{ minHeight: 90 }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="告知文を入力" /></div>

        {/* ハッシュタグ */}
        <div>
          <label className={lbl}>ハッシュタグ（任意）</label>
          {hashtags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {hashtags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2 py-0.5 text-[12px] text-sky-ink">
                  {t}
                  <button type="button" onClick={() => setHashtags((cur) => cur.filter((x) => x !== t))} aria-label={`${t} を削除`} className="text-sky-ink/70 hover:text-sky-ink">×</button>
                </span>
              ))}
            </div>
          )}
          <input
            className="form-input w-full" value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTagsFromInput(); } }}
            onBlur={addTagsFromInput}
            placeholder="例: WhaleStudio LINE謎解き（スペース/改行区切り・#は自動補完）"
          />
        </div>

        {/* 画像 */}
        <div>
          <label className={lbl}>画像（アップロード）</label>
          <ImageUploadField
            value={uploadedImageUrl}
            onChange={(next) => setUploadedImageUrl(next)}
            accept="image/jpeg,image/png,image/webp"
            supportedFormatsText="JPEG / PNG / WebP（最大 5MB）"
            previewMaxHeight={140}
          />
          <div className="mt-2">
            <label className={lbl}>画像URL（外部・任意）</label>
            <input className="form-input w-full font-mono text-[12px]" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://example.com/image.png" />
            <p className="mt-1 text-[11px] text-ink-3">アップロード画像と画像URLの両方がある場合は、アップロード画像を優先します。</p>
          </div>
          {previewImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewImage} alt="プレビュー" className="mt-2 max-h-[140px] rounded border border-line object-contain" onError={(e) => { (e.currentTarget.style.display = "none"); }} />
          )}
        </div>

        {/* 遷移先URL + UTM */}
        <div className="rounded-field border border-line bg-bg-tint p-3">
          <label className={lbl}>遷移先URL</label>
          <input className="form-input w-full font-mono text-[12px]" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://app.whale-studio.app/liff/..." />
          <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-ink">
            <input type="checkbox" checked={utmEnabled} onChange={(e) => setUtmEnabled(e.target.checked)} />
            UTM を付与する
          </label>
          {utmEnabled && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div><label className={lbl}>utm_source</label><input className="form-input w-full" value={utmSource} onChange={(e) => setUtmSource(e.target.value)} /></div>
              <div><label className={lbl}>utm_medium</label><input className="form-input w-full" value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} /></div>
              <div><label className={lbl}>utm_campaign</label><input className="form-input w-full" value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} /></div>
              <div><label className={lbl}>utm_content</label><input className="form-input w-full" value={utmContent} onChange={(e) => setUtmContent(e.target.value)} /></div>
              <div><label className={lbl}>utm_term（任意）</label><input className="form-input w-full" value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} /></div>
              <div><label className={lbl}>UTM名称（管理用・URLに含まれません）</label><input className="form-input w-full" value={utmName} onChange={(e) => setUtmName(e.target.value)} placeholder="例: 初回告知" /></div>
              <div className="sm:col-span-2">
                <p className="mb-1 text-[11px] text-warn">遷移先URLに既存のUTMがある場合は上書きされます。</p>
                <button type="button" onClick={handleGenerateUtm} className="btn btn-ghost btn-sm">UTM付きURLを生成</button>
                {generatedUrl && (
                  <div className="mt-2">
                    <input readOnly value={generatedUrl} onFocus={(e) => e.currentTarget.select()} className="form-input w-full font-mono text-[12px]" />
                    <button type="button" onClick={() => copy(generatedUrl, "gen")} className="btn btn-ghost btn-sm mt-1">{copied === "gen" ? "コピーしました!" : "コピー"}</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 計測URL（保存後に発行） */}
        {!isNew && post?.tracking_url && (
          <div>
            <label className={lbl}>Whale Studio 計測URL</label>
            <input readOnly value={post.tracking_url} onFocus={(e) => e.currentTarget.select()} className="form-input w-full font-mono text-[12px]" />
            <div className="mt-1 flex items-center gap-2">
              <button type="button" onClick={() => copy(post.tracking_url!, "track")} className="btn btn-ghost btn-sm">{copied === "track" ? "コピーしました!" : "コピー"}</button>
              <span className="text-[11px] text-ink-3">この計測URLをXに投稿してください。クリック数は参考値です（Bot等を含む場合があります）。</span>
            </div>
          </div>
        )}
        {isNew && <p className="text-[11px] text-ink-3">保存すると計測URL（/r/...）が自動発行されます。</p>}

        {/* ステータス / 投稿日時 / X投稿URL / メモ */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>投稿ステータス</label>
            <select className="form-input w-full" value={status} onChange={(e) => setStatus(e.target.value as XPostStatus)}>
              {(["draft", "scheduled", "posted", "archived"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select></div>
          <div><label className={lbl}>投稿日時</label>
            <input type="datetime-local" className="form-input w-full" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} /></div>
        </div>
        <div><label className={lbl}>X投稿URL（投稿後に貼り付け・任意）</label>
          <input className="form-input w-full font-mono text-[12px]" value={xPostUrl} onChange={(e) => setXPostUrl(e.target.value)} placeholder="https://x.com/..." /></div>
        <div><label className={lbl}>メモ（任意）</label>
          <textarea className="form-input w-full" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></div>

        {/* 本文プレビュー（本文 + ハッシュタグ） */}
        {(body.trim() || hashtags.length > 0) && (
          <div className="rounded-field border border-line bg-bg-tint p-3">
            <div className="mb-1 text-[11px] font-semibold text-ink-3">投稿プレビュー</div>
            <p className="whitespace-pre-wrap text-[13px] text-ink">{body}{hashtags.length > 0 ? `\n\n${hashtags.join(" ")}` : ""}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-line-2 pt-4">
          <button type="button" onClick={onCancel} className="btn btn-ghost">キャンセル</button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary">{saving ? "保存中…" : "保存する"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 流入分析タブ（PR2）──────────────────────────────────
function fmtCvr(cvr: number | null): string {
  if (cvr === null) return "-";
  return `${(cvr * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function InflowTab({ workId }: { workId: string }) {
  const [data, setData] = useState<XPostAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/works/${workId}/x-posts/analytics`, { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => { if (!cancelled) setData(j?.data ?? null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workId]);

  const notice = (
    <div className="rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[12px] leading-[1.6] text-sky-ink">
      Whale Studioで発行した計測URLのクリックと作品内行動をもとに分析します。X APIは使用しないため、X上のインプレッションやいいね数は自動取得しません。
    </div>
  );

  if (loading) {
    return <div className="flex flex-col gap-3">{notice}<div className="card" style={{ padding: 20 }}><div className="skeleton" style={{ height: 16, width: 200 }} /></div></div>;
  }
  if (!data) {
    return <div className="flex flex-col gap-3">{notice}<div className="alert alert-error">流入分析の読み込みに失敗しました。</div></div>;
  }

  const s = data.summary;

  // empty states
  if (s.tracking_issued_count === 0) {
    return (
      <div className="flex flex-col gap-3">
        {notice}
        <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
          流入分析を始めるには、X投稿ごとに計測URLを発行してください。
        </div>
      </div>
    );
  }
  if (s.total_clicks === 0) {
    return (
      <div className="flex flex-col gap-3">
        {notice}
        <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
          まだクリックデータがありません。X投稿で計測URLを発行し、そのURLを投稿に利用してください。
        </div>
      </div>
    );
  }

  const cards: { label: string; value: string }[] = [
    { label: "投稿数", value: String(s.post_count) },
    { label: "計測URL発行済み", value: String(s.tracking_issued_count) },
    { label: "合計URLクリック数", value: s.total_clicks.toLocaleString() },
    { label: "ユニーククリック数", value: s.total_unique_clicks.toLocaleString() },
    { label: "CV数", value: String(s.total_cv) },
    { label: "平均CVR", value: fmtCvr(s.avg_cvr) },
    { label: "最終クリック", value: fmtDate(s.last_clicked_at) },
  ];

  return (
    <div className="flex flex-col gap-4">
      {notice}

      <p className="text-[11px] text-ink-3">
        ※ CV数はクリックと作品開始/CVを紐づける計測（attribution）が未実装のため現在は 0 です（今後の対応で実値化予定）。クリック数は参考値です（Bot等を含む場合があります）。
      </p>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-card border border-line bg-surface px-4 py-3">
            <div className="text-[11px] text-ink-3">{c.label}</div>
            <div className="mt-0.5 text-[18px] font-extrabold text-ink">{c.value}</div>
          </div>
        ))}
      </div>

      {/* CVRランキング（上位5） */}
      <div className="rounded-card border border-line bg-surface p-4">
        <p className="mb-2 text-[13px] font-bold text-ink">CVRランキング（上位5件）</p>
        <div className="flex flex-col gap-1.5">
          {data.ranking.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-[12px]">
              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-bg-tint font-bold text-ink-2">{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{r.title || "無題のX投稿"}</span>
              <span className="flex-shrink-0 font-bold text-ink">{fmtCvr(r.cvr)}</span>
              <span className="flex-shrink-0 text-ink-3">CV {r.cv_count} / クリック {r.click_count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 投稿別テーブル */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-ink-3">
              {["投稿タイトル", "本文冒頭", "X投稿URL", "計測URL", "クリック", "ユニーク", "CV", "CVR", "最終クリック"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-line-2 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink">{r.title || "無題のX投稿"}</td>
                <td className="px-3 py-2 text-ink-2 max-w-[200px] truncate">{r.body_excerpt || "-"}</td>
                <td className="px-3 py-2">{r.x_post_url ? <a href={r.x_post_url} target="_blank" rel="noopener noreferrer" className="text-sky-ink underline">開く</a> : "-"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-3 max-w-[200px] truncate">{r.tracking_url || "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.click_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.unique_click_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.cv_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCvr(r.cvr)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-3">{fmtDate(r.last_clicked_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 感情分析タブ（PR3）──────────────────────────────────
function fmtPct(v: number | null): string {
  return v === null ? "-" : `${(v * 100).toFixed(1)}%`;
}
const SENT_LABEL: Record<string, string> = { positive: "ポジティブ", neutral: "ニュートラル", negative: "ネガティブ", unknown: "不明" };
const REPEAT_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低", unknown: "不明" };

function SentimentTab({ workId, canEdit }: { workId: string; canEdit: boolean }) {
  const { showToast } = useToast();
  const [data, setData] = useState<XPostSentiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [importType, setImportType] = useState<"metrics" | "mentions" | "x_export">("mentions");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/works/${workId}/x-posts/sentiment`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      setData(res.ok ? (j?.data ?? null) : null);
    } catch { setData(null); } finally { setLoading(false); }
  }, [workId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setRows([]);
    const { rows: parsed, error, warnings } = await parseImportFile(file, importType);
    if (error) { showToast(error, "error"); setFileName(""); return; }
    warnings.forEach((w) => showToast(w, "info"));
    setRows(parsed);
  }

  async function handleImport() {
    if (rows.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/works/${workId}/x-posts/import`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type: importType, rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error?.message ?? "インポートに失敗しました", "error"); return; }
      const r = j.data as { imported: number; skipped: number; errors: number };
      showToast(`インポート完了: 成功 ${r.imported} / スキップ ${r.skipped} / エラー ${r.errors}`, "success");
      setRows([]); setFileName("");
      fetchData();
    } catch { showToast("インポートに失敗しました", "error"); } finally { setBusy(false); }
  }

  async function handleAnalyze() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/works/${workId}/x-posts/analyze`, { method: "POST", headers: { ...getAuthHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast("分析に失敗しました", "error"); return; }
      showToast(`感情分析を実行しました（${j.data?.analyzed ?? 0}件）`, "success");
      fetchData();
    } catch { showToast("分析に失敗しました", "error"); } finally { setBusy(false); }
  }

  const notice = (
    <div className="flex flex-col gap-2">
      <div className="rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[12px] leading-[1.6] text-sky-ink">
        CSVまたはExcelで取り込んだ投稿実績や口コミテキストをもとに、インプレッション、頻出単語、ポジネガ、リピート欲求を分析します。
      </div>
    </div>
  );

  // CSV インポートカード（editor のみ）
  const importCard = canEdit && (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="mb-1 text-[13px] font-bold text-ink">CSV / Excelでインポート</p>
      <p className="mb-1 text-[11px] text-ink-3">Xアナリティクス等から取得したファイルや、手元で整理した口コミファイルを取り込んで分析できます（CSV: UTF-8 / BOM 両対応、Excel: .xlsx の1枚目シート）。</p>
      <p className="mb-3 text-[11px] text-ink-3">対応フォーマット: <span className="font-semibold">投稿実績ファイル</span> / <span className="font-semibold">口コミファイル</span> / <span className="font-semibold">X投稿エクスポート</span>（tweetText / tweetURL / views / likeCount などの列を含むファイルを読み込み、投稿実績と口コミ分析の両方に反映します）。</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={importType} onChange={(e) => { setImportType(e.target.value as "metrics" | "mentions" | "x_export"); setRows([]); setFileName(""); }} className="form-input" style={{ width: "auto" }}>
          <option value="mentions">口コミファイル</option>
          <option value="metrics">投稿実績ファイル</option>
          <option value="x_export">X投稿エクスポート</option>
        </select>
        <label className="btn btn-ghost btn-sm cursor-pointer">
          CSVまたはExcelファイルを選択
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span className="text-[11px] text-ink-3">{fileName}（{rows.length}行）</span>}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        {importType === "mentions"
          ? "必須列: text または tweetText ／ 任意: postedAt, authorName, authorHandle, url, source, note, relatedXPostUrl"
          : importType === "metrics"
          ? "必須列: (xPostUrl または xPostId) と impressions ／ 任意: postTitle, postedAt, likes, reposts, replies, quotes, bookmarks, urlClicks, note"
          : "tweetText / tweetURL / views / likeCount などの列を含むファイルを読み込み、投稿実績と口コミ分析の両方に反映します。本文は tweetText（または text）を使用します。（必須: tweetText または text）"}
      </p>
      {rows.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-ink-2">プレビュー（先頭5行）</div>
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-left text-[11px]">
              <thead><tr className="border-b border-line text-ink-3">{Object.keys(rows[0]).slice(0, 8).map((k) => <th key={k} className="whitespace-nowrap px-2 py-1">{k}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-line-2 last:border-0">
                    {Object.keys(rows[0]).slice(0, 8).map((k) => <td key={k} className="max-w-[160px] truncate px-2 py-1 text-ink-2">{String(r[k] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={handleImport} disabled={busy} className="btn btn-primary btn-sm mt-2">{busy ? "インポート中…" : "インポート実行"}</button>
        </div>
      )}
    </div>
  );

  if (loading) return <div className="flex flex-col gap-3">{notice}{importCard}<div className="card" style={{ padding: 20 }}><div className="skeleton" style={{ height: 16, width: 200 }} /></div></div>;
  if (!data) return <div className="flex flex-col gap-3">{notice}{importCard}<div className="alert alert-error">感情分析の読み込みに失敗しました。</div></div>;

  const s = data.summary;
  const hasAny = s.mention_count > 0 || s.metric_count > 0;

  if (!hasAny) {
    return (
      <div className="flex flex-col gap-3">
        {notice}{importCard}
        <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
          まだファイルがインポートされていません。投稿実績や口コミのCSV / Excelを取り込むと分析できます。
        </div>
      </div>
    );
  }

  const Bar = ({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) => (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-20 flex-shrink-0 text-ink-2">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-bg-tint">
        <div style={{ width: total > 0 ? `${(count / total) * 100}%` : "0%", background: tone }} className="h-full" />
      </div>
      <span className="w-24 flex-shrink-0 text-right text-ink-3">{count}（{total > 0 ? ((count / total) * 100).toFixed(0) : 0}%）</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {notice}
      {importCard}

      {canEdit && s.mention_count > 0 && (
        <div><button type="button" onClick={handleAnalyze} disabled={busy} className="btn btn-ghost btn-sm">感情分析を再実行</button></div>
      )}

      {/* サマリーカード */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          { label: "口コミ数", value: String(s.mention_count) },
          { label: "分析済み口コミ", value: String(s.analyzed_count) },
          { label: "ポジティブ率", value: fmtPct(s.positive_rate) },
          { label: "ネガティブ率", value: fmtPct(s.negative_rate) },
          { label: "リピート欲求 高 率", value: fmtPct(s.repeat_high_rate) },
          { label: "投稿実績数", value: String(s.metric_count) },
          { label: "合計インプレッション", value: s.total_impressions.toLocaleString() },
          { label: "平均インプレッション", value: s.avg_impressions.toLocaleString() },
          { label: "CSV URLクリック率", value: fmtPct(s.csv_url_click_rate) },
          { label: "インプレッションCVR", value: fmtPct(s.impression_cvr) },
        ].map((c) => (
          <div key={c.label} className="rounded-card border border-line bg-surface px-4 py-3">
            <div className="text-[11px] text-ink-3">{c.label}</div>
            <div className="mt-0.5 text-[18px] font-extrabold text-ink">{c.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-ink-3">
        ※ インプレッションはCSVまたはExcelで取り込まれた値です。Xから自動取得された値ではありません。CV数は attribution 未実装のため現在 0 です。
      </p>

      {/* ポジネガ / リピート */}
      {s.mention_count > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="mb-2 text-[13px] font-bold text-ink">ポジネガ分析</p>
            <div className="flex flex-col gap-1.5">
              <Bar label="ポジティブ" count={data.sentiment_counts.positive} total={s.mention_count} tone="#86b89a" />
              <Bar label="ニュートラル" count={data.sentiment_counts.neutral} total={s.mention_count} tone="#cbd5e1" />
              <Bar label="ネガティブ" count={data.sentiment_counts.negative} total={s.mention_count} tone="#d6a3a3" />
              <Bar label="不明" count={data.sentiment_counts.unknown} total={s.mention_count} tone="#e5e7eb" />
            </div>
            {data.representative.positive.length > 0 && (
              <div className="mt-3 text-[11px] text-ink-3"><span className="font-semibold">代表（ポジティブ）:</span> {data.representative.positive[0]}</div>
            )}
            {data.representative.negative.length > 0 && (
              <div className="mt-1 text-[11px] text-ink-3"><span className="font-semibold">代表（ネガティブ）:</span> {data.representative.negative[0]}</div>
            )}
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="mb-2 text-[13px] font-bold text-ink">リピート欲求分析</p>
            <div className="flex flex-col gap-1.5">
              <Bar label="高" count={data.repeat_counts.high} total={s.mention_count} tone="#86b89a" />
              <Bar label="中" count={data.repeat_counts.medium} total={s.mention_count} tone="#bcd0c4" />
              <Bar label="低" count={data.repeat_counts.low} total={s.mention_count} tone="#cbd5e1" />
              <Bar label="不明" count={data.repeat_counts.unknown} total={s.mention_count} tone="#e5e7eb" />
            </div>
            {data.representative.repeat_high.length > 0 && (
              <div className="mt-3 text-[11px] text-ink-3"><span className="font-semibold">代表（高）:</span> {data.representative.repeat_high[0]}</div>
            )}
            {data.repeat_high_ranking.length > 0 && (
              <div className="mt-2 text-[11px] text-ink-3">
                <span className="font-semibold">高リピート表現:</span> {data.repeat_high_ranking.map((r) => `${r.expr}(${r.count})`).join(" / ")}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface px-5 py-8 text-center text-[12px] text-ink-3">
          口コミファイルをインポートすると、頻出単語・ポジネガ・リピート欲求を分析できます。
        </div>
      )}

      {/* 頻出単語 */}
      {data.frequent_words.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="mb-2 text-[13px] font-bold text-ink">頻出単語ランキング</p>
          <div className="flex flex-wrap gap-1.5">
            {data.frequent_words.map((w) => (
              <span key={w.word} className="inline-flex items-center gap-1 rounded-full bg-bg-tint px-2 py-0.5 text-[12px] text-ink-2">
                {w.word}<span className="text-ink-3">{w.count}回 / {w.mentionCount}件</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 投稿実績テーブル */}
      {data.metric_rows.length > 0 && (
        <div>
          <p className="mb-1 text-[13px] font-bold text-ink">投稿実績（ファイルインポート）</p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-left text-[12px]">
              <thead><tr className="border-b border-line text-[11px] text-ink-3">
                {["投稿タイトル", "X投稿URL", "投稿日時", "インプレッション", "CSV URLクリック", "CSV URLクリック率", "WSクリック", "CV", "インプCVR", "いいね", "RP", "返信", "引用", "BM", "取込日時"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {data.metric_rows.map((m) => (
                  <tr key={m.id} className="border-b border-line-2 last:border-0">
                    <td className="px-2 py-2 font-semibold text-ink max-w-[160px] truncate">{m.post_title || "-"}</td>
                    <td className="px-2 py-2">{m.x_post_url ? <a href={m.x_post_url} target="_blank" rel="noopener noreferrer" className="text-sky-ink underline">開く</a> : "-"}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-ink-3">{fmtDate(m.posted_at)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.impressions > 0 ? m.impressions.toLocaleString() : "-"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.csv_url_clicks.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtPct(m.csv_url_click_rate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.ws_click_count.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.cv_count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtPct(m.impression_cvr)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.likes}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.reposts}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.replies}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.quotes}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m.bookmarks}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-ink-3">{fmtDate(m.imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 口コミテーブル */}
      {data.mention_rows.length > 0 && (
        <div>
          <p className="mb-1 text-[13px] font-bold text-ink">口コミ（ファイルインポート）</p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-left text-[12px]">
              <thead><tr className="border-b border-line text-[11px] text-ink-3">
                {["投稿日時", "本文", "URL", "関連X投稿", "感情", "リピート", "source", "取込日時"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {data.mention_rows.map((m) => {
                  const open = expanded.has(m.id);
                  const short = m.text.length > 60 && !open ? m.text.slice(0, 60) + "…" : m.text;
                  return (
                    <tr key={m.id} className="border-b border-line-2 last:border-0 align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-ink-3">{fmtDate(m.posted_at)}</td>
                      <td className="px-2 py-2 text-ink max-w-[280px] whitespace-pre-wrap">
                        {short}
                        {m.text.length > 60 && (
                          <button type="button" onClick={() => setExpanded((cur) => { const n = new Set(cur); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} className="ml-1 text-sky-ink underline">{open ? "閉じる" : "全文"}</button>
                        )}
                      </td>
                      <td className="px-2 py-2">{m.url ? <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sky-ink underline">開く</a> : "-"}</td>
                      <td className="px-2 py-2 max-w-[120px] truncate text-ink-3">{m.related_x_post_url || "-"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{SENT_LABEL[m.sentiment] ?? m.sentiment}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{REPEAT_LABEL[m.repeat_intent] ?? m.repeat_intent}</td>
                      <td className="px-2 py-2 text-ink-3">{m.source || "-"}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-ink-3">{fmtDate(m.imported_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** ISO 文字列 → datetime-local 入力値（ローカル時刻 YYYY-MM-DDTHH:mm）。 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
