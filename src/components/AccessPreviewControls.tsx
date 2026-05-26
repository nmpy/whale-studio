"use client";

// src/components/AccessPreviewControls.tsx
//
// ヘッダー右側に表示する「表示確認モード」コントロール。
//
// 仕様:
//   - 通常ユーザー : プラン名 / 権限名を表示するのみ
//   - owner       : 上記に加えて、プラン / 権限のプルダウンで preview 切り替え可能
//   - URL ?previewPlan / ?previewRole で状態を保持
//   - preview 適用中はバッジで「表示確認中」を明示 + 解除ボタン表示
//
// owner 以外が URL に query を付けても useAccessPreview 側で無視される。

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PLAN_LABELS,
  PLAN_TIER_ORDER,
  type PlanTier,
} from "@/lib/constants/plans";
import {
  PREVIEW_ROLE,
  PREVIEW_ROLE_LABELS,
  PREVIEW_ROLE_ORDER,
  buildPreviewSearchParams,
  type PreviewRole,
} from "@/lib/access-preview";
import { useAccessPreview, type RealRole } from "@/hooks/useAccessPreview";

interface Props {
  oaId: string;
}

/** 実 role (= WorkspaceRole) を日本語表示名に変換する。owner/admin/editor/tester/viewer。 */
function realRoleLabel(role: RealRole): string {
  switch (role) {
    case "owner":  return "オーナー";
    case "admin":  return "管理者";
    case "editor": return "編集者";
    case "tester": return "テスター";
    case "viewer": return "閲覧者";
    default:       return "不明";
  }
}

export function AccessPreviewControls({ oaId }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const {
    realPlan, realRole, previewPlan, previewRole, effectivePlan, effectiveRole,
    canUsePreviewMode, isPreviewing, loading,
  } = useAccessPreview(oaId);

  // 現在の path に新しい query を当てた URL を作る共通処理
  function pushWithParams(next: URLSearchParams) {
    const q = next.toString();
    router.push(`${pathname}${q ? `?${q}` : ""}`);
  }

  function handlePlanChange(value: PlanTier | "") {
    const next = buildPreviewSearchParams(searchParams, {
      previewPlan: value === "" ? null : value,
    });
    pushWithParams(next);
  }

  function handleRoleChange(value: PreviewRole | "") {
    const next = buildPreviewSearchParams(searchParams, {
      previewRole: value === "" ? null : value,
    });
    pushWithParams(next);
  }

  function handleClearPreview() {
    const next = buildPreviewSearchParams(searchParams, {
      previewPlan: null,
      previewRole: null,
    });
    pushWithParams(next);
  }

  // ─── 読み込み中 / OA 配下でない場合 ───
  if (loading || !oaId) {
    return null;
  }

  // ─── 通常ユーザー: 実プラン / 実権限を表示するだけ ───
  if (!canUsePreviewMode) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        <span title="現在の契約プラン">プラン: <strong>{PLAN_LABELS[realPlan]}</strong></span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span title="あなたの権限">権限: <strong>{realRoleLabel(realRole)}</strong></span>
      </div>
    );
  }

  // ─── owner: preview controls 表示 ───
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        <span>実プラン: <strong>{PLAN_LABELS[realPlan]}</strong></span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span>実権限: <strong>{realRoleLabel(realRole)}</strong></span>
      </div>

      {/* 表示確認 controls */}
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
          background: isPreviewing ? "#fffbeb" : "#f8fafc",
          border: `1px solid ${isPreviewing ? "#fde68a" : "var(--border-light)"}`,
          borderRadius: 6, fontSize: 11,
        }}
        title="OWNER 限定: 画面の見え方を他プラン / 他権限として確認できます。DB 上の権限は変更されません。"
      >
        <span style={{ color: "var(--text-muted)", marginRight: 2 }}>表示確認</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>プラン</span>
          <select
            value={previewPlan ?? ""}
            onChange={(e) => handlePlanChange(e.target.value as PlanTier | "")}
            style={{
              fontSize: 11, padding: "2px 4px", border: "1px solid #d1d5db",
              borderRadius: 4, background: "#fff", cursor: "pointer",
            }}
            aria-label="表示確認用プラン"
          >
            <option value="">— 実プラン</option>
            {PLAN_TIER_ORDER.map((tier) => (
              <option key={tier} value={tier}>{PLAN_LABELS[tier]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>権限</span>
          <select
            value={previewRole ?? ""}
            onChange={(e) => handleRoleChange(e.target.value as PreviewRole | "")}
            style={{
              fontSize: 11, padding: "2px 4px", border: "1px solid #d1d5db",
              borderRadius: 4, background: "#fff", cursor: "pointer",
            }}
            aria-label="表示確認用権限"
          >
            <option value="">— 実権限</option>
            {PREVIEW_ROLE_ORDER.map((r) => (
              <option key={r} value={r}>{PREVIEW_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      </div>

      {/* preview 適用中バッジ + 解除ボタン */}
      {isPreviewing && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
            }}
          >
            表示確認中: {PLAN_LABELS[effectivePlan]} / {
              typeof effectiveRole === "string" && effectiveRole in PREVIEW_ROLE_LABELS
                ? PREVIEW_ROLE_LABELS[effectiveRole as PreviewRole]
                : realRoleLabel(effectiveRole as RealRole)
            }
          </span>
          <button
            type="button"
            onClick={handleClearPreview}
            style={{
              fontSize: 11, padding: "3px 8px",
              border: "1px solid #d1d5db", borderRadius: 4,
              background: "#fff", color: "#374151", cursor: "pointer",
            }}
          >
            解除
          </button>
        </div>
      )}
    </div>
  );
}

// 未使用変数を export してリント警告を抑える (= PREVIEW_ROLE は型推論で使うが直接参照しない)
export { PREVIEW_ROLE };
