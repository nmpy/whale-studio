// src/__tests__/uzupro-permission.test.ts
//
// for ウズプロ（UZU_PRO）の権限判定 + サイドバー出し分けの検証。
//   - getUzuProAccess / canAccessUzuPro（@/lib/uzupro）:
//       アクセス条件 = 「per-user grant 保有 かつ 対象 OA の active メンバー」。
//       platform owner でも Grant が無ければ access false（迂回不可・spec §5）。
//   - buildWorkSidebarSections: uzuProAccess=false で「FOR ウズプロ」非表示、true で表示（href 検証）。
//
// vi.mock factory はファイル先頭へ巻き上げられ、uzupro.ts の static import 評価より先に走る。
// 参照する mock 群は vi.hoisted で同じく巻き上げて初期化順の問題を避ける。

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  mockUzuProGrant: { findUnique: vi.fn() },
  mockGetWorkspaceRole: vi.fn(),
  state: { platformOwner: false },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { uzuProGrant: h.mockUzuProGrant },
}));

vi.mock("@/lib/platform-admin", () => ({
  isPlatformOwner: (..._args: unknown[]) => h.state.platformOwner,
}));

vi.mock("@/lib/rbac", () => ({
  getWorkspaceRole: (...args: unknown[]) => h.mockGetWorkspaceRole(...args),
}));

import { getUzuProAccess, canAccessUzuPro } from "@/lib/uzupro";
import { buildWorkSidebarSections } from "@/app/oas/[id]/_lib/work-sidebar-nav";

const OA = "oa-1";
const USER = "user-1";

// grant 行あり = findUnique が非 null を返す
const grantRow = () => h.mockUzuProGrant.findUnique.mockResolvedValue({ id: "grant-1" });
const noGrant = () => h.mockUzuProGrant.findUnique.mockResolvedValue(null);
// active メンバー = getWorkspaceRole が status:"active" を返す
const activeMember = () => h.mockGetWorkspaceRole.mockResolvedValue({ role: "editor", status: "active" });
const inactiveMember = () => h.mockGetWorkspaceRole.mockResolvedValue({ role: "editor", status: "invited" });
const notMember = () => h.mockGetWorkspaceRole.mockResolvedValue(null);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.platformOwner = false;
});

describe("getUzuProAccess / canAccessUzuPro — 権限判定", () => {
  it("(a) grant 無し → access false（membership は問わない）", async () => {
    noGrant();
    activeMember();
    expect(await getUzuProAccess(OA, USER)).toEqual({ granted: false, access: false });
    expect(await canAccessUzuPro(OA, USER)).toBe(false);
  });

  it("(b) grant あり だが active メンバーでない → granted true / access false", async () => {
    grantRow();
    notMember();
    expect(await getUzuProAccess(OA, USER)).toEqual({ granted: true, access: false });
    expect(await canAccessUzuPro(OA, USER)).toBe(false);

    // active 以外の status（invited 等）も access false
    grantRow();
    inactiveMember();
    expect(await canAccessUzuPro(OA, USER)).toBe(false);
  });

  it("(c) grant あり かつ active メンバー → granted true / access true", async () => {
    grantRow();
    activeMember();
    expect(await getUzuProAccess(OA, USER)).toEqual({ granted: true, access: true });
    expect(await canAccessUzuPro(OA, USER)).toBe(true);
  });

  it("(d) platform owner でも Grant 無しなら access false（迂回不可・spec §5）", async () => {
    h.state.platformOwner = true;
    noGrant();
    activeMember();
    expect(await getUzuProAccess(OA, USER)).toEqual({ granted: false, access: false });
    expect(await canAccessUzuPro(OA, USER)).toBe(false);
    // Grant 必須なので UzuProGrant を必ず参照する（isPlatformOwner 短絡で迂回しない）
    expect(h.mockUzuProGrant.findUnique).toHaveBeenCalled();
  });

  it("(d2) platform owner + Grant + active メンバー → access true", async () => {
    h.state.platformOwner = true;
    grantRow();
    activeMember();
    expect(await getUzuProAccess(OA, USER)).toEqual({ granted: true, access: true });
    expect(await canAccessUzuPro(OA, USER)).toBe(true);
  });

  it("userId が空なら常に false", async () => {
    expect(await getUzuProAccess(OA, "")).toEqual({ granted: false, access: false });
    expect(await canAccessUzuPro(OA, "")).toBe(false);
  });
});

describe("buildWorkSidebarSections — FOR ウズプロ の出し分け", () => {
  const build = (uzuProAccess?: boolean) =>
    buildWorkSidebarSections({ oaId: OA, workId: "wk1", isTester: false, uzuProAccess });
  const uzuSection = (uzuProAccess?: boolean) =>
    build(uzuProAccess).find((s) => s.heading === "FOR ウズプロ");

  it("uzuProAccess 未指定（既定）→ FOR ウズプロ セクションは無い", () => {
    expect(uzuSection()).toBeUndefined();
  });

  it("uzuProAccess=false → FOR ウズプロ セクションは無い", () => {
    expect(uzuSection(false)).toBeUndefined();
  });

  it("uzuProAccess=true → FOR ウズプロ セクションに プレイヤー（href = {base}/uzu-pro/player）", () => {
    const sec = uzuSection(true);
    expect(sec).toBeDefined();
    expect(sec!.items.map((i) => i.label)).toEqual(["プレイヤー"]);
    const it0 = sec!.items[0];
    expect(it0.key).toBe("uzupro-player");
    expect(it0.href).toBe(`/oas/${OA}/works/wk1/uzu-pro/player`);
    expect(it0.activeSegments).toEqual(["/uzu-pro"]);
  });
});
