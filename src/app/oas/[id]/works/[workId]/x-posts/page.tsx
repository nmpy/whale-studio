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
import { buildUtmUrl, parseHashtagsInput } from "@/lib/x-posts/format";
import type { XPost, XPostStatus, CreateXPostBody } from "@/types";

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

      {tab === "inflow" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[12px] leading-[1.6] text-sky-ink">
            Whale Studioで発行した計測URLのクリックと作品内行動をもとに分析します。X APIは使用しないため、X上のインプレッションやいいね数は自動取得しません。
          </div>
          <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
            （次のアップデートで提供）URLクリック数・ユニーククリック数・CVR・投稿別ランキングを表示します。<br />
            まずは「X投稿」タブで計測URLを発行し、そのURLを投稿に利用してください。
          </div>
        </div>
      )}

      {tab === "sentiment" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[12px] leading-[1.6] text-sky-ink">
            CSVで取り込んだ投稿実績や口コミテキストをもとに、インプレッション、頻出単語、ポジネガ、リピート欲求を分析します。
          </div>
          <div className="rounded-card border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-3">
            （次のアップデートで提供）Xアナリティクス等のCSVや口コミCSVを取り込んで分析できます。
          </div>
        </div>
      )}
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

/** ISO 文字列 → datetime-local 入力値（ローカル時刻 YYYY-MM-DDTHH:mm）。 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
