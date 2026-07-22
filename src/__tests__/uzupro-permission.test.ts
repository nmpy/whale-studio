// src/__tests__/uzupro-permission.test.ts
//
// for ウズプロ（UZU_PRO）の権限判定 + サイドバー出し分けの検証。
//   アクセス条件（確定モデル・3 条件の AND）:
//     (1) Work.uzuProEnabled = true（作品単位で有効化済み）
//     (2) per-user 利用権限 UzuProGrant 保有（platform owner でも明示 Grant 必須・迂回不可）
//     (3) 対象 OA の active メンバー
//   canAccessUzuPro / getUzuProAccess はこの 3 条件を正本として判定する。
//   canManageUzuProWork は owner(active) / platform owner のみ true。
//   buildWorkSidebarSections: uzuProAccess=false で「FOR ウズプロ」非表示、true で表示（href 検証）。
//
// vi.mock factory はファイル先頭へ巻き上げられ、uzupro.ts の static import 評価より先に走る。
// 参照する mock 群は vi.hoisted で同じく巻き上げて初期化順の問題を避ける。

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  mockUzuProGrant: { findUnique: vi.fn() },
  mockWork: { findFirst: vi.fn() },
  mockGetWorkspaceRole: vi.fn(),
  state: { platformOwner: false },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { uzuProGrant: h.mockUzuProGrant, work: h.mockWork },
}));

vi.mock("@/lib/platform-admin", () => ({
  isPlatformOwner: (..._args: unknown[]) => h.state.platformOwner,
}));

vi.mock("@/lib/rbac", () => ({
  getWorkspaceRole: (...args: unknown[]) => h.mockGetWorkspaceRole(...args),
}));

import {
  getUzuProAccess,
  canAccessUzuPro,
  isWorkUzuProEnabled,
  canManageUzuProWork,
} from "@/lib/uzupro";
import { buildWorkSidebarSections } from "@/app/oas/[id]/_lib/work-sidebar-nav";

const OA = "oa-1";
const USER = "user-1";
const WORK = "wk1";

// (1) 作品有効化: work.findFirst が uzuProEnabled を返す
const workEnabled = () => h.mockWork.findFirst.mockResolvedValue({ uzuProEnabled: true });
const workDisabled = () => h.mockWork.findFirst.mockResolvedValue({ uzuProEnabled: false });
const workMissing = () => h.mockWork.findFirst.mockResolvedValue(null);
// (2) grant 行あり = findUnique が非 null を返す
const grantRow = () => h.mockUzuProGrant.findUnique.mockResolvedValue({ id: "grant-1" });
const noGrant = () => h.mockUzuProGrant.findUnique.mockResolvedValue(null);
// (3) active メンバー = getWorkspaceRole が status:"active" を返す
const activeMember = () => h.mockGetWorkspaceRole.mockResolvedValue({ role: "editor", status: "active" });
const inactiveMember = () => h.mockGetWorkspaceRole.mockResolvedValue({ role: "editor", status: "invited" });
const notMember = () => h.mockGetWorkspaceRole.mockResolvedValue(null);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.platformOwner = false;
});

describe("isWorkUzuProEnabled — 作品単位の有効化フラグ", () => {
  it("既定 false: work.findFirst({where:{id,oaId},select:{uzuProEnabled}}) を読み、uzuProEnabled=false で false", async () => {
    workDisabled();
    expect(await isWorkUzuProEnabled(OA, WORK)).toBe(false);
    expect(h.mockWork.findFirst).toHaveBeenCalledWith({
      where: { id: WORK, oaId: OA },
      select: { uzuProEnabled: true },
    });
  });

  it("有効化済み → true", async () => {
    workEnabled();
    expect(await isWorkUzuProEnabled(OA, WORK)).toBe(true);
  });

  it("作品が当該 OA に無い（findFirst null）→ false", async () => {
    workMissing();
    expect(await isWorkUzuProEnabled(OA, WORK)).toBe(false);
  });
});

