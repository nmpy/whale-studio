/**
 * src/__tests__/ticket-link-external-api.test.ts
 *
 * チケット連携の外部 API 2 ルートを検証する（prisma はモック）。
 *
 * 検証観点:
 *   - APIキーなし/不一致 → 401（fail closed）
 *   - allowlist 外 OA / 不在 work → 404（存在秘匿）
 *   - 取得レスポンスに ESCAPE.ID 由来の個人情報 / OCR データ（購入者名 / OCR 原文 / 会場 / 公演名）を露出しない
 *     （lineUserId / lineDisplayName / コードネームは CMS 連携に必要な最小限として意図的に返す）
 *   - カーソルページング（has_more / next_cursor）
 *   - 同期結果の状態反映（LINKED / CONFLICT / NO_CHANGE）
 *   - ERROR は uzuSyncedAt を進めない（次回再試行できる）
 *   - 同一 Idempotency-Key の再送は replay（二重反映しない）
 *   - 対象 work 外の id は反映しない
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    work:              { findUnique: vi.fn() },
    ticketLink:        { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    ticketLinkSyncLog: { create: vi.fn() },
    uzuProSyncRequest: { create: vi.fn(), update: vi.fn() },
    uzuProActivityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { GET as ticketLinksGET } from "@/app/api/external/v2/uzu-pro/ticket-links/route";
import { POST as syncResultPOST } from "@/app/api/external/v2/uzu-pro/ticket-links/sync-result/route";

const READ_KEY = "read-secret-key-1234567890";
const WRITE_KEY = "write-secret-key-1234567890";
const WORK_ID = "work-1";
const OA_ID = "oa-a";

function getReq(query: string, key?: string): NextRequest {
  const headers = new Headers();
  if (key !== undefined) headers.set("x-whale-api-key", key);
  return {
    headers,
    url: `https://app.whale-studio.app/api/external/v2/uzu-pro/ticket-links${query}`,
  } as unknown as NextRequest;
}

function postReq(body: unknown, key?: string, idemKey?: string): NextRequest {
  const headers = new Headers();
  if (key !== undefined) headers.set("x-whale-api-key", key);
  if (idemKey !== undefined) headers.set("idempotency-key", idemKey);
  return { headers, json: async () => body } as unknown as NextRequest;
}

function makeLink(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workId: WORK_ID,
    lineUserId: "Uabc",
    lineDisplayName: "たろう",
    normalizedReservationNumber: "123-456",
    ticketType: "2名グループチケット",
    participantCount: 2,
    source: "LIFF_MANUAL",
    status: "PENDING_UZU_BOOKING",
    confirmedAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    members: [
      { memberIndex: 1, codeName: "アリス" },
      { memberIndex: 2, codeName: "ボブ" },
    ],
    ...over,
  };
}

const ENV_KEYS = [
  "WHALE_EXTERNAL_API_KEY",
  "WHALE_EXTERNAL_WRITE_API_KEY",
  "WHALE_EXTERNAL_OA_IDS",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.WHALE_EXTERNAL_API_KEY = READ_KEY;
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = WRITE_KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = OA_ID;

  vi.clearAllMocks();
  mockPrisma.work.findUnique.mockResolvedValue({ id: WORK_ID, oaId: OA_ID });
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.uzuProSyncRequest.create.mockResolvedValue({});
  mockPrisma.uzuProSyncRequest.update.mockResolvedValue({});
  mockPrisma.ticketLinkSyncLog.create.mockResolvedValue({});
  mockPrisma.ticketLink.update.mockResolvedValue({});
  mockPrisma.uzuProActivityLog.create.mockResolvedValue({});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("GET /api/external/v2/uzu-pro/ticket-links", () => {
  it("APIキーなしは 401（DB を引かない）", async () => {
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}`));
    expect(res.status).toBe(401);
    expect(mockPrisma.work.findUnique).not.toHaveBeenCalled();
  });

  it("APIキー不一致は 401", async () => {
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}`, "wrong-key"));
    expect(res.status).toBe(401);
  });

  it("allowlist 外の OA は 404（存在を秘匿）", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({ id: WORK_ID, oaId: "oa-other" });
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}`, READ_KEY));
    expect(res.status).toBe(404);
    expect(mockPrisma.ticketLink.findMany).not.toHaveBeenCalled();
  });

  it("存在しない作品は 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue(null);
    const res = await ticketLinksGET(getReq(`?workId=nope`, READ_KEY));
    expect(res.status).toBe(404);
  });

  it("workId 未指定は 400", async () => {
    const res = await ticketLinksGET(getReq("", READ_KEY));
    expect(res.status).toBe(400);
  });

  it("CMS 連携に必要な最小限のみ返し、ESCAPE.ID 由来の個人情報や OCR データを露出しない", async () => {
    mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}`, READ_KEY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0]).toEqual({
      whaleTicketLinkId: "tl-1",
      externalWorkId:    WORK_ID,
      reservationNumber: "123-456",
      lineUserId:        "Uabc",
      lineDisplayName:   "たろう",
      ticketType:        "2名グループチケット",
      participantCount:  2,
      codeNames:         ["アリス", "ボブ"],
      source:            "LIFF_MANUAL",
      status:            "PENDING_UZU_BOOKING",
      confirmedAt:       "2026-08-01T00:00:00.000Z",
      updatedAt:         "2026-08-01T00:00:00.000Z",
    });

    // ESCAPE.ID 由来の個人情報（購入者名）と OCR データ（原文/会場/公演名）は返さない。
    // lineUserId / lineDisplayName / codeNames は上の toEqual で「返すこと」を検証済み。
    const serialized = JSON.stringify(body);
    for (const leak of ["purchaserName", "ocrRawText", "venue", "performanceTitle"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("既定では未同期のみ・REVOKED を除外する", async () => {
    mockPrisma.ticketLink.findMany.mockResolvedValue([]);
    await ticketLinksGET(getReq(`?workId=${WORK_ID}`, READ_KEY));

    const where = mockPrisma.ticketLink.findMany.mock.calls[0][0].where;
    expect(where.uzuSyncedAt).toBeNull();
    expect(where.status).toEqual({ in: ["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"] });
  });

  it("unsyncedOnly=false なら未同期条件を外す", async () => {
    mockPrisma.ticketLink.findMany.mockResolvedValue([]);
    await ticketLinksGET(getReq(`?workId=${WORK_ID}&unsyncedOnly=false`, READ_KEY));

    const where = mockPrisma.ticketLink.findMany.mock.calls[0][0].where;
    expect(where.uzuSyncedAt).toBeUndefined();
  });

  it("updatedSince を渡すと差分条件になる", async () => {
    mockPrisma.ticketLink.findMany.mockResolvedValue([]);
    await ticketLinksGET(
      getReq(`?workId=${WORK_ID}&updatedSince=2026-08-01T00:00:00%2B09:00`, READ_KEY),
    );
    const where = mockPrisma.ticketLink.findMany.mock.calls[0][0].where;
    expect(where.updatedAt).toHaveProperty("gt");
  });

  it("次ページがあれば has_more と next_cursor を返す", async () => {
    // limit=1 に対し 2 件返す（ルートは take=limit+1 で取得する）
    mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1"), makeLink("tl-2")]);
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&limit=1`, READ_KEY));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.meta.has_more).toBe(true);
    expect(body.meta.next_cursor).toBe("tl-1");
  });

  it("最終ページでは has_more=false", async () => {
    mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
    const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&limit=10`, READ_KEY));
    const body = await res.json();
    expect(body.meta.has_more).toBe(false);
    expect(body.meta.next_cursor).toBeNull();
  });
});

describe("POST /api/external/v2/uzu-pro/ticket-links/sync-result", () => {
  const okBody = (results: unknown[]) => ({ workId: WORK_ID, results });

  it("APIキーなしは 401", async () => {
    const res = await syncResultPOST(postReq(okBody([])));
    expect(res.status).toBe(401);
  });

  it("read 用キーでは write できない", async () => {
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), READ_KEY));
    expect(res.status).toBe(401);
  });

  it("未知フィールドは 400（ESCAPE.ID 由来の個人情報の混入を構造的に拒否）", async () => {
    const res = await syncResultPOST(
      postReq({ workId: WORK_ID, results: [{ whaleTicketLinkId: "tl-1", result: "LINKED", purchaserName: "山田" }] }, WRITE_KEY),
    );
    expect(res.status).toBe(400);
  });

  it("LINKED を反映し uzuSyncedAt を進める", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.applied).toBe(1);
    const data = mockPrisma.ticketLink.update.mock.calls[0][0].data;
    expect(data.status).toBe("LINKED");
    expect(data.uzuSyncedAt).toBeInstanceOf(Date);
  });

  it("CONFLICT を反映する（自動上書きしない状態へ）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "CONFLICT" }]), WRITE_KEY));
    expect(mockPrisma.ticketLink.update.mock.calls[0][0].data.status).toBe("CONFLICT");
  });

  it("ERROR は uzuSyncedAt を進めない（次回再試行できる）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    const res = await syncResultPOST(
      postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "ERROR", errorCode: "BOOKING_NOT_FOUND" }]), WRITE_KEY),
    );
    const body = await res.json();

    expect(body.data.errors).toBe(1);
    expect(mockPrisma.ticketLink.update).not.toHaveBeenCalled();
    expect(mockPrisma.ticketLinkSyncLog.create.mock.calls[0][0].data.errorCode).toBe("BOOKING_NOT_FOUND");
  });

  it("NO_CHANGE は状態を変えず同期済みにする", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "LINKED" });
    await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "NO_CHANGE" }]), WRITE_KEY));
    const data = mockPrisma.ticketLink.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.uzuSyncedAt).toBeInstanceOf(Date);
  });

  it("REVOKED は同期結果で復活しない（不正遷移を弾く）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY));
    expect(mockPrisma.ticketLink.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it("対象 work 外の id は反映しない", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue(null);
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "other", result: "LINKED" }]), WRITE_KEY));
    const body = await res.json();

    expect(body.data.notFound).toBe(1);
    expect(mockPrisma.ticketLink.update).not.toHaveBeenCalled();
  });

  it("同一 Idempotency-Key の再送は replay（二重反映しない）", async () => {
    const { Prisma } = await import("@prisma/client");
    const dup = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" });
    mockPrisma.uzuProSyncRequest.create.mockRejectedValue(dup);

    const res = await syncResultPOST(
      postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY, "idem-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.idempotent_replay).toBe(true);
    expect(mockPrisma.ticketLink.update).not.toHaveBeenCalled();
  });

  it("allowlist 外の OA は 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({ id: WORK_ID, oaId: "oa-other" });
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY));
    expect(res.status).toBe(404);
  });
});
