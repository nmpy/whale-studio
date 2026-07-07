"use client";

// src/app/oas/[id]/works/[workId]/edit/page.tsx
// GET   /api/works/:id          → 作品情報のプリフィル
// PATCH /api/works/:id          → 作品情報の更新 (= workApi.update)
// POST  /api/works/:id/duplicate → 作品の複製 (= workApi.duplicate)
//
// Phase 3.1: UI を Phase 0 トークン + shared/Button + shared/Accordion に揃える。
// 保存 payload / API / toast / router 遷移 / canEdit 制御 / 三値変換は完全維持。
//
// 継承モード廃止 (2026-06): 旧「演出デフォルト設定」セクションは削除。
// メッセージ単位の演出設定のみで完結する方針 (= 作品単位 fallback なし)。
// DB の Work.{read_receipt_mode,typing_enabled,...} カラム自体は schema に残置
// (= 別 PR で migration 検討)。本ページからは触れない。

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
import { Button, buttonClass } from "@/components/shared";

// ── 定数 ──────────────────────────────────────────
const STATUS_OPTIONS: { value: PublishStatus; label: string; desc: string }[] = [
  { value: "draft",  label: "下書き（非公開）", desc: "公開せず編集のみ" },
  { value: "active", label: "公開中",          desc: "LINE に配信中" },
  { value: "paused", label: "停止中",          desc: "一時的に配信を停止" },
];

// ── 型 ────────────────────────────────────────────
interface WorkForm {
  title:          string;
  description:    string;
  publish_status: PublishStatus;
  sort_order:     number;
  start_keyword:  string;
  start_trigger_mode: "keyword" | "free_text";
}

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
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [workErrors, setWorkErrors]   = useState<Record<string, string[]>>({});
  const [savingWork, setSavingWork]   = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  // 同一 OA に公開中作品が複数あるか（開始キーワード未設定時の警告用）。
  const [multiActivePublished, setMultiActivePublished] = useState(false);

  // ── データ読み込み ──────────────────────────────
  // 演出デフォルト設定 (read_receipt_mode 等) はメッセージ単位に統一済 (= 継承モード廃止)
  // のため、ここでは title / description / publish_status / sort_order / start_keyword を復元する。
  const loadWork = useCallback(async () => {
    try {
      const w = await workApi.get(getDevToken(), workId);
      setWorkForm({
        title:          w.title,
        description:    w.description ?? "",
        publish_status: w.publish_status,
        sort_order:     w.sort_order,
        start_keyword:  w.start_keyword ?? "",
        start_trigger_mode: w.start_trigger_mode ?? "keyword",
      });
      // 同一 OA の公開中作品が複数あるかを判定（開始キーワード未設定の警告に使う）。失敗しても致命的でない。
      try {
        const actives = await workApi.list(getDevToken(), oaId, { publish_status: "active" });
        setMultiActivePublished(actives.length > 1);
      } catch { /* 警告判定は任意。取得失敗時は警告を出さないだけ。 */ }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "作品の読み込みに失敗しました");
    }
  }, [workId, oaId]);

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
        start_keyword:  workForm.start_keyword.trim() || null,
        start_trigger_mode: workForm.start_trigger_mode,
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

          {/* 開始方法（keyword / free_text） */}
          <div className="mb-5">
            <label htmlFor="work-start-trigger-mode" className="mb-1.5 block text-[13px] font-bold text-ink">
              開始方法
            </label>
            <select
              id="work-start-trigger-mode"
              className={compactInputClass + " w-full"}
              value={workForm!.start_trigger_mode}
              onChange={(e) => setWorkField("start_trigger_mode", e.target.value as "keyword" | "free_text")}
              disabled={!canEdit}
            >
              <option value="keyword">キーワードで開始</option>
              <option value="free_text">自由入力で開始</option>
            </select>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
              {workForm!.start_trigger_mode === "free_text"
                ? "プレイヤーが任意のテキストを送信した時点で、この作品を開始します（入力内容は問いません）。1つの公式アカウント内で複数作品に設定すると開始対象が曖昧になるため、基本的に1作品のみで使用してください。進行中のプレイヤーには発動しません。"
                : "開始キーワード（下）または開始フェーズのトリガーが一致したときに、この作品を開始します。"}
            </p>
          </div>

          {/* start_keyword（開始キーワード） */}
          <div className="mb-5">
            <label htmlFor="work-start-keyword" className="mb-1.5 block text-[13px] font-bold text-ink">
              開始キーワード
              {workForm!.start_trigger_mode === "free_text" && (
                <span className="ml-2 text-[11px] font-normal text-ink-3">（自由入力で開始のときは任意）</span>
              )}
            </label>
            <input
              id="work-start-keyword"
              type="text"
              className={compactInputClass + " w-full"}
              value={workForm!.start_keyword}
              onChange={(e) => setWorkField("start_keyword", e.target.value)}
              maxLength={100}
              placeholder="例：エリーゼ開始"
              readOnly={!canEdit}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
              複数の作品を同じLINE公式アカウントで公開する場合、このキーワードをユーザーが送信すると作品が開始されます。
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              開始キーワードは作品内の応答キーワードより優先されます。
            </p>
            {multiActivePublished && !workForm!.start_keyword.trim() && workForm!.start_trigger_mode !== "free_text" && (
              <p className="mt-1.5 text-[12px] font-bold leading-relaxed text-warning">
                このLINE公式アカウントでは複数の作品が公開中です。開始キーワードが未設定だと、ユーザーがこの作品を開始できない場合があります。
              </p>
            )}
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
    </>
  );
}
