"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { workApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PublishStatus } from "@/types";

// ── 定数 ──────────────────────────────────────────
const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

// ── 型 ────────────────────────────────────────────
interface WorkForm {
  title:          string;
  description:    string;
  publish_status: PublishStatus;
  sort_order:     number;
}

// ── メインコンポーネント ─────────────────────────
export default function WorkEditPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const router  = useRouter();
  const { showToast } = useToast();

  const [workForm, setWorkForm]     = useState<WorkForm | null>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [workErrors, setWorkErrors] = useState<Record<string, string[]>>({});
  const [savingWork, setSavingWork] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // ── データ読み込み ──────────────────────────────
  const loadWork = useCallback(async () => {
    try {
      const w = await workApi.get(getDevToken(), workId);
      setWorkForm({
        title:          w.title,
        description:    w.description ?? "",
        publish_status: w.publish_status,
        sort_order:     w.sort_order,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "作品の読み込みに失敗しました");
    }
  }, [workId]);

  useEffect(() => { loadWork(); }, [loadWork]);

  // ── 作品保存 ────────────────────────────────────
  function setWorkField<K extends keyof WorkForm>(key: K, val: WorkForm[K]) {
    setWorkForm((f) => f ? { ...f, [key]: val } : null);
    setWorkErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSaveWork(e: React.FormEvent) {
    e.preventDefault();
    if (!workForm) return;
    setSavingWork(true);
    setWorkErrors({});
    const errs: Record<string, string[]> = {};
    if (!workForm.title.trim()) errs.title = ["作品名を入力してください"];
    if (Object.keys(errs).length) { setWorkErrors(errs); setSavingWork(false); return; }
    try {
      await workApi.update(getDevToken(), workId, {
        title:          workForm.title.trim(),
        description:    workForm.description.trim() || undefined,
        publish_status: workForm.publish_status,
        sort_order:     workForm.sort_order,
      });
      showToast("作品情報を保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingWork(false);
    }
  }

  // ── 作品複製 ─────────────────────────────────────
  async function handleDuplicate() {
    if (!workForm) return;
    if (!confirm(`「${workForm.title}」を複製しますか？\nキャラクター・フェーズ・メッセージ・遷移をすべてコピーします。`)) return;
    setDuplicating(true);
    try {
      const newWork = await workApi.duplicate(getDevToken(), workId);
      showToast(`「${newWork.title}」を作成しました`, "success");
      router.push(`/oas/${oaId}/works/${newWork.id}/edit`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "複製に失敗しました", "error");
      setDuplicating(false);
    }
  }

  // ── ローディング / エラー ─────────────────────────
  const breadcrumb = (
    <Breadcrumb items={[
      { label: "OA一覧", href: "/oas" },
      { label: "作品一覧", href: `/oas/${oaId}/works` },
      ...(workForm ? [{ label: workForm.title, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "作品情報" },
    ]} />
  );

  if (!workForm && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>作品情報</h2></div>
        </div>
        <div className="card" style={{ maxWidth: 640 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>作品情報</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{workForm!.title}</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/oas/${oaId}/works/${workId}/dashboard`} className="btn btn-ghost">
            📊 ダッシュボード
          </Link>
          <button
            className="btn btn-ghost"
            disabled={duplicating}
            onClick={handleDuplicate}
          >
            {duplicating ? <><span className="spinner" /> 複製中...</> : "📋 複製"}
          </button>
        </div>
      </div>

      {/* ══ 作品情報フォーム ══ */}
      <div className="card" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSaveWork}>
          <div className="form-group">
            <label htmlFor="work-title">作品名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="work-title" type="text" value={workForm!.title}
              onChange={(e) => setWorkField("title", e.target.value)} maxLength={100} />
            {workErrors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>
          <div className="form-group">
            <label htmlFor="work-desc">説明（任意）</label>
            <textarea id="work-desc" value={workForm!.description}
              onChange={(e) => setWorkField("description", e.target.value)} maxLength={500} />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label>公開ステータス</label>
              <div className="radio-group" style={{ flexDirection: "column", gap: 4 }}>
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <label key={value}>
                    <input type="radio" name="work-status" value={value}
                      checked={workForm!.publish_status === value}
                      onChange={() => setWorkField("publish_status", value)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ flexShrink: 0 }}>
              <label htmlFor="work-sort">表示順</label>
              <input id="work-sort" type="number" value={workForm!.sort_order}
                onChange={(e) => setWorkField("sort_order", Number(e.target.value))}
                min={0} style={{ width: 100 }} />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={savingWork}>
              {savingWork && <span className="spinner" />}
              {savingWork ? "保存中..." : "作品情報を保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
