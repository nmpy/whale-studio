"use client";

// src/components/AccessPreviewBar.tsx
//
// ヘッダー直下に独立バーとして表示する「表示確認モード」UI。
//
// 旧 AccessPreviewControls をヘッダー内に詰め込んだ実装では、既存ヘッダーの
// ロゴ / 副題 / オーナーバッジ / ユーザー名 / ログアウト / スタジオ管理ボタン の
// 横並びを崩していたため、独立 row として layout (= AppShell) で配置する設計に変更。
//
// 表示条件:
//   - OA 配下 (= /oas/[id]/...) のページのみ。これは AppShell 側で path 判定して
//     mount を制御する (= 非 OA ページでは本コンポーネントを mount しない)。
//   - ログイン済み + owner のみ操作 (= プルダウン)。owner 以外には何も描画しない
//   - 全幅 / 控えめ表示。preview 中は黄色で目立たせる。
//
// 内容:
//   - 「表示確認モード」見出し
//   - 実プラン / 実権限のラベル
//   - 表示確認プラン / 表示確認権限のプルダウン (= URL ?previewPlan / ?previewRole)
//   - 表示確認中バッジ (= owner かつ preview 適用中のみ)
//   - 「表示確認を解除」ボタン (= owner かつ preview 適用中のみ)

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PLAN_LABELS, PLAN_TIER_ORDER, type PlanTier } from "@/lib/constants/plans";
import {
  PREVIEW_ROLE_LABELS,
  PREVIEW_ROLE_ORDER,
  buildPreviewSearchParams,
  type PreviewRole,
} from "@/lib/access-preview";
import { useAccessPreview, type RealRole } from "@/hooks/useAccessPreview";

interface AccessPreviewBarProps {
  /** AppShell が pathname から決定した OA ID。空 / null は AppShell 側で弾く前提なので必ず非空。 */
  oaId: string;
}

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

export function AccessPreviewBar({ oaId }: AccessPreviewBarProps) {
  const pathname     = usePathname();
  const router       = useRouter();
  const searchParams = useSearchParams();

  const {
    realPlan, realRole, previewPlan, previewRole, effectivePlan, effectiveRole,
    canUsePreviewMode, isPreviewing, loading,
  } = useAccessPreview(oaId);

  // owner じゃない or 読み込み中の場合は何も描画しない。
  // 非 OA ページでの mount は AppShell 側で path 判定して防いでいるため、
  // ここでは oaId は必ず非空である前提。
  if (!canUsePreviewMode || loading) return null;

  function pushWithParams(next: URLSearchParams) {
    const q = next.toString();
    // replace + scroll:false: 表示確認の切替で履歴を汚さず・スクロール位置を保つ。
    router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false });
  }
  function handlePlanChange(value: PlanTier | "") {
    pushWithParams(buildPreviewSearchParams(searchParams, {
      previewPlan: value === "" ? null : value,
    }));
  }
  function handleRoleChange(value: PreviewRole | "") {
    pushWithParams(buildPreviewSearchParams(searchParams, {
      previewRole: value === "" ? null : value,
    }));
  }
  function handleClearPreview() {
    pushWithParams(buildPreviewSearchParams(searchParams, {
      previewPlan: null, previewRole: null,
    }));
  }

  return (
    <div
      role="region"
      aria-label="表示確認モード (オーナー限定)"
      style={{
        background:    isPreviewing ? "#fffbeb" : "#f8fafc",
        borderBottom:  `1px solid ${isPreviewing ? "#fde68a" : "var(--border-light)"}`,
        fontSize:      12,
        color:         "var(--text-secondary)",
      }}
    >
      <div
        className="container"
        style={{
          display:       "flex",
          alignItems:    "center",
          gap:           12,
          flexWrap:      "wrap",
          padding:       "6px 0",
        }}
      >
        <span style={{
          fontWeight: 700, fontSize: 11, color: "var(--text-muted)",
          letterSpacing: ".06em", textTransform: "uppercase",
        }}>
          表示確認モード
        </span>

        {/* 実プラン / 実権限 */}
        <span>
          実プラン: <strong style={{ color: "var(--text-primary)" }}>{PLAN_LABELS[realPlan]}</strong>
        </span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span>
          実権限: <strong style={{ color: "var(--text-primary)" }}>{realRoleLabel(realRole)}</strong>
        </span>

        {/* プラン select */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>表示確認プラン</span>
          <select
            value={previewPlan ?? ""}
            onChange={(e) => handlePlanChange(e.target.value as PlanTier | "")}
            style={{
              fontSize: 11, padding: "2px 6px", border: "1px solid #d1d5db",
              borderRadius: 4, background: "#fff", cursor: "pointer", maxWidth: 140,
            }}
            aria-label="表示確認用プラン"
          >
            <option value="">— 実プラン</option>
            {PLAN_TIER_ORDER.map((tier) => (
              <option key={tier} value={tier}>{PLAN_LABELS[tier]}</option>
            ))}
          </select>
        </label>

        {/* 権限 select */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>表示確認権限</span>
          <select
            value={previewRole ?? ""}
            onChange={(e) => handleRoleChange(e.target.value as PreviewRole | "")}
            style={{
              fontSize: 11, padding: "2px 6px", border: "1px solid #d1d5db",
              borderRadius: 4, background: "#fff", cursor: "pointer", maxWidth: 180,
            }}
            aria-label="表示確認用権限"
          >
            <option value="">— 実権限</option>
            {PREVIEW_ROLE_ORDER.map((r) => (
              <option key={r} value={r}>{PREVIEW_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>

        {/* preview 中 バッジ + 解除ボタン */}
        {isPreviewing && (
          <>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10, fontWeight: 700, padding: "2px 8px",
                borderRadius: 4, background: "#fef3c7", color: "#92400e",
                border: "1px solid #fde68a", whiteSpace: "nowrap",
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
                fontSize: 11, padding: "3px 10px",
                border: "1px solid #d1d5db", borderRadius: 4,
                background: "#fff", color: "#374151", cursor: "pointer",
              }}
            >
              表示確認を解除
            </button>
          </>
        )}
      </div>
    </div>
  );
}