describe("getUzuProAccess / canAccessUzuPro — 3 条件の AND", () => {
  it("(a) 3 条件すべて満たす → access true（4 boolean 正）", async () => {
    workEnabled();
    grantRow();
    activeMember();
    expect(await getUzuProAccess(OA, USER, WORK)).toEqual({
      workEnabled: true,
      granted: true,
      member: true,
      access: true,
    });
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(true);
  });

  it("(b) grant 無し → access false", async () => {
    workEnabled();
    noGrant();
    activeMember();
    expect(await getUzuProAccess(OA, USER, WORK)).toEqual({
      workEnabled: true,
      granted: false,
      member: true,
      access: false,
    });
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(false);
  });

  it("(c) 作品未有効化 → access false", async () => {
    workDisabled();
    grantRow();
    activeMember();
    expect(await getUzuProAccess(OA, USER, WORK)).toEqual({
      workEnabled: false,
      granted: true,
      member: true,
      access: false,
    });
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(false);
  });

  it("(d) active メンバーでない → access false（notMember / invited いずれも）", async () => {
    workEnabled();
    grantRow();
    notMember();
    expect(await getUzuProAccess(OA, USER, WORK)).toEqual({
      workEnabled: true,
      granted: true,
      member: false,
      access: false,
    });
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(false);

    workEnabled();
    grantRow();
    inactiveMember();
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(false);
  });

  it("(e) platform owner でも Grant 無しなら access false（迂回不可）", async () => {
    h.state.platformOwner = true;
    workEnabled();
    noGrant();
    activeMember();
    expect(await getUzuProAccess(OA, USER, WORK)).toEqual({
      workEnabled: true,
      granted: false,
      member: true,
      access: false,
    });
    expect(await canAccessUzuPro(OA, USER, WORK)).toBe(false);
    // Grant 必須なので UzuProGrant を必ず参照する（isPlatformOwner 短絡で迂回しない）
    expect(h.mockUzuProGrant.findUnique).toHaveBeenCalled();
  });

  it("引数が空なら常に false（workId 欠落含む）", async () => {
    expect(await getUzuProAccess(OA, "", WORK)).toEqual({
      workEnabled: false,
      granted: false,
      member: false,
      access: false,
    });
    expect(await canAccessUzuPro(OA, USER, "")).toBe(false);
  });
});

describe("canManageUzuProWork — 作品有効化を変更できるロール", () => {
  it("owner(active) → true", async () => {
    h.mockGetWorkspaceRole.mockResolvedValue({ role: "owner", status: "active" });
    expect(await canManageUzuProWork(OA, USER)).toBe(true);
  });

  it("platform owner → true（getWorkspaceRole を待たず short-circuit）", async () => {
    h.state.platformOwner = true;
    expect(await canManageUzuProWork(OA, USER)).toBe(true);
  });

  it("editor / tester / viewer → false", async () => {
    for (const role of ["editor", "tester", "viewer"]) {
      h.mockGetWorkspaceRole.mockResolvedValue({ role, status: "active" });
      expect(await canManageUzuProWork(OA, USER)).toBe(false);
    }
  });

  it("owner でも status が active でない → false", async () => {
    h.mockGetWorkspaceRole.mockResolvedValue({ role: "owner", status: "invited" });
    expect(await canManageUzuProWork(OA, USER)).toBe(false);
  });

  it("非メンバー → false", async () => {
    h.mockGetWorkspaceRole.mockResolvedValue(null);
    expect(await canManageUzuProWork(OA, USER)).toBe(false);
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

  it("uzuProAccess=true → 連携状況（ランディング）→ プレイヤー の順で表示", () => {
    const sec = uzuSection(true);
    expect(sec).toBeDefined();
    expect(sec!.items.map((i) => i.label)).toEqual(["連携状況", "プレイヤー"]);

    const [status, player] = sec!.items;
    // 連携状況（新規・ランディング）
    expect(status.key).toBe("uzupro-status");
    expect(status.href).toBe(`/oas/${OA}/works/wk1/uzu-pro/status`);
    expect(status.activeSegments).toEqual(["/uzu-pro/status"]);
    // プレイヤー（既存導線が壊れない: href 不変・自分のパスで active）
    expect(player.key).toBe("uzupro-player");
    expect(player.href).toBe(`/oas/${OA}/works/wk1/uzu-pro/player`);
    expect(player.activeSegments).toEqual(["/uzu-pro/player"]);
  });
});
