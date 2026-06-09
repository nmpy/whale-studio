"use client";

// src/components/OasViewPreviewBar.tsx
//
// `/oas` (= アカウント管理 / OA 一覧) ページ専用の「表示確認モード」バー。
//
// 既存の AccessPreviewBar (= /oas/[id]/... 用 / URL query 方式) と見た目を揃えた
// 独立 row。ただし OA 一覧は特定 OA に紐づかないため、状態は usePlatformRole
// (= localStorage 方式) を踏襲し、視点を platform owner / owner / admin / editor /
// viewer の 5 つから選べるようにする。
//
// 表示条件:
//   - 実 platform owner のみ (= props.isPlatformOwner)。一般ユーザーには何も描画しない。
//
// 重要:
//   - これは UI 表示確認専用。select で視点を変えても実権限・API には一切影響しない
//     (= POST /api/oas は server 側で実 platform owner を別途検証し、preview では 403 のまま)。
//   - state を持たない presentational component (= 親 /oas が持つ単一 usePlatformRole から
//     props で受け取る)。二重 fetch (= /api/admin/me) を避けるため自前で hook を呼ばない。

import {
  OAS_VIEW_ROLE_LABELS,
  OAS_VIEW_ROLE_ORDER,
  isPreviewingOasView,
  type OasViewRole,
} from "@/lib/oas-preview";

interface OasViewPreviewBarProps {
  /** 実 platform owner かどうか（usePlatformRole の isPlatformOwner をそのまま渡す）。 */
  isPlatformOwner: boolean;
  /** 現在選択中の視点（null = platform owner 既定）。 */
  previewViewRole: OasViewRole | null;
  /** 視点切り替え。null / "platform_owner" で platform owner 既定に戻す。 */
  onChange: (role: OasViewRole | null) => void;
}

export function OasViewPreviewBar({
  isPlatformOwner,
  previewViewRole,
  onChange,
}: OasViewPreviewBarProps) {
  // 実 platform owner 以外には表示確認モード自体を見せない。
  if (!isPlatformOwner) return null;

  const previewing = isPreviewingOasView({ isPlatformOwner, previewViewRole });
  const current: OasViewRole = previewViewRole ?? "platform_owner";

  return (
    <div
      role="region"
      aria-label="表示確認モード (プラットフォームオーナー限定)"
      className="mb-4 rounded-card border px-4 py-2.5"
      style={{
        background:   previewing ? "#fffbeb" : "#f8fafc",
        borderColor:  previewing ? "#fde68a" : "var(--border-light, #e5e7eb)",
        fontSize:     12,
        color:        "var(--text-secondary, #4b5563)",
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          style={{
            fontWeight: 700, fontSize: 11, color: "var(--text-muted, #6b7280)",
            letterSpacing: ".06em", textTransform: "uppercase",
          }}
        >
          表示確認モード
        </span>

        <label className="inline-flex items-center gap-1.5">
          <span style={{ fontSize: 10, color: "var(--text-muted, #6b7280)" }}>表示する視点</span>
          <select
            value={current}
            onChange={(e) => onChange(e.target.value as OasViewRole)}
            aria-label="表示確認する視点"
            style={{
              fontSize: 11, padding: "2px 6px", border: "1px solid #d1d5db",
              borderRadius: 4, background: "#fff", cursor: "pointer", maxWidth: 220,
            }}
          >
            {OAS_VIEW_ROLE_ORDER.map((r) => (
              <option key={r} value={r}>{OAS_VIEW_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>

        {previewing && (
          <>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10, fontWeight: 700, padding: "2px 8px",
                borderRadius: 4, background: "#fef3c7", color: "#92400e",
                border: "1px solid #fde68a", whiteSpace: "nowrap",
              }}
            >
              表示確認中: {OAS_VIEW_ROLE_LABELS[current]}
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
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
