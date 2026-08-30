// src/__tests__/uzupro-manager-auth.test.ts
// authorizeUzuProManager: canAccessUzuPro（3条件）AND isAuthorizedLiffManager（allowlist）。
//   - 未ログイン → 401
//   - 3 条件不足 → 404（存在露出しない一般化）
//   - 3 条件 OK だが LIFF 管理者でない → 404（管理者の存在も露出しない）
//   - 両方 OK → ok / via=liff_manager
//   - リクエスト body の userId 偽装は判定に使わない（getAuthUser の id のみ）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getAuthUser } = vi.hoisted(() => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser }));

const { canAccessUzuPro } = vi.hoisted(() => ({ canAccessUzuPro: vi.fn() }));
vi.mock("@/lib/uzupro", () => ({ canAccessUzuPro }));

const { isAuthorizedLiffManager } = vi.hoisted(() => ({ isAuthorizedLiffManager: vi.fn() }));
vi.mock("@/lib/uzupro/liff-manager", () => ({ isAuthorizedLiffManager }));

import { authorizeUzuProManager } from "@/lib/uzupro-auth";

const OA = "oa1";
const WORK = "w1";
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/oas/oa1/works/w1/uzu-pro/players/p1/line/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("authorizeUzuProManager", () => {
  it("未ログイン → 401", async () => {
    getAuthUser.mockResolvedValue(null);
    const r = await authorizeUzuProManager(req(), OA, WORK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
    expect(canAccessUzuPro).not.toHaveBeenCalled();
  });

  it("3条件不足（canAccessUzuPro=false）→ 404、管理者判定に依らず拒否", async () => {
    getAuthUser.mockResolvedValue({ id: "u1" });
    canAccessUzuPro.mockResolvedValue(false);
    isAuthorizedLiffManager.mockReturnValue(true);
    const r = await authorizeUzuProManager(req(), OA, WORK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(404);
  });

  it("3条件OKでも LIFF 管理者でない → 404（管理者存在を露出しない）", async () => {
    getAuthUser.mockResolvedValue({ id: "u1" });
    canAccessUzuPro.mockResolvedValue(true);
    isAuthorizedLiffManager.mockReturnValue(false);
    const r = await authorizeUzuProManager(req(), OA, WORK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(404);
  });

  it("両方OK → ok / via=liff_manager、判定は getAuthUser の id のみ（body の userId 偽装不使用）", async () => {
    getAuthUser.mockResolvedValue({ id: "real-user" });
    canAccessUzuPro.mockResolvedValue(true);
    isAuthorizedLiffManager.mockReturnValue(true);
    const r = await authorizeUzuProManager(req({ userId: "attacker-id" }), OA, WORK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe("real-user");
      expect(r.via).toBe("liff_manager");
    }
    // 管理者判定は認証済みユーザーの id で行う（body 由来ではない）。
    expect(isAuthorizedLiffManager).toHaveBeenCalledWith("real-user");
    expect(canAccessUzuPro).toHaveBeenCalledWith(OA, "real-user", WORK);
  });
});
