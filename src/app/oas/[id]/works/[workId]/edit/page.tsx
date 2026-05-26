"use client";

// src/app/oas/[id]/works/[workId]/edit/page.tsx
// GET   /api/works/:id          → 作品情報 + 演出デフォルト設定のプリフィル
// PATCH /api/works/:id          → 作品情報 / 演出デフォルト設定の更新 (= workApi.update)
// POST  /api/works/:id/duplicate → 作品の複製 (= workApi.duplicate)
//
// Phase 3.1: UI を Phase 0 トークン + shared/Button + shared/Accordion に揃える。
// 保存 payload / API / toast / router 遷移 / canEdit 制御 / 三値変換は完全維持。

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
import { Button, Accordion, buttonClass } from "@/components/shared";
import type { MessageTimingConfig } from "@/types";

// ── 定数 ──────────────────────────────────────────
const STATUS_OPTIONS: { value: PublishStatus; label: string; desc: string }[] = [
  { value: "draft",  label: "下書き（非公開）", desc: "公開せず編集のみ" },
  { value: "active", label: "公開中",          desc: "LINE に配信中" },
  { value: "paused", label: "停止中",          desc: "一時的に配信を停止" },
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

// ── ローカル共通: 必須マーク (= Phase 2.1 /account と同じパターンを重複定義) ──
function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-danger">*</span>;
}

// ── ローカル共通: section heading ──
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-[13px] font-bold text-ink">{children}</p>;
}

