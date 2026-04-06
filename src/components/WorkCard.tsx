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

// ── ステータストグルバッジ ────────────────────────────────────────────────
//
// canToggle = true のとき <button>、false のとき <span> をレンダリング。
// hover 時にトグル先のステータスをプレビュー表示（affordance）する。
// draft ↔ active のみ切り替え可能。paused は表示専用。

// スプレッドで color/bg/dot を継承しつつ label のみ操作用テキストで上書きする
const TOGGLE_NEXT: Partial<Record<string, typeof STATUS_META[string]>> = {
  draft:  { ...STATUS_META.active, label: "公開する"     },
  active: { ...STATUS_META.draft,  label: "下書きに戻す" },
};

interface StatusBadgeProps {
  status:    string;
  updating:  boolean;
  canToggle: boolean;
  onToggle:  () => void;
}

function StatusBadge({ status, updating, canToggle, onToggle }: StatusBadgeProps) {
  const [hov, setHov] = useState(false);

  const current = STATUS_META[status] ?? STATUS_META.draft;
  const next     = TOGGLE_NEXT[status];

  // hover かつ切り替え可能なとき → 次ステータスの色にじわっと遷移
  const isHovActive   = hov && canToggle && !!next;
  const displayColor  = isHovActive ? next!.color : current.color;
  const displayBg     = isHovActive ? next!.bg    : current.bg;
  const displayDot    = isHovActive ? next!.dot   : current.dot;
  const displayLabel  = isHovActive ? `→ ${next!.label}` : current.label;

  const baseStyle: React.CSSProperties = {
    display:      "inline-flex",
    alignItems:   "center",
    gap:          5,
    fontSize:     12,
    fontWeight:   700,
    padding:      "4px 10px",
    borderRadius: "var(--radius-full)",
    whiteSpace:   "nowrap",
    flexShrink:   0,
    transition:   "color 0.15s, background 0.15s",
    color:        displayColor,
    background:   displayBg,
    opacity:      updating ? 0.6 : 1,
    cursor:       canToggle && !updating ? "pointer" : "default",
    // <button> リセット
    border:       "none",
    fontFamily:   "inherit",
    lineHeight:   "inherit",
  };

  const dot = (
    <span style={{
      display:      "inline-block",
      width:        6,
      height:       6,
      borderRadius: "50%",
      background:   displayDot,
      flexShrink:   0,
      transition:   "background 0.15s",
    }} />
  );

  if (!canToggle) {
    return (
      <span style={baseStyle}>
        {dot}
        {current.label}
      </span>
    );
  }

  return (
    <button
      // aria-pressed でスクリーンリーダーにトグル状態を伝える
      // active = "pressed"（公開中）、draft = "false"（非公開）
      aria-pressed={status === "active"}
      aria-label={
        updating
          ? "ステータスを更新中"
          : next
            ? `ステータスを「${next.label}」に変更`
            : `現在のステータス: ${current.label}`
      }
      onClick={onToggle}
      disabled={updating}
      style={baseStyle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {dot}
      {displayLabel}
    </button>
  );
}

// ── クイックアクションボタン ─────────────────────────────────────────────���
// ボタンごとに独立した hover state を持たせることで、カード全体の再描画を避ける。
// href がある場合は <Link>、ない場合は <button> を返す。

interface QuickActionBtnProps {
  href?:     string;
  onClick?:  () => void;
  ariaLabel: string;
  danger?:   boolean;
  children:  React.ReactNode;
}

function QuickActionBtn({ href, onClick, ariaLabel, danger = false, children }: QuickActionBtnProps) {
  const [hov, setHov] = useState(false);

  const style: React.CSSProperties = {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    width:          30,
    height:         30,
    borderRadius:   "var(--radius-sm, 6px)",
    border:         "none",
    cursor:         "pointer",
    textDecoration: "none",
    flexShrink:     0,
    transition:     "background 0.12s, color 0.12s",
    color:          hov
      ? (danger ? "#dc2626" : "var(--text-primary, #111827)")
      : (danger ? "#ef4444" : "var(--text-muted, #9ca3af)"),
    background: hov
      ? (danger ? "#fee2e2" : "var(--gray-100, #f3f4f6)")
      : "transparent",
  };

  const events = {
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
  };

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} style={style} {...events}>
        {children}
      </Link>
    );
  }
  return (
    <button aria-label={ariaLabel} onClick={onClick} style={style} {...events}>
      {children}
    </button>
  );
}

