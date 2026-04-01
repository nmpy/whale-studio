"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { oaApi, segmentApi, workApi, phaseApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import type { SegmentFilterType, PhaseWithCounts } from "@/types";

interface WorkPhases {
  workId:    string;
  workTitle: string;
  phases:    PhaseWithCounts[];
}

const FILTER_OPTIONS = [
  { value: "friend_7d",   label: "友だち追加 7 日以内",  desc: "友だち追加から7日以内のユーザー" },
  { value: "inactive_7d", label: "最終操作 7 日以上前",   desc: "最後の操作から7日以上経過したユーザー" },
  { value: "phase",       label: "フェーズ指定",          desc: "特定のフェーズにいるユーザー" },
] as const;

export default function NewSegmentPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [workPhasesList, setWorkPhasesList] = useState<WorkPhases[]>([]);

  const [form, setForm] = useState({
    name:        "",
    filter_type: "friend_7d" as SegmentFilterType,
    phase_id:    "",
    status:      "active" as "active" | "inactive",
  });

  useEffect(() => {
    const token = getDevToken();
    oaApi.get(token, oaId).then((oa) => setOaTitle(oa.title)).catch(() => {});
    // Load works + phases for phase filter
    workApi.list(token, oaId).then(async (works) => {
      const lists = await Promise.all(
        works.map((w) =>
          phaseApi.list(token, w.id).then((phases) => ({
            workId:    w.id,
            workTitle: w.title,
            phases,
          }))
        )
      );
      setWorkPhasesList(lists.filter((l) => l.phases.length > 0));
    }).catch(() => {});
  }, [oaId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { showToast("セグメント名を入力してください", "error"); return; }
    if (form.filter_type === "phase" && !form.phase_id) { showToast("フェーズを選択してください", "error"); return; }

    setSubmitting(true);
    try {
      await segmentApi.create(getDevToken(), {
        oa_id:       oaId,
        name:        form.name.trim(),
        filter_type: form.filter_type,
        phase_id:    form.filter_type === "phase" ? form.phase_id : null,
        status:      form.status,
      });
      showToast("セグメントを作成しました", "success");
      router.push(`/oas/${oaId}/audience?tab=segments`);
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
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "オーディエンス", href: `/oas/${oaId}/audience?tab=segments` },
            { label: "新規作成" },
          ]} />
          <h2>セグメントを作成</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          {/* セグメント名 */}
          <div className="form-group">
            <label htmlFor="name">セグメント名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="name" type="text" className="form-input"
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例: 未クリアユーザー" maxLength={100} />
          </div>

          {/* 絞り込み条件 */}
          <div className="form-group">
            <label>絞り込み条件 <span style={{ color: "#ef4444" }}>*</span></label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {FILTER_OPTIONS.map(({ value, label, desc }) => (
                <label key={value} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "10px 12px",
                  border: `2px solid ${form.filter_type === value ? "#06C755" : "#e5e5e5"}`,
                  borderRadius: 8, cursor: "pointer",
                  background: form.filter_type === value ? "#E6F7ED" : "#fff",
                }}>
                  <input type="radio" name="filter_type" value={value}
                    checked={form.filter_type === value}
                    onChange={() => setForm((f) => ({ ...f, filter_type: value, phase_id: "" }))}
                    style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* フェーズ選択（phase のとき表示） */}
          {form.filter_type === "phase" && (
            <div className="form-group">
              <label htmlFor="phase_id">対象フェーズ <span style={{ color: "#ef4444" }}>*</span></label>
              <select id="phase_id" className="form-input"
                value={form.phase_id} onChange={(e) => setForm((f) => ({ ...f, phase_id: e.target.value }))}>
                <option value="">— フェーズを選択 —</option>
                {workPhasesList.map(({ workId, workTitle, phases }) => (
                  <optgroup key={workId} label={workTitle}>
                    {phases.map((ph) => (
                      <option key={ph.id} value={ph.id}>{ph.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {/* 状態 */}
          <div className="form-group">
            <label>状態</label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["active", "inactive"] as const).map((s) => (
                <label key={s} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px",
                  border: `2px solid ${form.status === s ? (s === "active" ? "#06C755" : "#6b7280") : "#e5e5e5"}`,
                  borderRadius: 8, cursor: "pointer",
                  background: form.status === s ? (s === "active" ? "#E6F7ED" : "#f3f4f6") : "#fff",
                }}>
                  <input type="radio" name="status" value={s}
                    checked={form.status === s}
                    onChange={() => setForm((f) => ({ ...f, status: s }))} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s === "active" ? "有効" : "無効"}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/audience?tab=segments`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
