/**
 * src/__tests__/owner-key-resolution.test.ts
 *
 * getWorkspaceRole の owner_key / ADMIN_IDENTITY 判定テスト
 *
 * owner_key 最優先 → ADMIN_IDENTITY → WorkspaceMember の順で判定されることを検証。
 * 特に「WorkspaceMember に editor が入っていても ADMIN_IDENTITY なら owner」を保証する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 関数を hoisted で定義 ──────────────────────────────────────
const { mockFindUniqueMember, mockFindUniqueOa } = vi.hoisted(() => ({
  mockFindUniqueMember: vi.fn(),
  mockFindUniqueOa:     vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceMember: { findUnique: mockFindUniqueMember },
    oa:              { findUnique: mockFindUniqueOa },
  },
}));

import { getWorkspaceRole } from "@/lib/rbac";

const WS_ID   = "oa-test-001";
const USER_ID  = "user-real-001";
const OTHER_ID = "user-other-002";

describe("getWorkspaceRole — owner_key resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルト: 本番環境を想定
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("ADMIN_IDENTITY", USER_ID);
  });

  // ── owner_key 一致 → owner ──────────────────────────────────────
  it("owner_key が userId と一致する場合は owner を返す", async () => {
    mockFindUniqueOa.mockResolvedValue({ ownerKey: USER_ID });
    // WorkspaceMember に editor が入っていても owner_key が勝つ
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, USER_ID);

    expect(result).toEqual({ role: "owner", status: "active" });
    // WorkspaceMember は参照されない（owner_key で先に return するため）
    expect(mockFindUniqueMember).not.toHaveBeenCalled();
  });

  // ── owner_key 不一致 → WorkspaceMember fallback ─────────────────
  it("owner_key が別ユーザーの場合は WorkspaceMember の role を返す", async () => {
    mockFindUniqueOa.mockResolvedValue({ ownerKey: "someone-else" });
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, USER_ID);

    expect(result).toEqual({ role: "editor", status: "active" });
  });

  // ── ADMIN_IDENTITY 一致（owner_key=null, migration 未適用を含む）──
  it("owner_key=null かつ ADMIN_IDENTITY 一致なら WorkspaceMember より優先して owner を返す", async () => {
    mockFindUniqueOa.mockResolvedValue({ ownerKey: null });
    // WorkspaceMember に editor がある場合でも ADMIN_IDENTITY が勝つ
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, USER_ID);

    expect(result).toEqual({ role: "owner", status: "active" });
    // WorkspaceMember は参照されない
    expect(mockFindUniqueMember).not.toHaveBeenCalled();
  });

  // ── migration 未適用（owner_key カラム不存在）──────────────────
  it("owner_key lookup が例外を投げた場合でも ADMIN_IDENTITY 一致なら owner を返す", async () => {
    mockFindUniqueOa.mockRejectedValue(new Error("column owner_key does not exist"));
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, USER_ID);

    // ownerKey = null（try-catch 内で初期値のまま）→ ADMIN_IDENTITY フォールバック
    expect(result).toEqual({ role: "owner", status: "active" });
  });

  // ── ADMIN_IDENTITY 不一致 → 通常の WorkspaceMember 判定 ────────
  it("ADMIN_IDENTITY に一致しない他ユーザーは WorkspaceMember の role を返す", async () => {
    mockFindUniqueOa.mockResolvedValue({ ownerKey: null });
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, OTHER_ID);

    expect(result).toEqual({ role: "editor", status: "active" });
  });

  // ── メンバー未登録 + ADMIN_IDENTITY 不一致 → null ──────────────
  it("メンバー未登録かつ ADMIN_IDENTITY 不一致なら null を返す", async () => {
    mockFindUniqueOa.mockResolvedValue({ ownerKey: null });
    mockFindUniqueMember.mockResolvedValue(null);

    const result = await getWorkspaceRole(WS_ID, OTHER_ID);

    expect(result).toBeNull();
  });

  // ── ADMIN_IDENTITY 未設定 → WorkspaceMember fallback ───────────
  it("ADMIN_IDENTITY が未設定なら owner_key=null でも WorkspaceMember を使う", async () => {
    vi.stubEnv("ADMIN_IDENTITY", "");
    mockFindUniqueOa.mockResolvedValue({ ownerKey: null });
    mockFindUniqueMember.mockResolvedValue({ role: "editor", status: "active" });

    const result = await getWorkspaceRole(WS_ID, USER_ID);

    expect(result).toEqual({ role: "editor", status: "active" });
  });
});
