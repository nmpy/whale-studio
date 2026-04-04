"use client";

/**
 * PermissionGuard — ロールに応じて子要素を制御するコンポーネント群
 *
 * ロール階層（高 → 低）: owner > admin > editor > viewer
 *
 * @example
 * // 閲覧専用帯（viewer に表示）
 * <ViewerBanner role={role} />
 *
 * // owner のみ表示
 * <OwnerOnly role={role}><button>削除</button></OwnerOnly>
 *
 * // editor 以上のみ表示
 * <EditorAndAbove role={role}><button>保存</button></EditorAndAbove>
 *
 * // viewer なら disabled にする
 * <EditableField role={role} readOnly={isViewer}>...</EditableField>
 */

import type { Role } from "@/lib/types/permissions";
import { roleAtLeast } from "@/lib/types/permissions";

// ── 型 ────────────────────────────────────────────────
interface RoleProps {
  role:     Role | null;
  children: React.ReactNode;
  /** ロール未取得中（loading）は何も表示しないか fallback を表示 */
  fallback?: React.ReactNode;
}

// ── owner のみ表示 ────────────────────────────────────
export function OwnerOnly({ role, children, fallback = null }: RoleProps) {
  if (role === null) return <>{fallback}</>;
  return role === "owner" ? <>{children}</> : <>{fallback}</>;
}

// ── admin 以上のみ表示 ───────────────────────────────
export function AdminAndAbove({ role, children, fallback = null }: RoleProps) {
  if (role === null) return <>{fallback}</>;
  return roleAtLeast(role, "admin") ? <>{children}</> : <>{fallback}</>;
}

// ── editor 以上のみ表示 ──────────────────────────────
export function EditorAndAbove({ role, children, fallback = null }: RoleProps) {
  if (role === null) return <>{fallback}</>;
  return roleAtLeast(role, "editor") ? <>{children}</> : <>{fallback}</>;
}

// ── viewer のみ表示（editor/admin/owner には非表示） ───
export function ViewerOnly({ role, children }: Omit<RoleProps, "fallback">) {
  return role === "viewer" ? <>{children}</> : null;
}

// ── 閲覧専用バナー（viewer ロール向け） ─────────────
export function ViewerBanner({ role }: { role: Role | null }) {
  if (role !== "viewer") return null;
  return (
    <div
      style={{
        background: "#fffbeb",
        border:     "1px solid #fde68a",
        borderRadius: 8,
        padding:    "8px 14px",
        fontSize:   13,
        color:      "#92400e",
        display:    "flex",
        alignItems: "center",
        gap:        8,
      }}
    >
      <span>👁</span>
      <span>このワークスペースは<strong>閲覧専用</strong>です。編集・保存はできません。</span>
    </div>
  );
}

// ── ロールバッジ ─────────────────────────────────────
const BADGE_STYLES: Record<Role, React.CSSProperties> = {
  owner: {
    background: "#eff6ff", color: "#1d4ed8",
    border: "1px solid #bfdbfe",
  },
  admin: {
    background: "#faf5ff", color: "#7c3aed",
    border: "1px solid #ddd6fe",
  },
  editor: {
    background: "#f0fdf4", color: "#15803d",
    border: "1px solid #bbf7d0",
  },
  viewer: {
    background: "#f9fafb", color: "#6b7280",
    border: "1px solid #e5e7eb",
  },
};

const ROLE_LABELS: Record<Role, string> = {
  owner:  "オーナー",
  admin:  "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      style={{
        ...BADGE_STYLES[role],
        fontSize:     11,
        fontWeight:   700,
        padding:      "2px 8px",
        borderRadius: 20,
        display:      "inline-block",
        letterSpacing: ".02em",
      }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
