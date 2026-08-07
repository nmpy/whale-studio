// src/__tests__/uzupro-ticket-link-replace-api.test.ts
//
// 「内容を修正」API（POST .../ticket-links/:ticketLinkId/replace）の
// 認可・境界・入力信頼境界・情報露出の検証（PR-C）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mp = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  workFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  txCalls: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    ticketLink: {
      findFirst: mp.findFirst, updateMany: mp.updateMany, update: mp.update,
      delete: mp.delete, deleteMany: mp.deleteMany, create: mp.create,
    },
    work: { findFirst: mp.workFindFirst },
    uzuProActivityLog: { create: mp.activityCreate },
    $transaction: (fn: (tx: unknown) => unknown) => { mp.txCalls(); return fn(client); },
  };
  return { prisma: client };
});

const auth = vi.hoisted(() => ({ authorizeUzuPro: vi.fn() }));
vi.mock("@/lib/uzupro-auth", () => ({ authorizeUzuPro: auth.authorizeUzuPro }));

import { POST } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/ticket-links/[ticketLinkId]/replace/route";

const PARAMS = { id: "oa-1", workId: "w-1", ticketLinkId: "tl-old" };

const SETTINGS = {
  ticket_link: {
    enabled: true, manualInputEnabled: true,
    ticketTypes: [
      { ticketTypeKey: "solo", ticketTypeLabel: "1名チケット", participantCount: 1, enabled: true, sortOrder: 0 },
      { ticketTypeKey: "quad", ticketTypeLabel: "4名グループ", participantCount: 4, enabled: true, sortOrder: 1 },
    ],
  },
};

const BODY = { ticketTypeKey: "quad", reservationNumber: "999-888", codeNames: ["A", "B", "C", "D"] };

