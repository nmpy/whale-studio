"use client";

import DurationInput from "@/components/DurationInput";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { TLink as Link } from "@/components/TLink";
import { workApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PublishStatus } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { BUILTIN_PRESETS, presetToFormValues } from "@/lib/timing-presets";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import type { MessageTimingConfig } from "@/types";

// ── 定数 ──────────────────────────────────────────
const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

const READ_RECEIPT_MODE_OPTIONS = [
  { value: "",              label: "継承（デフォルト）" },
  { value: "immediate",     label: "即時" },
  { value: "delayed",       label: "遅延" },
  { value: "before_reply",  label: "返信直前" },
] as const;

const BOOL_INHERIT_OPTIONS = [
  { value: "",      label: "継承" },
  { value: "true",  label: "ON" },
  { value: "false", label: "OFF" },
] as const;

// ── 型 ────────────────────────────────────────────
interface WorkForm {
  title:          string;
  description:    string;
  publish_status: PublishStatus;
  sort_order:     number;
}

interface TimingForm {
  read_receipt_mode:    string;
  read_delay_ms:        string;
  typing_enabled:       string;
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string;
  loading_threshold_ms: string;
  loading_min_seconds:  string;
  loading_max_seconds:  string;
}

const EMPTY_TIMING: TimingForm = {
  read_receipt_mode: "", read_delay_ms: "",
  typing_enabled: "", typing_min_ms: "", typing_max_ms: "",
  loading_enabled: "", loading_threshold_ms: "", loading_min_seconds: "", loading_max_seconds: "",
};

