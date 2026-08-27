/**
 * src/__tests__/richmenu-delete-route.test.ts
 *
 * DELETE /api/rich-menus/:id — LINE 側を先に片付け、失敗したら DB を消さない。
 * 旧実装は DB レコードだけを削除しており、LINE 側にメニューとデフォルト設定が
 * 残って「削除したのに古いリッチメニューが表示され続ける」事故になった。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";


const h = vi.hoisted(() => ({
  mockRichMenu: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn(), count: vi.fn() },
  mockOaModel:  { update: vi.fn() },
  mockTx:       vi.fn(async (ops: unknown[]) => ops),
  mockDeleteFromLine: vi.fn(async () => ({ defaultCancelled: true, alreadyAbsent: false })),
  mockInvalidate: vi.fn(async () => {}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    richMenu:      h.mockRichMenu,
    oa:            h.mockOaModel,
    $transaction:  (ops: unknown[]) => h.mockTx(ops),
  },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1" }),
}));

vi.mock("@/lib/oa-cache", () => ({
  invalidateOaCacheById: (...a: unknown[]) => h.mockInvalidate(...(a as [])),
}));

vi.mock("@/lib/line-richmenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line-richmenu")>();
  return { ...actual, deleteRichMenuFromLine: (...a: unknown[]) => h.mockDeleteFromLine(...(a as [])) };
});

const { DELETE } = await import("@/app/api/rich-menus/[id]/route");

const req = new Request("http://localhost/api/rich-menus/rm-1", { method: "DELETE" }) as unknown as NextRequest;
const ctx = { params: { id: "rm-1" } };

describe("DELETE /api/rich-menus/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.mockDeleteFromLine.mockResolvedValue({ defaultCancelled: true, alreadyAbsent: false });
    h.mockTx.mockImplementation(async (ops: unknown[]) => ops);
  });

  it("LINE 適用済みなら LINE 側を削除してから DB を消し、Oa.richMenuId をクリアする", async () => {
    h.mockRichMenu.findUnique.mockResolvedValue({
      id: "rm-1", oaId: "oa-1", lineRichMenuId: "richmenu-a",
      oa: { channelAccessToken: "tok", richMenuId: "richmenu-a" },
    });

    const res = await DELETE(req, ctx);

    expect(res.status).toBe(204);
    expect(h.mockDeleteFromLine).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", lineRichMenuId: "richmenu-a" }),
    );
    expect(h.mockRichMenu.delete).toHaveBeenCalledWith({ where: { id: "rm-1" } });
    // dangling 参照の解消
    expect(h.mockOaModel.update).toHaveBeenCalledWith({ where: { id: "oa-1" }, data: { richMenuId: null } });
    expect(h.mockInvalidate).toHaveBeenCalledWith("oa-1");
  });

  it("LINE 側の削除に失敗したら 502 を返し、DB を一切変更しない", async () => {
    h.mockRichMenu.findUnique.mockResolvedValue({
      id: "rm-1", oaId: "oa-1", lineRichMenuId: "richmenu-a",
      oa: { channelAccessToken: "tok", richMenuId: "richmenu-a" },
    });
    h.mockDeleteFromLine.mockRejectedValue(new Error("LINE API HTTP 500: boom"));

    const res = await DELETE(req, ctx);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("LINE_DELETE_ERROR");
    expect(body.error.message).toContain("boom");
    expect(h.mockRichMenu.delete).not.toHaveBeenCalled();
    expect(h.mockOaModel.update).not.toHaveBeenCalled();
  });

  it("未適用 (lineRichMenuId = null) なら LINE API を呼ばず DB だけ削除する", async () => {
    h.mockRichMenu.findUnique.mockResolvedValue({
      id: "rm-1", oaId: "oa-1", lineRichMenuId: null,
      oa: { channelAccessToken: "tok", richMenuId: null },
    });

    const res = await DELETE(req, ctx);

    expect(res.status).toBe(204);
    expect(h.mockDeleteFromLine).not.toHaveBeenCalled();
    expect(h.mockRichMenu.delete).toHaveBeenCalled();
    expect(h.mockOaModel.update).not.toHaveBeenCalled();
  });

  it("Oa.richMenuId が別メニューを指している場合はクリアしない", async () => {
    h.mockRichMenu.findUnique.mockResolvedValue({
      id: "rm-1", oaId: "oa-1", lineRichMenuId: "richmenu-a",
      oa: { channelAccessToken: "tok", richMenuId: "richmenu-b" },
    });

    const res = await DELETE(req, ctx);

    expect(res.status).toBe(204);
    expect(h.mockOaModel.update).not.toHaveBeenCalled();
    expect(h.mockInvalidate).not.toHaveBeenCalled();
  });

  it("存在しない ID は 404（LINE API を呼ばない）", async () => {
    h.mockRichMenu.findUnique.mockResolvedValue(null);

    const res = await DELETE(req, ctx);

    expect(res.status).toBe(404);
    expect(h.mockDeleteFromLine).not.toHaveBeenCalled();
    expect(h.mockRichMenu.delete).not.toHaveBeenCalled();
  });
});