function req(body: unknown = BODY): NextRequest {
  return new NextRequest("http://localhost/api/oas/oa-1/works/w-1/uzu-pro/ticket-links/tl-old/replace", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const allow = () => auth.authorizeUzuPro.mockResolvedValue({ ok: true, user: { id: "u-actor" }, via: "test" });
const deny = (status: number) =>
  auth.authorizeUzuPro.mockResolvedValue({
    ok: false,
    response: new Response(JSON.stringify({ success: false, error: { code: "X", message: "denied" } }), { status }),
  });

const OLD = {
  id: "tl-old", status: "PENDING_UZU_BOOKING",
  lineUserId: "Uplayer", lineDisplayName: "たろう", source: "LIFF_MANUAL",
  normalizedReservationNumber: "123-456", ticketTypeKey: "solo", participantCount: 1,
  members: [{ codeName: "アリス" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks は once キューを消さない。テスト間で持ち越さないよう明示的に reset する。
  mp.findFirst.mockReset();
  mp.updateMany.mockReset();
  mp.create.mockReset();
  mp.findFirst.mockResolvedValueOnce(OLD).mockResolvedValue(null);
  mp.workFindFirst.mockResolvedValue({ liffHomeSettingsJson: SETTINGS });
  mp.updateMany.mockResolvedValue({ count: 1 });
  mp.create.mockResolvedValue({ id: "tl-new" });
  mp.activityCreate.mockResolvedValue({});
});

describe("認可", () => {
  it("未ログインは 401 のまま返し、DB を触らない", async () => {
    deny(401);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(401);
    expect(mp.findFirst).not.toHaveBeenCalled();
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("for ウズプロ権限なしは 404（存在を露出しない）", async () => {
    deny(404);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(404);
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("認可は URL の oaId + workId で行う", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(auth.authorizeUzuPro.mock.calls[0].slice(1)).toEqual(["oa-1", "w-1"]);
  });
});

describe("クライアント値を信用しない", () => {
  it.each(["userId", "lineUserId", "oaId", "workId", "status", "actorUserId", "participantCount"])(
    "body に %s が混ざっていれば 400 で弾き、何も書き込まない",
    async (field) => {
      allow();
      const res = await POST(req({ ...BODY, [field]: "EVIL" }), { params: PARAMS });
      expect(res.status).toBe(400);
      expect(mp.updateMany).not.toHaveBeenCalled();
      expect(mp.create).not.toHaveBeenCalled();
    },
  );

  it("DB 条件は URL params（認可済み値）のみ、actor はセッション由来", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(mp.findFirst.mock.calls[0][0].where).toEqual({ id: "tl-old", oaId: "oa-1", workId: "w-1" });
    expect(mp.activityCreate.mock.calls[0][0].data.actorUserId).toBe("u-actor");
  });

  it("ownership は旧リンクから引き継ぐ（クライアントは指定できない）", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(mp.create.mock.calls[0][0].data.lineUserId).toBe("Uplayer");
  });
});

describe("正常系 / 結果の写像", () => {
  it("修正成功は 200 / status=replaced、内部 ID を返さない", async () => {
    allow();
    const res = await POST(req(), { params: PARAMS });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ status: "replaced" });
    expect(JSON.stringify(json)).not.toContain("tl-new");
    expect(JSON.stringify(json)).not.toContain("tl-old");
  });

  it("no-op は 200 / status=no_change（書き込みなし）", async () => {
    allow();
    const res = await POST(
      req({ ticketTypeKey: "solo", reservationNumber: "123-456", codeNames: ["アリス"] }),
      { params: PARAMS },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "no_change" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("入力不正は 400（内部情報を出さない）", async () => {
    allow();
    const res = await POST(req({ ...BODY, reservationNumber: "12345" }), { params: PARAMS });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("Prisma");
  });

  it("予約番号の先約は 409 + 業務メッセージ（Prisma error を出さない）", async () => {
    allow();
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValueOnce(OLD).mockResolvedValueOnce({ id: "tl-other" });
    const res = await POST(req(), { params: PARAMS });
    const body = JSON.stringify(await res.json());
    expect(res.status).toBe(409);
    expect(body).toContain("すでに別の有効な連携で使用されています");
    expect(body).not.toContain("P2002");
  });

  it("解除済みは 409（修正できない）", async () => {
    allow();
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValueOnce({ ...OLD, status: "REVOKED" }).mockResolvedValue(null);
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(409);
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("並行更新で CAS が上限まで外れたら 409", async () => {
    allow();
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValueOnce(OLD).mockResolvedValueOnce(null).mockResolvedValue({ status: "LINKED" });
    mp.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(409);
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("別 OA / 別作品 / 不在は 404、識別子を返さない", async () => {
    allow();
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValue(null);
    const res = await POST(req(), { params: PARAMS });
    const body = JSON.stringify(await res.json());
    expect(res.status).toBe(404);
    expect(body).not.toContain("tl-old");
    expect(body).not.toContain("oa-1");
  });

  it("DB error は 409 ではなく 500", async () => {
    allow();
    mp.updateMany.mockRejectedValue(new Error("db down"));
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(500);
  });
});

describe("原子性", () => {
  it("$transaction を 1 回だけ開き、解除・作成・ログを実行する", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
    expect(mp.create).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("監査ログ失敗時は 200 を返さない（部分成功を成功として返さない）", async () => {
    allow();
    mp.activityCreate.mockRejectedValue(new Error("log write failed"));
    const res = await POST(req(), { params: PARAMS });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("log write failed");
  });
});

describe("情報露出", () => {
  it("レスポンスに予約番号 / コードネーム / LINE UID / 表示名を含めない", async () => {
    allow();
    const res = await POST(req(), { params: PARAMS });
    const body = JSON.stringify(await res.json());
    for (const secret of ["999-888", "123-456", "アリス", "Uplayer", "たろう"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("物理削除しない", async () => {
    allow();
    await POST(req(), { params: PARAMS });
    expect(mp.delete).not.toHaveBeenCalled();
    expect(mp.deleteMany).not.toHaveBeenCalled();
  });
});
