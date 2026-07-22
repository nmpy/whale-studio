// src/__tests__/uzupro-access-api.test.ts
// GET /api/oas/[id]/works/[workId]/uzu-pro/access — 現在ユーザーの当該作品アクセス可否（3 条件）を返す。
//   - 未認証 → 401
//   - {access, workEnabled, granted, member, canManage} の boolean のみを返す
//   - **他ユーザー / 他 Grant 保持者 / プレイヤー情報は返さない**（boolean 以外を含まない）
// getUzuProAccess / canManageUzuProWork / getAuthUser は mock（api-response は実物）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAccess, mockCanManage, mockGetAuthUser } = vi.hoisted(() => ({
  mockGetAccess: vi.fn(),
  mockCanManage: vi.fn(),
  mockGetAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuthUser: mockGetAuthUser }));
vi.mock("@/lib/uzupro", () => ({
  getUzuProAccess: mockGetAccess,
  canManageUzuProWork: mockCanManage,
}));

import { GET } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/access/route";

const OA = "oa1";
const WORK = "wk1";
const ctx = { params: { id: OA, workId: WORK } };
const getReq = () =>
  new NextRequest(`http://localhost/api/oas/${OA}/works/${WORK}/uzu-pro/access`, { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUser.mockResolvedValue({ id: "user-1" });
});

describe("GET uzu-pro/access", () => {
  it("未認証 → 401（アクセス判定を実行しない）", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(401);
    expect(mockGetAccess).not.toHaveBeenCalled();
    expect(mockCanManage).not.toHaveBeenCalled();
  });

  it("{access, workEnabled, granted, member, canManage} を返す", async () => {
    mockGetAccess.mockResolvedValue({ workEnabled: true, granted: true, member: true, access: true });
    mockCanManage.mockResolvedValue(true);
    const res = await GET(getReq(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      access: true,
      workEnabled: true,
      granted: true,
      member: true,
      canManage: true,
    });
    // 自分の userId/workId を引数にアクセス判定している
    expect(mockGetAccess).toHaveBeenCalledWith(OA, "user-1", WORK);
    expect(mockCanManage).toHaveBeenCalledWith(OA, "user-1");
  });

  it("返すのは boolean 5 キーのみ（ユーザー一覧 / プレイヤー情報を含まない）", async () => {
    mockGetAccess.mockResolvedValue({ workEnabled: false, granted: false, member: true, access: false });
    mockCanManage.mockResolvedValue(false);
    const res = await GET(getReq(), ctx);
    const json = await res.json();
    expect(Object.keys(json.data).sort()).toEqual(
      ["access", "canManage", "granted", "member", "workEnabled"],
    );
    for (const v of Object.values(json.data)) expect(typeof v).toBe("boolean");
    // players / users / grants 等の集合を返さない
    const s = JSON.stringify(json.data);
    for (const leak of ["player", "users", "grants", "email", "lineUserId"]) {
      expect(s).not.toContain(leak);
    }
  });
});
