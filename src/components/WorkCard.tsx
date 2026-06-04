"use client";

// src/components/WorkCard.tsx
//
// 作品リストの1枚カード。
// /oas/[id]/works/page.tsx と tester/[oaId]/works/page.tsx で共用。
//
// Props:
//   work            — 作品データ
//   oaId            — OA ID（リンク生成に使用）
//   basePath        — カードの href ベース
//   role            — ワークスペース権限（省略時は編集操作を非表示）
//   onDelete        — 削除ハンドラ（owner のみ）
//   onStatusChange  — ステータス変更後のコールバック（親 state を refetch なしで更新）
//
// Phase 3.2b: 色トークンを Phase 0 (Tailwind v4) に揃える。
// STATUS_META (= /constants/workStatus.ts) は触らず、WorkCard 内でローカル mapping を定義。
// ステータストグル / 楽観的更新 / 削除 / コピー / aria 等のロジックは完全維持。

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { STATUS_META } from "@/constants/workStatus";
import { workApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import type { PublishStatus } from "@/types";

// ── ユーティリティ ────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// ── ステータス → Tailwind クラス mapping (= Phase 0 トークン、WorkCard 内ローカル) ─────
// STATUS_META 自体は触らず、WorkCard でのみ Tailwind クラスを使う設計
// (= 影響範囲を WorkCard に閉じ、work hub 等の他参照箇所には波及させない)。
const STATUS_CLASS: Record<string, { container: string; dot: string }> = {
  draft:  {
    container: "bg-bg-tint text-ink-3",
    dot:       "bg-ink-3",
  },
  active: {
    container: "bg-brand-soft text-brand-ink",
    dot:       "bg-brand",
  },
  paused: {
    container: "bg-warn-soft text-warn",
    dot:       "bg-warn",
  },
};

function statusClass(status: string) {
  return STATUS_CLASS[status] ?? STATUS_CLASS.draft;
}

// ── ステータストグルバッジ ────────────────────────────────────────────────
//
// canToggle = true のとき <button>、false のとき <span> をレンダリング。
// hover 時にトグル先のステータスをプレビュー表示（affordance）する。
// draft ↔ active のみ切り替え可能。paused は表示専用。

// label のみ操作用テキストで上書き (= 「公開する」「下書きに戻す」)
const TOGGLE_NEXT: Partial<Record<string, { status: PublishStatus; label: string }>> = {
  draft:  { status: "active", label: "公開する"     },
  active: { status: "draft",  label: "下書きに戻す" },
};

interface StatusBadgeProps {
  status:    string;
  updating:  boolean;
  canToggle: boolean;
  onToggle:  () => void;
}

function StatusBadge({ status, updating, canToggle, onToggle }: StatusBadgeProps) {
  // hover state はロジック上必要 (= 次状態プレビュー表示)。維持する。
  const [hov, setHov] = useState(false);

  const currentMeta  = STATUS_META[status] ?? STATUS_META.draft;
  const next         = TOGGLE_NEXT[status];

  // hover かつ切り替え可能なとき → 次ステータスの色・ラベルにじわっと遷移
  const isHovActive  = hov && canToggle && !!next;
  const displayKey   = isHovActive ? next!.status : status;
  const displayClass = statusClass(displayKey);
  const displayLabel = isHovActive ? `→ ${next!.label}` : currentMeta.label;

  const baseClass =
    "inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full " +
    "px-2.5 py-1 text-[12px] font-bold leading-none transition-colors " +
    displayClass.container + " " +
    (updating ? "opacity-60 " : "") +
    (canToggle && !updating ? "cursor-pointer" : "cursor-default");

  const dot = (
    <span
      aria-hidden="true"
      className={
        "inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full transition-colors " +
        displayClass.dot
      }
    />
  );

  if (!canToggle) {
    return (
      <span className={baseClass}>
        {dot}
        {currentMeta.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      // aria-pressed でスクリーンリーダーにトグル状態を伝える
      // active = "pressed"（公開中）、draft = "false"（非公開）
      aria-pressed={status === "active"}
      aria-label={
        updating
          ? "ステータスを更新中"
          : next
            ? `ステータスを「${next.label}」に変更`
            : `現在のステータス: ${currentMeta.label}`
      }
      onClick={onToggle}
      disabled={updating}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={baseClass + " border-0"}
    >
      {dot}
      {displayLabel}
    </button>
  );
}

// ── クイックアクションボタン ────────────────────────────────────────────
// 30×30 アイコン button。href がある場合は <Link>、ない場合は <button>。
// hover は CSS :hover に置換 (= useState 削減、再描画削減)。

interface QuickActionBtnProps {
  href?:     string;
  onClick?:  () => void;
  ariaLabel: string;
  danger?:   boolean;
  children:  React.ReactNode;
}

function QuickActionBtn({ href, onClick, ariaLabel, danger = false, children }: QuickActionBtnProps) {
  const cls =
    "flex h-[30px] w-[30px] flex-shrink-0 cursor-pointer items-center justify-center " +
    "rounded-md border-0 bg-transparent no-underline transition-colors " +
    (danger
      ? "text-danger hover:bg-danger-soft"
      : "text-ink-3 hover:bg-bg-tint hover:text-ink");

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

// ── SVG アイコン ──────────────────────────────────────────────────────────

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

const IconPlay = () => (
  <svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

// Phase 2-K: Live 導線用アイコン (= 円形のラジオ風 = 「現場・配信」のメタファ)
const IconLive = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    <path d="M5.6 5.6a9 9 0 0 0 0 12.8" />
    <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
    <path d="M2.5 2.5a13 13 0 0 0 0 19" />
    <path d="M21.5 2.5a13 13 0 0 1 0 19" />
  </svg>
);

// Phase 2-K: Live Actor 表示確認 用アイコン (= 目玉 = preview のメタファ)
const IconLiveEye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// ── WorkCard Props ────────────────────────────────────────────────────────

interface WorkCardProps {
  work:             WorkListItem;
  oaId:             string;
  basePath:         string;
  role?:            string | null;
  onDelete?:        (id: string, title: string) => void;
  /** ステータス変更後のコールバック。親 state を refetch なしで更新するために使う */
  onStatusChange?:  (id: string, newStatus: PublishStatus) => void;
  /** Phase 2-K: Live Admin / Live Actor 表示確認 導線を出すか (= live admin 集合のみ true) */
  canEnterLive?:    boolean;
}

// ── メインコンポーネント ──────────────────────────────────────────────────

export function WorkCard({ work, oaId, basePath, role, onDelete, onStatusChange, canEnterLive = false }: WorkCardProps) {
  const { showToast } = useToast();

  const [copied,         setCopied]         = useState(false);
  const [localStatus,    setLocalStatus]    = useState<PublishStatus>(work.publish_status);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 親から work が差し替えられたとき（refetch 後など）にローカルを同期
  useEffect(() => {
    setLocalStatus(work.publish_status);
  }, [work.publish_status]);

  // unmount 時にコピータイマーをクリーンアップ
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const workHref    = `${basePath}/${work.id}`;
  const previewHref = `/playground?work_id=${work.id}&oa_id=${oaId}`;

  // draft ↔ active のみ切り替え可能。paused は表示専用。
  // 権限は owner / admin のみ（viewer / tester / editor は read-only）。
  const canToggleStatus =
    (localStatus === "draft" || localStatus === "active") &&
    (role === "owner" || role === "admin");

  // ── ステータストグル ────────────────────────────────────────────────────
  async function handleStatusToggle() {
    if (statusUpdating || !canToggleStatus) return;

    const prev: PublishStatus = localStatus;
    const next: PublishStatus = localStatus === "active" ? "draft" : "active";

    setLocalStatus(next);        // 楽観的更新
    setStatusUpdating(true);
    try {
      await workApi.update(getDevToken(), work.id, { publish_status: next });
      onStatusChange?.(work.id, next);
    } catch (e) {
      setLocalStatus(prev);      // 失敗時はリバート
      showToast(
        e instanceof Error ? e.message : "ステータスの更新に失敗しました",
        "error",
      );
    } finally {
      setStatusUpdating(false);
    }
  }

  // ── コピー ──────────────────────────────────────────────────────────────
  async function handleCopy() {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(work.start_trigger!);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API が使えない環境ではサイレントに無視
    }
  }

  return (
    <div
      className={
        "group rounded-card border border-line bg-surface p-5 shadow-sm " +
        "transition-all duration-150 hover:-translate-y-px hover:shadow-card sm:p-6"
      }
    >
      {/* ── ヘッダー行 ── */}
      <div className="mb-2.5 flex items-start gap-2.5">

        {/* ステータスバッジ — クリックで draft ↔ active をトグル */}
        <StatusBadge
          status={localStatus}
          updating={statusUpdating}
          canToggle={canToggleStatus}
          onToggle={handleStatusToggle}
        />

        {/* タイトル — 1行クランプ。全文は title 属性で確認可能 */}
        <Link href={workHref} title={work.title} className="min-w-0 flex-1">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-bold leading-[1.35] text-ink">
            {work.title}
          </span>
        </Link>

        {/* クイックアクション — 非ホバー時は opacity で控えめに */}
        <div
          className="flex flex-shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100"
          onMouseEnter={(e) => e.stopPropagation()}
        >
          <QuickActionBtn href={workHref}    ariaLabel={`「${work.title}」を管理する`}>
            <IconEdit />
          </QuickActionBtn>
          <QuickActionBtn href={previewHref} ariaLabel={`「${work.title}」をプレビュー`}>
            <IconPlay />
          </QuickActionBtn>
          {role === "owner" && onDelete && (
            <QuickActionBtn
              onClick={() => onDelete(work.id, work.title)}
              ariaLabel={`「${work.title}」を削除`}
              danger
            >
              <IconTrash />
            </QuickActionBtn>
          )}
        </div>
      </div>

      {/* ── 開始トリガー行 ── */}
      <div className="mb-3 flex min-h-[26px] min-w-0 items-center gap-2">
        <span className="flex-shrink-0 select-none text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
          開始トリガー
        </span>

        {work.start_trigger ? (
          <>
            <span
              title={work.start_trigger}
              className={
                "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap " +
                "rounded-full border border-line bg-bg-tint px-2.5 py-0.5 " +
                "font-mono text-[12px] font-medium text-ink"
              }
            >
              {work.start_trigger}
            </span>
            <button
              type="button"
              aria-label={copied ? "開始トリガーをコピーしました" : "開始トリガーをクリップボードにコピー"}
              onClick={handleCopy}
              className={
                "inline-flex flex-shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-full " +
                "border px-2 py-0.5 text-[11px] font-semibold transition-colors " +
                (copied
                  ? "cursor-default border-brand/30 bg-brand-soft text-brand-ink"
                  : "border-transparent bg-transparent text-ink-3 hover:bg-bg-tint hover:text-ink-2")
              }
            >
              <span aria-hidden="true">{copied ? "コピー済み" : "コピー"}</span>
            </button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] italic text-ink-2">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warn" />
            未設定
          </span>
        )}
      </div>

      {/* ── メタ情報チップ ── */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: (work.progress_stats?.total ?? 0).toLocaleString(), label: "プレイヤー",   highlight: (work.progress_stats?.total ?? 0) > 0 },
          { value: work._count.phases.toLocaleString(),             label: "フェーズ",     highlight: false },
          { value: work._count.messages.toLocaleString(),           label: "メッセージ",   highlight: false },
          { value: work._count.characters.toLocaleString(),         label: "キャラクター", highlight: false },
        ].map((chip) => (
          <span
            key={chip.label}
            className={
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] " +
              (chip.highlight
                ? "border-sky/30 bg-sky-soft text-sky-ink"
                : "border-line bg-bg-tint text-ink-2")
            }
          >
            <strong className="font-num font-bold">{chip.value}</strong>
            <span className={chip.highlight ? "text-sky-ink/85" : "text-ink-3"}>{chip.label}</span>
          </span>
        ))}

        {/*
         * 完了 / 進行中チップ
         * 表示条件: 各カウントが 1 以上のときのみ表示（0 件は非表示でノイズを避ける）
         */}

        {/* 完了チップ — brand (到達者がいる場合のみ) */}
        {(work.progress_stats?.completed ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-[12px] text-brand-ink">
            <strong className="font-num font-bold">{work.progress_stats.completed.toLocaleString()}</strong>
            <span className="text-brand-ink/85">完了</span>
          </span>
        )}

        {/* 進行中チップ — gray 系 (= ニュートラル・補助情報) */}
        {(work.progress_stats?.in_progress ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-bg-tint px-2.5 py-1 text-[12px] text-ink-2">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-3" />
            <strong className="font-num font-bold">{work.progress_stats.in_progress.toLocaleString()}</strong>
            <span className="text-ink-3">進行中</span>
          </span>
        )}

        {/*
         * 「要確認」補助ラベル
         * 条件: 進行中ユーザーはいるが完了者がまだ出ていない作品
         *   → シナリオが詰まっている可能性の早期発見を促す
         */}
        {(work.progress_stats?.in_progress ?? 0) > 0 &&
         (work.progress_stats?.completed   ?? 0) === 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
            {/* 小さなフラグアイコン */}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            完了者未発生
          </span>
        )}

        <time
          dateTime={work.updated_at}
          className="font-num ml-auto self-center text-[11px] text-ink-3"
        >
          更新 {formatDate(work.updated_at)}
        </time>
      </div>

      {/* ── Phase 2-K: Live 導線 (= live admin 集合のみ表示) ── */}
      {canEnterLive && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Link
            href={`/oas/${oaId}/live/admin?workId=${work.id}`}
            title={`「${work.title}」の Whale Studio Live Admin を開く`}
            className={
              "inline-flex items-center gap-1.5 rounded-md border border-brand/30 " +
              "bg-brand-soft px-3 py-1.5 text-[12px] font-semibold text-brand-ink " +
              "no-underline transition-shadow hover:shadow-sm"
            }
          >
            <IconLive />
            Live管理
          </Link>
          <Link
            href={`/oas/${oaId}/live/actor?workId=${work.id}`}
            title={`「${work.title}」の Whale Studio Live Actor 表示確認を開く`}
            className={
              "inline-flex items-center gap-1.5 rounded-md border border-sky/30 " +
              "bg-sky-soft px-3 py-1.5 text-[12px] font-semibold text-sky-ink " +
              "no-underline transition-shadow hover:shadow-sm"
            }
          >
            <IconLiveEye />
            Actor確認
          </Link>
        </div>
      )}
    </div>
  );
}
