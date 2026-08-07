// src/__tests__/uzupro-ticket-link-revoke-api.test.ts
//
// 解除 API（POST /api/oas/:id/works/:workId/uzu-pro/ticket-links/:ticketLinkId/revoke）の
// 認可・境界・冪等・情報露出の検証。
//
// ここで守りたいこと:
//   - 未ログイン / 権限なしで解除できない
//   - クライアントが body に userId / oaId / workId を積んでも一切参照されない
//   - 別 OA / 別作品は「存在を露出せず」404
//   - 冪等（already_revoked は 200）
//   - 予約番号をレスポンス・ログへ出さない

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mp = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  activityCreate: vi.fn(),
  txCalls: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const client = {
    ticketLink: {
      findFirst: mp.findFirst,
      updateMany: mp.updateMany,
      delete: mp.delete,
      deleteMany: mp.deleteMany,
    },
    uzuProActivityLog: { create: mp.activityCreate },
    // interactive transaction を再現する。status 更新と ActivityLog 作成は
    // このコールバック内で完結し、throw はそのまま伝播する（= 実 DB では巻き戻る）。
    $transaction: (fn: (tx: unknown) => unknown) => {
      mp.txCalls();
      return fn(client);
    },
  };
  return { prisma: client };
});

const auth = vi.hoisted(() => ({ authorizeUzuPro: vi.fn() }));
vi.mock("@/lib/uzupro-auth", () => ({ authorizeUzuPro: auth.authorizeUzuPro }));

import { POST } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/ticket-links/[ticketLinkId]/revoke/route";

const PARAMS = { id: "oa-1", workId: "w-1", ticketLinkId: "tl-1" };

function req(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/oas/oa-1/works/w-1/uzu-pro/ticket-links/tl-1/revoke", {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

const allow = () => auth.authorizeUzuPro.mockResolvedValue({ ok: true, user: { id: "u-1" }, via: "test" });
const deny = (status: number) =>
  auth.authorizeUzuPro.mockResolvedValue({
    ok: false,
    response: new Response(JSON.stringify({ success: false, error: { code: "X", message: "denied" } }), { status }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mp.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
  mp.updateMany.mockResolvedValue({ count: 1 });
  mp.activityCreate.mockResolvedValue({});
});

describe("認可", () => {
  it("未ログインは 401 のまま返し、DB を触らない", async () => {
    deny(401);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(401);
    expect(mp.findFirst).not.toHaveBeenCalled();
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("for ウズプロ権限なしは 404（存在を露出しない）、DB を触らない", async () => {
    deny(404);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(404);
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("認可は URL の oaId + workId で行う", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(auth.authorizeUzuPro.mock.calls[0].slice(1)).toEqual(["oa-1", "w-1"]);
  });
});

describe("クライアント値を信用しない", () => {
  it("body に別 OA / 別作品 / 別ユーザーを積んでも一切参照しない", async () => {
    allow();
    await POST(req({ oaId: "oa-EVIL", workId: "w-EVIL", userId: "u-EVIL", ticketLinkId: "tl-EVIL" }), { params: PARAMS });

    // DB 条件は URL params（= 認可済み値）のみ
    expect(mp.findFirst.mock.calls[0][0].where).toEqual({ id: "tl-1", oaId: "oa-1", workId: "w-1" });
    // actor はセッション由来
    expect(mp.activityCreate.mock.calls[0][0].data.actorUserId).toBe("u-1");
    expect(JSON.stringify(mp.activityCreate.mock.calls[0][0].data)).not.toContain("EVIL");
  });
});

describe("テナント境界", () => {
  it("別 OA / 別作品 / 不在は 404（区別しない）", async () => {
    allow();
    mp.findFirst.mockResolvedValue(null);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(404);
    const json = await res.json();
    // 存在の有無を推測できる情報を返さない
    expect(JSON.stringify(json)).not.toContain("oa-1");
    expect(JSON.stringify(json)).not.toContain("tl-1");
  });
});

describe("正常系 / 冪等", () => {
  it("解除に成功すると 200 / status=revoked、監査ログを 1 件書く", async () => {
    allow();
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "revoked" });
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate.mock.calls[0][0].data).toMatchObject({
      action: "ticket_link_revoke", targetType: "ticket_link", targetId: "tl-1",
    });
  });

  it("既に解除済みでも 200 / already_revoked（エラーにしない・ログも増やさない）", async () => {
    allow();
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "already_revoked" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("二重送信でも DB 更新は 1 回だけ", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    await POST(req(), { params: PARAMS });
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("物理削除しない", () => {
  it("delete / deleteMany を呼ばない", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(mp.delete).not.toHaveBeenCalled();
    expect(mp.deleteMany).not.toHaveBeenCalled();
  });
});

describe("情報露出", () => {
  it("レスポンスに予約番号を含めない", async () => {
    allow();
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    const res = await POST(req(), { params: PARAMS });
    expect(JSON.stringify(await res.json())).not.toMatch(/\d{3}-\d{3}/);
  });

  it("route は予約番号を select しない（そもそも取得しない）", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    const select = mp.findFirst.mock.calls[0][0].select;
    expect(select.normalizedReservationNumber).toBeUndefined();
    expect(select.reservationNumberRaw).toBeUndefined();
    expect(select.lineUserId).toBeUndefined();
    expect(select.lineDisplayName).toBeUndefined();
  });
});

describe("原子性（status 更新と監査ログを同一トランザクションで行う）", () => {
  it("解除は $transaction を 1 回だけ開き、その中で両方を書く", async () => {
    allow();
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("監査ログの書き込みが失敗したら 200 を返さない（部分成功を成功として返さない）", async () => {
    allow();
    mp.activityCreate.mockRejectedValue(new Error("log write failed"));
    const res = await POST(req(), { params: PARAMS });
    // トランザクションごと失敗 → status も REVOKED にならない
    expect(res.status).toBe(500);
    // 内部エラー詳細をクライアントへ出さない
    expect(JSON.stringify(await res.json())).not.toContain("log write failed");
  });

  it("already_revoked では $transaction 内で 1 件も write しない", async () => {
    allow();
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
    expect(mp.delete).not.toHaveBeenCalled();
    expect(mp.deleteMany).not.toHaveBeenCalled();
  });
});
