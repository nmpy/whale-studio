// src/__tests__/uzupro-enable-api.test.ts
// PATCH /api/oas/[id]/works/[workId]/uzu-pro/enable — 作品単位の for UZU Pro 有効化/無効化。
//   - 認可: getAuthUser（未認証→401）+ canManageUzuProWork（owner/platform owner のみ・false→403）
//   - 変更時のみ work.update + recordUzuProActivity（work_enabled / work_disabled）
//   - 冪等（現状 === enabled）→ changed:false、update / activity なし
//   - 作品が当該 OA に無い（findFirst null）→ 404
//   - strict body: 未知キー → 400
//   - レスポンスは {uzuProEnabled, changed} のみ（PII / 内部情報を漏らさない）
// canManageUzuProWork / getAuthUser / prisma / recordUzuProActivity は mock（api-response は実物）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp, mockCanManage, mockGetAuthUser, mockRecordActivity } = vi.hoisted(() => ({
  mp: { work: { findFirst: vi.fn(), update: vi.fn() } },
  mockCanManage: vi.fn(),
  mockGetAuthUser: vi.fn(),
  mockRecordActivity: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mp }));
vi.mock("@/lib/auth", () => ({ getAuthUser: mockGetAuthUser }));
vi.mock("@/lib/uzupro", () => ({ canManageUzuProWork: mockCanManage }));
vi.mock("@/lib/uzupro/activity", () => ({ recordUzuProActivity: mockRecordActivity }));

import { PATCH } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/enable/route";

const OA = "oa1";
const WORK = "wk1";
const ctx = { params: { id: OA, workId: WORK } };
const patchReq = (body: unknown) =>
  new NextRequest(`http://localhost/api/oas/${OA}/works/${WORK}/uzu-pro/enable`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUser.mockResolvedValue({ id: "owner-1" });
  mockCanManage.mockResolvedValue(true);
});

describe("PATCH uzu-pro/enable", () => {
  it("未認証 → 401（権限判定も DB 書き込みもしない）", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    expect(res.status).toBe(401);
    expect(mockCanManage).not.toHaveBeenCalled();
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("変更権限なし（canManageUzuProWork=false）→ 403 で一切書き込まない", async () => {
    mockCanManage.mockResolvedValue(false);
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    expect(res.status).toBe(403);
    expect(mp.work.findFirst).not.toHaveBeenCalled();
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("owner/platform: 無効→有効 で work.update + activity work_enabled、changed:true", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProEnabled: false });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ uzuProEnabled: true, changed: true });
    expect(mp.work.update.mock.calls[0][0]).toMatchObject({
      where: { id: WORK },
      data: { uzuProEnabled: true },
    });
    expect(mockRecordActivity).toHaveBeenCalledTimes(1);
    expect(mockRecordActivity.mock.calls[0][1]).toMatchObject({
      oaId: OA,
      workId: WORK,
      actorUserId: "owner-1",
      action: "work_enabled",
      targetType: "work",
      targetId: WORK,
    });
  });

  it("有効→無効 で activity work_disabled、changed:true", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProEnabled: true });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ enabled: false }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ uzuProEnabled: false, changed: true });
    expect(mp.work.update.mock.calls[0][0].data).toEqual({ uzuProEnabled: false });
    expect(mockRecordActivity.mock.calls[0][1].action).toBe("work_disabled");
  });

  it("冪等（現状 === enabled）→ changed:false、update / activity なし", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProEnabled: true });
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ uzuProEnabled: true, changed: false });
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("作品が当該 OA に無い（findFirst null）→ 404、書き込みなし", async () => {
    mp.work.findFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    expect(res.status).toBe(404);
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("strict: 未知キーを含む body → 400（update / activity なし）", async () => {
    const res = await PATCH(patchReq({ enabled: true, force: true }), ctx);
    expect(res.status).toBe(400);
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("レスポンスは {uzuProEnabled, changed} のみ（PII / 内部情報を漏らさない）", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProEnabled: false });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ enabled: true }), ctx);
    const json = await res.json();
    expect(Object.keys(json.data).sort()).toEqual(["changed", "uzuProEnabled"]);
    // work id / userId / player 等の識別子を返さない
    expect(JSON.stringify(json.data)).not.toContain(WORK);
    expect(JSON.stringify(json.data)).not.toContain("owner-1");
  });
});
