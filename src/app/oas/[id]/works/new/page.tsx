"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { workApi, getDevToken } from "@/lib/api-client";
import { trackEvent } from "@/lib/event-tracker";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import { TLink as Link } from "@/components/TLink";
import { useTesterRouter } from "@/hooks/useTesterRouter";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useWorkLimit } from "@/hooks/useWorkLimit";
import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";
import type { PublishStatus } from "@/types";

const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

export default function WorkNewPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useTesterRouter();
  const { showToast } = useToast();
  const { loading: roleLoading } = useWorkspaceRole(oaId);
  const { maxWorks, planDisplayName, planName, loading: limitLoading } = useWorkLimit(oaId);

  const [title, setTitle]               = useState("");
  const [description, setDescription]   = useState("");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("draft");
  const [sortOrder, setSortOrder]       = useState(0);

  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  // 作品数を取得してゲートを表示するか判定（subscription ベース）
  const [workCount,        setWorkCount]        = useState<number | null>(null);
  const [workCountLoading, setWorkCountLoading] = useState(false);

  useEffect(() => {
    // maxWorks が未取得または無制限(-1)の間は作品数の取得は不要
    if (limitLoading || maxWorks === null || maxWorks === -1) return;
    setWorkCountLoading(true);
    workApi.list(getDevToken(), oaId)
      .then((list) => setWorkCount(list.length))
      .catch(() => setWorkCount(0))
      .finally(() => setWorkCountLoading(false));
  }, [maxWorks, limitLoading, oaId]);

  // 作品数上限に達している場合のみゲート表示
  // maxWorks === null（未設定）または -1（無制限）の場合はゲートなし
  const showGate = maxWorks !== null && maxWorks !== -1 && workCount !== null && workCount >= maxWorks;

  // ゲートが確定表示になったとき upgrade_interest を記録（1回のみ）
  useEffect(() => {
    if (!showGate) return;
    trackEvent(
      "upgrade_interest",
      { action: "gate_shown", source: "gate" },
      { token: getDevToken(), oa_id: oaId },
    );
  // showGate が true になった最初の1回だけ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const errs: Record<string, string[]> = {};
    if (!title.trim()) errs.title = ["作品名を入力してください"];
    if (title.length > 100) errs.title = ["作品名は 100 文字以内で入力してください"];
    if (Object.keys(errs).length) { setErrors(errs); setSubmitting(false); return; }

    const token = getDevToken();
    try {
      const work = await workApi.create(token, {
        oa_id:          oaId,
        title:          title.trim(),
        description:    description.trim() || undefined,
        publish_status: publishStatus,
        sort_order:     sortOrder,
      });
      showToast(`「${work.title}」を作成しました`, "success");

      // 作品作成成功ログ
      trackEvent(
        "action_success",
        { action: "work_created", work_id: work.id, detail: { title: work.title } },
        { token, oa_id: oaId },
      );

      // 作成後はハブへ遷移（?created=1 で初回導線バナーを表示）
      router.push(`/oas/${oaId}/works/${work.id}?created=1`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "作成に失敗しました";
      showToast(msg, "error");

      // エラーログ
      trackEvent(
        "error",
        { message: msg, context: "work_create", code: "api_error" },
        { token, oa_id: oaId },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <div className="page-header">
      <div>
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト", href: `/oas/${oaId}/works` },
          { label: "新規作成" },
        ]} />
        <h2>作品を追加</h2>
      </div>
    </div>
  );

  // ロール確認中 / プラン確認中 / 作品数確認中はスケルトン
  if (roleLoading || limitLoading || workCountLoading) {
    return (
      <>
        {header}
        <div className="card" style={{ maxWidth: 560, padding: "28px 24px" }}>
          <div className="skeleton" style={{ width: 220, height: 14, marginBottom: 20 }} />
          <div className="skeleton" style={{ width: "100%", height: 38, borderRadius: 6, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: "100%", height: 80, borderRadius: 6, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: 160, height: 36, borderRadius: 6 }} />
        </div>
      </>
    );
  }

  // 作品上限到達 → アップグレードゲート表示
  if (showGate) {
    return (
      <>
        {header}
        <WorkLimitCard
          variant="gate"
          oaId={oaId}
          maxWorks={maxWorks ?? undefined}
          planDisplayName={planDisplayName ?? undefined}
          planName={planName ?? undefined}
        />
      </>
    );
  }

  return (
    <>
      {header}

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
