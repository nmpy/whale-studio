"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { workApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PublishStatus } from "@/types";

const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

export default function WorkNewPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  const [title, setTitle]               = useState("");
  const [description, setDescription]   = useState("");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("draft");
  const [sortOrder, setSortOrder]       = useState(0);

  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const errs: Record<string, string[]> = {};
    if (!title.trim()) errs.title = ["作品名を入力してください"];
    if (title.length > 100) errs.title = ["作品名は 100 文字以内で入力してください"];
    if (Object.keys(errs).length) { setErrors(errs); setSubmitting(false); return; }

    try {
      const work = await workApi.create(getDevToken(), {
        oa_id:          oaId,
        title:          title.trim(),
        description:    description.trim() || undefined,
        publish_status: publishStatus,
        sort_order:     sortOrder,
      });
      showToast(`「${work.title}」を作成しました`, "success");
      // 作成後すぐ編集（フェーズ追加）画面へ
      router.push(`/oas/${oaId}/works/${work.id}/edit`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "作成に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "作品一覧", href: `/oas/${oaId}/works` },
            { label: "新規作成" },
          ]} />
          <h2>作品を追加</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">作品名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors((err) => { const n = { ...err }; delete n.title; return n; }); }}
              placeholder="例: 消えた宝石の謎"
              maxLength={100}
              autoFocus
            />
            {errors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="description">説明（任意）</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="作品のあらすじや対象ユーザーなど"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label>公開ステータス</label>
            <div className="radio-group">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <label key={value}>
                  <input type="radio" name="publish_status" value={value}
                    checked={publishStatus === value} onChange={() => setPublishStatus(value)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="sort_order">表示順</label>
            <input id="sort_order" type="number" value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))} min={0} style={{ width: 120 }} />
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
              数値が小さいほど一覧の先頭に表示されます
            </p>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/works`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "作成中..." : "作品を作成してフェーズ設定へ →"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