// ── スタイル ──────────────────────────────────────
const miniLabel: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "#6b7280", marginBottom: 2 };
const hintText: React.CSSProperties  = { fontSize: 11, color: "#9ca3af", marginTop: 3 };
const miniInput: React.CSSProperties = { maxWidth: 120 };
const inlineRow: React.CSSProperties = { display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" };

// ── メインコンポーネント ─────────────────────────
export default function WorkEditPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { role, canEdit } = useWorkspaceRole(oaId);
  const router  = useRouter();
  const { showToast } = useToast();

  const [workForm, setWorkForm]       = useState<WorkForm | null>(null);
  const [timingForm, setTimingForm]   = useState<TimingForm>(EMPTY_TIMING);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [workErrors, setWorkErrors]   = useState<Record<string, string[]>>({});
  const [savingWork, setSavingWork]   = useState(false);
  const [savingTiming, setSavingTiming] = useState(false);
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
      setTimingForm({
        read_receipt_mode:    w.read_receipt_mode ?? "",
        read_delay_ms:        w.read_delay_ms != null ? String(w.read_delay_ms) : "",
        typing_enabled:       w.typing_enabled != null ? String(w.typing_enabled) : "",
        typing_min_ms:        w.typing_min_ms != null ? String(w.typing_min_ms) : "",
        typing_max_ms:        w.typing_max_ms != null ? String(w.typing_max_ms) : "",
        loading_enabled:      w.loading_enabled != null ? String(w.loading_enabled) : "",
        loading_threshold_ms: w.loading_threshold_ms != null ? String(w.loading_threshold_ms) : "",
        loading_min_seconds:  w.loading_min_seconds != null ? String(w.loading_min_seconds) : "",
        loading_max_seconds:  w.loading_max_seconds != null ? String(w.loading_max_seconds) : "",
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "作品の読み込みに失敗しました");
    }
  }, [workId]);

  useEffect(() => { loadWork(); }, [loadWork]);

  // ── 作品情報保存 ───────────────────────────────
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

  // ── 演出設定保存 ───────────────────────────────
  function setTiming<K extends keyof TimingForm>(key: K, val: TimingForm[K]) {
    setTimingForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSaveTiming(e: React.FormEvent) {
    e.preventDefault();
    setSavingTiming(true);
    try {
      await workApi.update(getDevToken(), workId, {
        read_receipt_mode:    (timingForm.read_receipt_mode || null) as import("@/types").ReadReceiptMode | null,
        read_delay_ms:        timingForm.read_delay_ms ? Number(timingForm.read_delay_ms) : null,
        typing_enabled:       timingForm.typing_enabled === "true" ? true : timingForm.typing_enabled === "false" ? false : null,
        typing_min_ms:        timingForm.typing_min_ms ? Number(timingForm.typing_min_ms) : null,
        typing_max_ms:        timingForm.typing_max_ms ? Number(timingForm.typing_max_ms) : null,
        loading_enabled:      timingForm.loading_enabled === "true" ? true : timingForm.loading_enabled === "false" ? false : null,
        loading_threshold_ms: timingForm.loading_threshold_ms ? Number(timingForm.loading_threshold_ms) : null,
        loading_min_seconds:  timingForm.loading_min_seconds ? Number(timingForm.loading_min_seconds) : null,
        loading_max_seconds:  timingForm.loading_max_seconds ? Number(timingForm.loading_max_seconds) : null,
      });
      showToast("演出設定を保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingTiming(false);
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
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
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
      <ViewerBanner role={role} />
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{workForm!.title}</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/oas/${oaId}/works/${workId}/dashboard`} className="btn btn-ghost">
            ダッシュボード
          </Link>
          {canEdit && (
            <button
              className="btn btn-ghost"
              disabled={duplicating}
              onClick={handleDuplicate}
            >
              {duplicating ? <><span className="spinner" /> 複製中...</> : "複製"}
            </button>
          )}
        </div>
      </div>

      {/* ══ 作品情報フォーム ══ */}
      <div className="card" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSaveWork}>
          <div className="form-group">
            <label htmlFor="work-title">作品名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="work-title" type="text" value={workForm!.title}
              onChange={(e) => setWorkField("title", e.target.value)} maxLength={100} readOnly={!canEdit} />
            {workErrors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>
          <div className="form-group">
            <label htmlFor="work-desc">説明（任意）</label>
            <textarea id="work-desc" value={workForm!.description}
              onChange={(e) => setWorkField("description", e.target.value)} maxLength={500} readOnly={!canEdit} />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label>公開ステータス</label>
              <div className="radio-group" style={{ flexDirection: "column", gap: 4 }}>
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <label key={value}>
                    <input type="radio" name="work-status" value={value}
                      checked={workForm!.publish_status === value}
                      onChange={() => setWorkField("publish_status", value)}
                      disabled={!canEdit} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ flexShrink: 0 }}>
              <label htmlFor="work-sort">表示順</label>
              <input id="work-sort" type="number" value={workForm!.sort_order}
                onChange={(e) => setWorkField("sort_order", Number(e.target.value))}
                min={0} style={{ width: 100 }} disabled={!canEdit} />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!canEdit || savingWork}>
              {savingWork && <span className="spinner" />}
              {!canEdit ? "閲覧専用" : savingWork ? "保存中..." : "作品情報を保存"}
            </button>
          </div>
        </form>
      </div>

      {/* ══ 演出デフォルト設定 ══ */}
      <WorkTimingSection
        form={timingForm}
        set={setTiming}
        canEdit={canEdit}
        saving={savingTiming}
        onSave={handleSaveTiming}
      />
    </>
  );
}

  // ─────────────────────────
  //  作品単位の演出設定セクション
  // ─────────────────────────

function WorkTimingSection({
  form, set, canEdit, saving, onSave,
}: {
  form: TimingForm;
  set: <K extends keyof TimingForm>(key: K, val: TimingForm[K]) => void;
  canEdit: boolean;
  saving: boolean;
  onSave: (e: React.FormEvent) => void;
}) {
  const [open, setOpen] = useState(
    !!(form.read_receipt_mode || form.typing_enabled || form.loading_enabled),
  );

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", userSelect: "none", padding: "4px 0",
        }}
        onClick={() => setOpen(!open)}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          {open ? "▼" : "▶"} 演出デフォルト設定
        </h3>
        {!open && (form.read_receipt_mode || form.typing_enabled || form.loading_enabled) && (
          <span style={{ fontSize: 11, color: "#3b82f6" }}>設定あり</span>
        )}
      </div>

      {open && (
        <form onSubmit={onSave} style={{ marginTop: 12 }}>
          <p style={{ ...hintText, marginBottom: 12 }}>
            この作品に所属するメッセージの演出デフォルト値を設定します。
            メッセージ個別の設定が優先されます。未設定の項目は環境変数の値を継承します。
          </p>

          {/* ── プリセット ── */}
          <PresetSelector onApply={(vals) => {
            for (const [k, v] of Object.entries(vals)) set(k as keyof TimingForm, v);
          }} disabled={!canEdit} />

          {/* ── 既読 ── */}
          <div className="form-group">
            <label style={miniLabel}>既読タイミング</label>
            <select className="form-input" style={{ maxWidth: 200 }} value={form.read_receipt_mode}
              onChange={(e) => set("read_receipt_mode", e.target.value)} disabled={!canEdit}>
              {READ_RECEIPT_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {form.read_receipt_mode === "delayed" && (
          <div className="form-group">
            <label style={miniLabel}>既読遅延</label>
            <DurationInput
              valueMs={Number(form.read_delay_ms || 0)}
              onChange={(ms) => set("read_delay_ms", String(Math.min(ms, 600000)))}
            />
          </div>
          )}

          {/* ── typing ── */}
          <div className="form-group">
            <label style={miniLabel}>typing 風の間</label>
            <select className="form-input" style={{ maxWidth: 120 }} value={form.typing_enabled}
              onChange={(e) => set("typing_enabled", e.target.value)} disabled={!canEdit}>
              {BOOL_INHERIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {form.typing_enabled === "true" && (
            <div style={inlineRow}>
              <div className="form-group">
              <label style={miniLabel}>最小</label>
              <DurationInput
                valueMs={Number(form.typing_min_ms || 0)}
                onChange={(ms) => {
                const next = Math.min(ms, 600000);
                const currentMax = Number(form.typing_max_ms || 0);
                set("typing_min_ms", String(currentMax > 0 ? Math.min(next, currentMax) : next));
                  }}
                />
            </div>

              <div className="form-group">
              <label style={miniLabel}>最大</label>
              <DurationInput
                valueMs={Number(form.typing_max_ms || 0)}
                onChange={(ms) => {
                const next = Math.min(ms, 600000);
                const currentMin = Number(form.typing_min_ms || 0);
                set("typing_max_ms", String(Math.max(next, currentMin)));
                }}
                />
            </div>

          {/* ── ローディング ── */}
          <div className="form-group">
            <label style={miniLabel}>ローディングアニメーション</label>
            <select className="form-input" style={{ maxWidth: 120 }} value={form.loading_enabled}
              onChange={(e) => set("loading_enabled", e.target.value)} disabled={!canEdit}>
              {BOOL_INHERIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {form.loading_enabled === "true" && (
            <>
              <div className="form-group">
                <label style={miniLabel}>ローディング表示閾値（ms）</label>
                <input type="number" className="form-input" style={miniInput} value={form.loading_threshold_ms}
                  onChange={(e) => set("loading_threshold_ms", e.target.value)} min={0} max={30000} step={500} placeholder="3000" disabled={!canEdit} />
                <div style={hintText}>処理時間がこの値を超えたらローディング表示</div>
              </div>
              <div style={inlineRow}>
                <div className="form-group">
                  <label style={miniLabel}>最小秒数</label>
                  <input type="number" className="form-input" style={miniInput} value={form.loading_min_seconds}
                    onChange={(e) => set("loading_min_seconds", e.target.value)} min={3} max={60} step={1} placeholder="5" disabled={!canEdit} />
                </div>
                <div className="form-group">
                  <label style={miniLabel}>最大秒数</label>
                  <input type="number" className="form-input" style={miniInput} value={form.loading_max_seconds}
                    onChange={(e) => set("loading_max_seconds", e.target.value)} min={3} max={60} step={1} placeholder="15" disabled={!canEdit} />
                </div>
              </div>
            </>
          )}

          {/* ── プレビュー ── */}
          <PreviewPlayer workConfig={timingFormToConfig(form)} />

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!canEdit || saving}>
              {saving && <span className="spinner" />}
              {!canEdit ? "閲覧専用" : saving ? "保存中..." : "演出設定を保存"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// プリセットセレクター（Work / Message 共通で使える）
// ────────────────────────────────────────────────────────

function PresetSelector({
  onApply,
  disabled,
}: {
  onApply: (vals: Record<string, string>) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={miniLabel}>プリセットから適用</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {BUILTIN_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            title={p.description}
            disabled={disabled}
            onClick={() => onApply(presetToFormValues(p))}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={hintText}>ボタンをクリックするとフォームに値が反映されます（保存前に確認可能）</div>
    </div>
  );
}

/** TimingForm 文字列値を MessageTimingConfig に変換する */
function timingFormToConfig(form: {
  read_receipt_mode: string; read_delay_ms: string;
  typing_enabled: string; typing_min_ms: string; typing_max_ms: string;
  loading_enabled: string; loading_threshold_ms: string;
  loading_min_seconds: string; loading_max_seconds: string;
}): MessageTimingConfig {
  return {
    read_receipt_mode:    (form.read_receipt_mode || null) as MessageTimingConfig["read_receipt_mode"],
    read_delay_ms:        form.read_delay_ms ? Number(form.read_delay_ms) : null,
    typing_enabled:       form.typing_enabled === "true" ? true : form.typing_enabled === "false" ? false : null,
    typing_min_ms:        form.typing_min_ms ? Number(form.typing_min_ms) : null,
    typing_max_ms:        form.typing_max_ms ? Number(form.typing_max_ms) : null,
    loading_enabled:      form.loading_enabled === "true" ? true : form.loading_enabled === "false" ? false : null,
    loading_threshold_ms: form.loading_threshold_ms ? Number(form.loading_threshold_ms) : null,
    loading_min_seconds:  form.loading_min_seconds ? Number(form.loading_min_seconds) : null,
    loading_max_seconds:  form.loading_max_seconds ? Number(form.loading_max_seconds) : null,
  };
}
