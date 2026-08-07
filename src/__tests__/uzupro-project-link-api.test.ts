// src/__tests__/uzupro-project-link-api.test.ts
// GET/PATCH /api/oas/[id]/works/[workId]/uzu-pro/project-link — Work ↔ UZU Pro Project の対応設定。
//   - 認可: getAuthUser（未認証→401）+ canManageUzuProWork（owner/platform owner のみ・false→403）
//   - UUID 形式のみ許可（不正→400）。null は明示的な連携解除。
//   - 冪等（現状 === 入力）→ changed:false、update / activity なし
//   - 変更時のみ work.update + recordUzuProActivity
//       set     → work_project_link_set
//       cleared → work_project_link_cleared
//   - レスポンスは {uzuProjectId, changed} のみ（内部情報を漏らさない）
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

import { GET, PATCH } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/project-link/route";

const OA = "oa1";
const WORK = "wk1";
const PROJ = "11111111-1111-4111-8111-111111111111";
const PROJ2 = "22222222-2222-4222-8222-222222222222";
const ctx = { params: { id: OA, workId: WORK } };
const url = `http://localhost/api/oas/${OA}/works/${WORK}/uzu-pro/project-link`;

const patchReq = (body: unknown) =>
  new NextRequest(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getReq = () => new NextRequest(url, { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUser.mockResolvedValue({ id: "owner-1" });
  mockCanManage.mockResolvedValue(true);
});

describe("PATCH uzu-pro/project-link — 認可", () => {
  it("未認証 → 401（権限判定も DB 書き込みもしない）", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(res.status).toBe(401);
    expect(mockCanManage).not.toHaveBeenCalled();
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("変更権限なし → 403 で一切書き込まない", async () => {
    mockCanManage.mockResolvedValue(false);
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(res.status).toBe(403);
    expect(mp.work.findFirst).not.toHaveBeenCalled();
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("権限判定は必ずサーバー側で実行される（クライアント表示に依存しない）", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null });
    mp.work.update.mockResolvedValue({});
    await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(mockCanManage).toHaveBeenCalledWith(OA, "owner-1");
  });
});

describe("PATCH uzu-pro/project-link — 入力検証", () => {
  it.each([
    ["UUID でない文字列", { uzuProjectId: "not-a-uuid" }],
    ["空文字（解除は null で行う）", { uzuProjectId: "" }],
    ["数値", { uzuProjectId: 123 }],
    ["キー欠落", {}],
    ["未知キー混入（strict）", { uzuProjectId: PROJ, extra: 1 }],
  ])("%s → 400 で書き込まない", async (_label, body) => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null });
    const res = await PATCH(patchReq(body), ctx);
    expect(res.status).toBe(400);
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });

  it("作品が当該 OA に無い → 404", async () => {
    mp.work.findFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(res.status).toBe(404);
    expect(mp.work.update).not.toHaveBeenCalled();
  });
});

describe("PATCH uzu-pro/project-link — 設定", () => {
  it("未設定 → 設定で work.update + work_project_link_set を記録", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: PROJ, changed: true });
    expect(mp.work.update.mock.calls[0][0].data).toEqual({ uzuProjectId: PROJ });
    expect(mockRecordActivity).toHaveBeenCalledOnce();
    expect(mockRecordActivity.mock.calls[0][1]).toMatchObject({
      oaId: OA, workId: WORK, actorUserId: "owner-1",
      action: "work_project_link_set", targetType: "work", targetId: WORK,
    });
  });

  it("別 Project へ変更できる", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: PROJ });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ uzuProjectId: PROJ2 }), ctx);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: PROJ2, changed: true });
    expect(mockRecordActivity.mock.calls[0][1].action).toBe("work_project_link_set");
  });

  it("同値 → changed:false（update / activity なし＝冪等）", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: PROJ });
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: PROJ, changed: false });
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });
});

describe("PATCH uzu-pro/project-link — 解除", () => {
  it("null → 解除して work_project_link_cleared を記録", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: PROJ });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ uzuProjectId: null }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: null, changed: true });
    expect(mp.work.update.mock.calls[0][0].data).toEqual({ uzuProjectId: null });
    expect(mockRecordActivity.mock.calls[0][1].action).toBe("work_project_link_cleared");
  });

  it("既に未設定で null → changed:false（冪等）", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null });
    const res = await PATCH(patchReq({ uzuProjectId: null }), ctx);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: null, changed: false });
    expect(mp.work.update).not.toHaveBeenCalled();
    expect(mockRecordActivity).not.toHaveBeenCalled();
  });
});

describe("PATCH uzu-pro/project-link — レスポンス", () => {
  it("レスポンスは {uzuProjectId, changed} のみ（内部情報を含まない）", async () => {
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null, oaId: OA, title: "秘密の作品" });
    mp.work.update.mockResolvedValue({});
    const res = await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    const json = await res.json();
    expect(Object.keys(json.data).sort()).toEqual(["changed", "uzuProjectId"]);
    expect(JSON.stringify(json)).not.toContain("秘密の作品");
  });

  it("UZU 側への外部問い合わせはしない（UUID 形式のみ検証）", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mp.work.findFirst.mockResolvedValue({ id: WORK, uzuProjectId: null });
    mp.work.update.mockResolvedValue({});
    await PATCH(patchReq({ uzuProjectId: PROJ }), ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("GET uzu-pro/project-link", () => {
  it("未認証 → 401", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(401);
  });

  it("権限なし → 403", async () => {
    mockCanManage.mockResolvedValue(false);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(403);
    expect(mp.work.findFirst).not.toHaveBeenCalled();
  });

  it("現在の対応を返す（uzuProjectId のみ）", async () => {
    mp.work.findFirst.mockResolvedValue({ uzuProjectId: PROJ });
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: PROJ });
  });

  it("未設定なら null", async () => {
    mp.work.findFirst.mockResolvedValue({ uzuProjectId: null });
    const res = await GET(getReq(), ctx);
    const json = await res.json();
    expect(json.data).toEqual({ uzuProjectId: null });
  });

  it("作品が無ければ 404", async () => {
    mp.work.findFirst.mockResolvedValue(null);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
  });
});