// ── SVG アイコン ────────────────────────────────────────────────��─────────

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

// ── WorkCard Props ────────────────────────────────────────────────────────

interface WorkCardProps {
  work:             WorkListItem;
  oaId:             string;
  basePath:         string;
  role?:            string | null;
  onDelete?:        (id: string, title: string) => void;
  /** ステータス変更後のコールバック。親 state を refetch なしで更新するために使う */
  onStatusChange?:  (id: string, newStatus: PublishStatus) => void;
}

// ── メインコンポーネント ──────────────────────────────────────────────────

export function WorkCard({ work, oaId, basePath, role, onDelete, onStatusChange }: WorkCardProps) {
  const { showToast } = useToast();

  const [hovered,       setHovered]       = useState(false);
  const [copied,        setCopied]        = useState(false);
  const [localStatus,   setLocalStatus]   = useState<PublishStatus>(work.publish_status);
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

  const st = STATUS_META[localStatus] ?? STATUS_META.draft;

  return (
    <div
      style={{
        background:   "var(--surface)",
        border:       `1px solid ${hovered ? "#d1d5db" : "var(--border-light)"}`,
        borderRadius: "var(--radius-md)",
        padding:      "22px 24px",
        boxShadow:    "var(--shadow-xs)",
        transition:   "border-color 0.2s",
        position:     "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── ヘッダー行 ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>

        {/* ステータスバッジ — クリックで draft ↔ active をトグル */}
        <StatusBadge
          status={localStatus}
          updating={statusUpdating}
          canToggle={canToggleStatus}
          onToggle={handleStatusToggle}
        />

        {/* タイトル — 1行クランプ。全文は title 属性で確認可能 */}
        <Link href={workHref} title={work.title} style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display:      "block",
            fontSize:     16,
            fontWeight:   700,
            color:        "var(--text-primary)",
            lineHeight:   1.35,
            whiteSpace:   "nowrap",
            overflow:     "hidden",
            textOverflow: "ellipsis",
          }}>
            {work.title}
          </span>
        </Link>

        {/* クイックアクション — 非ホバー時��� opacity で控えめに */}
        <div
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        1,
            flexShrink: 0,
            opacity:    hovered ? 1 : 0.55,
            transition: "opacity 0.2s",
          }}
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
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        marginBottom: 12,
        minWidth:     0,
        minHeight:    26,
      }}>
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color:         "var(--text-muted)",
          flexShrink:    0,
          userSelect:    "none",
        }}>
          開始トリガー
        </span>

        {work.start_trigger ? (
          <>
            <span
              title={work.start_trigger}
              style={{
                flex:         "1 1 0",
                minWidth:     0,
                fontSize:     12,
                fontWeight:   500,
                color:        "var(--text-primary)",
                fontFamily:   "var(--font-mono, monospace)",
                background:   "#f8fafc",
                border:       "1px solid var(--border-light)",
                padding:      "2px 10px",
                borderRadius: "var(--radius-full)",
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
                cursor:       "default",
              }}
            >
              {work.start_trigger}
            </span>
            <button
              aria-label={copied ? "開始トリガーをコピーしました" : "開始トリガーをクリップボードにコピー"}
              onClick={handleCopy}
              style={{
                flexShrink:   0,
                display:      "inline-flex",
                alignItems:   "center",
                gap:          3,
                padding:      "2px 8px",
                fontSize:     11,
                fontWeight:   600,
                color:        copied ? "var(--color-primary, #2F6F5E)" : "var(--text-muted)",
                background:   copied ? "var(--color-primary-soft, #EAF4F1)" : "transparent",
                border:       `1px solid ${copied ? "#b9ddd6" : "transparent"}`,
                borderRadius: "var(--radius-full)",
                cursor:       copied ? "default" : "pointer",
                transition:   "color 0.15s, background 0.15s, border-color 0.15s",
                whiteSpace:   "nowrap",
              }}
            >
              <span aria-hidden="true">{copied ? "コピー済み" : "コピー"}</span>
            </button>
          </>
        ) : (
          <span style={{
            display:    "inline-flex",
            alignItems: "center",
            gap:        5,
            fontSize:   12,
            color:      "var(--text-secondary, #6b7280)",
            fontStyle:  "italic",
          }}>
            <span style={{
              display:      "inline-block",
              width:        6,
              height:       6,
              borderRadius: "50%",
              background:   "#fbbf24",
              flexShrink:   0,
            }} aria-hidden="true" />
            未設定
          </span>
        )}
      </div>

      {/* ── メタ情報チップ ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { value: (work._count.userProgress ?? 0).toLocaleString(), label: "プレイヤー",   highlight: (work._count.userProgress ?? 0) > 0 },
          { value: work._count.phases,                              label: "フェーズ",     highlight: false },
          { value: work._count.messages,                             label: "メッセージ",   highlight: false },
          { value: work._count.characters,                           label: "キャラクター", highlight: false },
        ].map((chip) => (
          <span key={chip.label} style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          4,
            fontSize:     12,
            color:        chip.highlight ? "var(--color-info)" : "var(--text-secondary)",
            background:   chip.highlight ? "#eff6ff" : "var(--gray-50)",
            border:       `1px solid ${chip.highlight ? "#bfdbfe" : "var(--border-light)"}`,
            padding:      "4px 11px",
            borderRadius: "var(--radius-full)",
          }}>
            <strong style={{ fontWeight: 700 }}>{chip.value}</strong>
            <span style={{ color: "var(--text-muted)" }}>{chip.label}</span>
          </span>
        ))}

        {/*
         * 完了 / 進行中チップ
         * 表示条件: 各カウントが 1 以上のときのみ表示（0 件は非表示でノイズを避ける）
         *
         * 将来拡張メモ:
         *   in_progress が多い作品を優先的に確認したいユースケースがある。
         *   progress_stats.in_progress をソートキーに使うことで
         *   「進行中ユーザーが多い順」への並び替えを実装できる。
         *   （works/page.tsx の sorted 計算部分にソートセレクタを追加予定）
         */}

        {/* 完了チップ — グリーン（到達者がいる場合のみ） */}
        {(work.progress_stats?.completed ?? 0) > 0 && (
          <span style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          4,
            fontSize:     12,
            color:        "#15803d",
            background:   "#f0fdf4",
            border:       "1px solid #86efac",
            padding:      "4px 11px",
            borderRadius: "var(--radius-full)",
          }}>
            <strong style={{ fontWeight: 700 }}>{work.progress_stats.completed.toLocaleString()}</strong>
            <span style={{ color: "#16a34a" }}>完了</span>
          </span>
        )}

        {/* 進行中チップ — グレー系（ニュートラル・補助情報として控えめに） */}
        {(work.progress_stats?.in_progress ?? 0) > 0 && (
          <span style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          4,
            fontSize:     12,
            color:        "#374151",
            background:   "#f3f4f6",
            border:       "1px solid #d1d5db",
            padding:      "4px 11px",
            borderRadius: "var(--radius-full)",
          }}>
            {/* ● ドットは aria-hidden — 数値＋ラベルでスクリーンリーダーに伝わる */}
            <span style={{
              display:      "inline-block",
              width:        6,
              height:       6,
              borderRadius: "50%",
              background:   "#9ca3af",
              flexShrink:   0,
            }} aria-hidden="true" />
            <strong style={{ fontWeight: 700 }}>{work.progress_stats.in_progress.toLocaleString()}</strong>
            <span style={{ color: "#6b7280" }}>進行中</span>
          </span>
        )}

        {/*
         * 「要確認」補助ラベル
         * 条件: 進行中ユーザーはいるが完了者がまだ出ていない作品
         *   → シナリオが詰まっている可能性の早期発見を促す
         * 強調色は使わず、控えめなアンバー文字で補助表示する
         */}
        {(work.progress_stats?.in_progress ?? 0) > 0 &&
         (work.progress_stats?.completed   ?? 0) === 0 && (
          <span style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          4,
            fontSize:     11,
            color:        "#b45309",
            background:   "#fffbeb",
            border:       "1px solid #fde68a",
            padding:      "3px 9px",
            borderRadius: "var(--radius-full)",
          }}>
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
          style={{
            marginLeft: "auto",
            fontSize:   11,
            color:      "var(--text-secondary, #6b7280)",
            alignSelf:  "center",
          }}
        >
          更新 {formatDate(work.updated_at)}
        </time>
      </div>
    </div>
  );
}