// ── 共通スタイル ──
// 行内 input / select 用 (= compact size、Phase 2.2c の compactInputClass と同パターン)
const compactInputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

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

  // ── ヘッダー (= 各 state 共通) ──
  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(workForm ? [{ label: workForm.title, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "作品情報" },
    ]} />
  );

  // ── ローディング (skeleton) ──
  if (!workForm && !loadError) {
    return (
      <>
        <div className="mb-5">
          {breadcrumb}
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            作品情報
          </h2>
        </div>
        <div className="w-full max-w-[640px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-5">
              <div className="skeleton mb-1.5" style={{ width: 100, height: 13, borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 36, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── ロードエラー ──
  if (loadError) {
    return (
      <>
        <div className="mb-5">
          {breadcrumb}
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            作品情報
          </h2>
        </div>
        <div
          role="alert"
          className="rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {loadError}
        </div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />

      {/* ── ページヘッダー ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {breadcrumb}
          <h2 className="font-round mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            {workForm!.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/oas/${oaId}/works/${workId}/dashboard`}
            className={buttonClass({ variant: "ghost", size: "md" })}
          >
            ダッシュボード
          </Link>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={duplicating}
              aria-busy={duplicating || undefined}
              onClick={handleDuplicate}
            >
              {duplicating && <span className="spinner" aria-hidden="true" />}
              {duplicating ? "複製中..." : "複製"}
            </Button>
          )}
        </div>
      </div>

      {/* ══ 作品情報フォーム ══ */}
      <div className="w-full max-w-[640px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <form onSubmit={handleSaveWork}>

          <SectionHeading>作品基本情報</SectionHeading>

          {/* title */}
          <div className="mb-5">
            <label htmlFor="work-title" className="mb-1.5 block text-[13px] font-bold text-ink">
              作品名<RequiredMark />
            </label>
            <input
              id="work-title"
              type="text"
              value={workForm!.title}
              onChange={(e) => setWorkField("title", e.target.value)}
              maxLength={100}
              readOnly={!canEdit}
              aria-required="true"
              aria-invalid={workErrors.title ? "true" : undefined}
              aria-describedby={workErrors.title ? "work-title-error" : undefined}
            />
            {workErrors.title?.map((m) => (
              <p key={m} id="work-title-error" role="alert" className="field-error">{m}</p>
            ))}
          </div>

          {/* description */}
          <div className="mb-5">
            <label htmlFor="work-desc" className="mb-1.5 block text-[13px] font-bold text-ink">
              説明（任意）
            </label>
            <textarea
              id="work-desc"
              value={workForm!.description}
              onChange={(e) => setWorkField("description", e.target.value)}
              maxLength={500}
              readOnly={!canEdit}
            />
          </div>

          {/* publish_status (カード型 radio) + sort_order */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* publish_status */}
            <div className="min-w-0 flex-1">
              <span id="work-status-label" className="mb-1.5 block text-[13px] font-bold text-ink">
                公開ステータス
              </span>
              <div
                role="radiogroup"
                aria-labelledby="work-status-label"
                className="flex flex-col gap-2"
              >
                {STATUS_OPTIONS.map(({ value, label, desc }) => {
                  const selected = workForm!.publish_status === value;
                  return (
                    <label
                      key={value}
                      className={
                        "flex items-start gap-2.5 rounded-field border-2 px-3 py-2.5 transition-colors " +
                        (canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-70") + " " +
                        (selected
                          ? "border-brand bg-brand-soft"
                          : "border-line bg-surface " + (canEdit ? "hover:bg-bg-tint" : ""))
                      }
                    >
                      <input
                        type="radio"
                        name="work-status"
                        value={value}
                        checked={selected}
                        onChange={() => setWorkField("publish_status", value)}
                        disabled={!canEdit}
                        className="mt-[3px] accent-brand"
                      />
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-ink">{label}</div>
                        <div className="text-[12px] text-ink-2">{desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* sort_order */}
            <div className="sm:flex-shrink-0">
              <label htmlFor="work-sort" className="mb-1.5 block text-[13px] font-bold text-ink">
                表示順
              </label>
              <input
                id="work-sort"
                type="number"
                value={workForm!.sort_order}
                onChange={(e) => setWorkField("sort_order", Number(e.target.value))}
                min={0}
                disabled={!canEdit}
                className={compactInputClass + " w-[120px]"}
              />
            </div>
          </div>

          {/* form actions */}
          <div className="mt-7 flex flex-col-reverse items-stretch gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!canEdit || savingWork}
              aria-busy={savingWork || undefined}
            >
              {savingWork && <span className="spinner" aria-hidden="true" />}
              {!canEdit ? "閲覧専用" : savingWork ? "保存中..." : "作品情報を保存"}
            </Button>
          </div>
        </form>
      </div>

      {/* ══ 演出デフォルト設定 (= shared/Accordion) ══ */}
      <div className="mt-4 w-full max-w-[640px]">
        <WorkTimingSection
          form={timingForm}
          set={setTiming}
          canEdit={canEdit}
          saving={savingTiming}
          onSave={handleSaveTiming}
        />
      </div>
    </>
  );
}

// ─────────────────────────
// 作品単位の演出設定セクション
// ─────────────────────────

type WorkTimingSectionProps = {
  form: TimingForm;
  set: (key: keyof TimingForm, val: TimingForm[keyof TimingForm]) => void;
  canEdit: boolean;
  saving: boolean;
  onSave: (e: React.FormEvent) => void;
};

function WorkTimingSection({
  form,
  set,
  canEdit,
  saving,
  onSave,
}: WorkTimingSectionProps) {
  // 既存挙動踏襲: 何らかの設定があれば初期 open
  const hasInitialConfig = !!(form.read_receipt_mode || form.typing_enabled || form.loading_enabled);

  return (
    <Accordion
      title="演出デフォルト設定"
      summary={hasInitialConfig ? "設定済み" : "未設定"}
      defaultOpen={hasInitialConfig}
    >
      <form onSubmit={onSave} className="flex flex-col gap-5">
        <p className="text-[12px] leading-[1.7] text-ink-3">
          この作品に所属するメッセージの演出デフォルト値を設定します。
          メッセージ個別の設定が優先されます。未設定の項目は環境変数の値を継承します。
        </p>

        {/* ── プリセット ── */}
        <PresetSelector
          onApply={(vals) => {
            for (const [k, v] of Object.entries(vals)) set(k as keyof TimingForm, v);
          }}
          disabled={!canEdit}
        />

        {/* ── 既読 ── */}
        <div>
          <label htmlFor="timing-read-mode" className="mb-1 block text-[12px] font-medium text-ink-2">
            既読タイミング
          </label>
          <select
            id="timing-read-mode"
            value={form.read_receipt_mode}
            onChange={(e) => set("read_receipt_mode", e.target.value)}
            disabled={!canEdit}
            className={compactInputClass + " w-full cursor-pointer sm:max-w-[220px]"}
          >
            {READ_RECEIPT_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {form.read_receipt_mode === "delayed" && (
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-2">既読遅延</label>
            <DurationInput
              valueMs={Number(form.read_delay_ms || 0)}
              onChange={(ms) => set("read_delay_ms", String(Math.min(ms, 600000)))}
            />
          </div>
        )}

        {/* ── 送信前の待機時間 ── */}
        <div>
          <label htmlFor="timing-typing" className="mb-1 block text-[12px] font-medium text-ink-2">
            送信前の待機時間（画面には表示されません）
          </label>
          <select
            id="timing-typing"
            value={form.typing_enabled}
            onChange={(e) => set("typing_enabled", e.target.value)}
            disabled={!canEdit}
            className={compactInputClass + " w-full cursor-pointer sm:max-w-[140px]"}
          >
            {BOOL_INHERIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {form.typing_enabled === "true" && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">最小</label>
              <DurationInput
                valueMs={Number(form.typing_min_ms || 0)}
                onChange={(ms) => {
                  const next = Math.min(ms, 600000);
                  const currentMax = Number(form.typing_max_ms || 0);
                  set("typing_min_ms", String(currentMax > 0 ? Math.min(next, currentMax) : next));
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">最大</label>
              <DurationInput
                valueMs={Number(form.typing_max_ms || 0)}
                onChange={(ms) => {
                  const next = Math.min(ms, 600000);
                  const currentMin = Number(form.typing_min_ms || 0);
                  set("typing_max_ms", String(Math.max(next, currentMin)));
                }}
              />
            </div>
          </div>
        )}

        {/* ── 「入力中...」表示 ── */}
        <div>
          <label htmlFor="timing-loading" className="mb-1 block text-[12px] font-medium text-ink-2">
            「入力中...」表示
          </label>
          <select
            id="timing-loading"
            value={form.loading_enabled}
            onChange={(e) => set("loading_enabled", e.target.value)}
            disabled={!canEdit}
            className={compactInputClass + " w-full cursor-pointer sm:max-w-[140px]"}
          >
            {BOOL_INHERIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {form.loading_enabled === "true" && (
          <>
            <div>
              <label htmlFor="timing-loading-threshold" className="mb-1 block text-[12px] font-medium text-ink-2">
                表示閾値（ms）
              </label>
              <input
                id="timing-loading-threshold"
                type="number"
                value={form.loading_threshold_ms}
                onChange={(e) => set("loading_threshold_ms", e.target.value)}
                min={0}
                max={30000}
                step={500}
                placeholder="3000"
                disabled={!canEdit}
                className={compactInputClass + " w-[120px]"}
              />
              <p className="mt-1 text-[11px] text-ink-3">
                処理時間がこの値を超えたら「入力中...」を表示
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">最小秒数</label>
                <input
                  type="number"
                  value={form.loading_min_seconds}
                  onChange={(e) => set("loading_min_seconds", e.target.value)}
                  min={3}
                  max={60}
                  step={1}
                  placeholder="5"
                  disabled={!canEdit}
                  className={compactInputClass + " w-[120px]"}
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">最大秒数</label>
                <input
                  type="number"
                  value={form.loading_max_seconds}
                  onChange={(e) => set("loading_max_seconds", e.target.value)}
                  min={3}
                  max={60}
                  step={1}
                  placeholder="15"
                  disabled={!canEdit}
                  className={compactInputClass + " w-[120px]"}
                />
              </div>
            </div>
          </>
        )}

        {/* ── プレビュー (= 別管理コンポーネント、本 PR では触らない) ── */}
        <PreviewPlayer workConfig={timingFormToConfig(form)} />

        {/* form actions */}
        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canEdit || saving}
            aria-busy={saving || undefined}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            {!canEdit ? "閲覧専用" : saving ? "保存中..." : "演出設定を保存"}
          </Button>
        </div>
      </form>
    </Accordion>
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
    <div>
      <label className="mb-1 block text-[12px] font-medium text-ink-2">プリセットから適用</label>
      <div className="flex flex-wrap gap-1.5">
        {BUILTIN_PRESETS.map((p) => (
          <Button
            key={p.key}
            type="button"
            variant="ghost"
            size="sm"
            title={p.description}
            disabled={disabled}
            onClick={() => onApply(presetToFormValues(p))}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        ボタンをクリックするとフォームに値が反映されます（保存前に確認可能）
      </p>
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
