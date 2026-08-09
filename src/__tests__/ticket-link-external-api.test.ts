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
    ticketLink:        { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
  // once キュー・implementation をテスト間で持ち越さない。
  mockPrisma.ticketLink.findFirst.mockReset();
  mockPrisma.ticketLink.updateMany.mockReset();
  mockPrisma.ticketLink.updateMany.mockResolvedValue({ count: 1 });
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

  // ── ID 指定フィルタ（追加パラメータ） ──────────────────────────────────────
  //
  // CMS が「一度同期結果を返したが未解決のまま」の連携を後から直接引き直すための経路。
  // 既存条件（作品 / status / unsyncedOnly / updatedSince）は一切緩めない。

  describe("ids フィルタ", () => {
    const whereOf = () => mockPrisma.ticketLink.findMany.mock.calls[0][0].where;
    const argsOf = () => mockPrisma.ticketLink.findMany.mock.calls[0][0];

    it("ids を送らない既存リクエストは従来どおり（id 条件を付けない）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(getReq(`?workId=${WORK_ID}`, READ_KEY));

      expect(whereOf().id).toBeUndefined();
      expect(whereOf().uzuSyncedAt).toBeNull();
      expect(argsOf().take).toBe(50 + 1); // DEFAULT_LIMIT のまま
    });

    it("ids=1件 でその ID だけに絞る", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1`, READ_KEY));
      const body = await res.json();

      expect(whereOf().id).toEqual({ in: ["tl-1"] });
      expect(body.data.map((d: { whaleTicketLinkId: string }) => d.whaleTicketLinkId)).toEqual(["tl-1"]);
    });

    it("ids=複数 で指定分だけに絞る（繰り返しクエリ）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1&ids=tl-2&ids=tl-3`, READ_KEY));

      expect(whereOf().id).toEqual({ in: ["tl-1", "tl-2", "tl-3"] });
    });

    it("重複 ID は正規化して重複行を作らない", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1&ids=tl-1&ids=tl-2`, READ_KEY));
      const body = await res.json();

      expect(whereOf().id).toEqual({ in: ["tl-1", "tl-2"] });
      expect(body.data).toHaveLength(1);
    });

    it("ID 指定でも作品スコープを緩めない（別作品の ID は返らない）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-of-other-work`, READ_KEY));

      // workId が AND され続けるため、別作品の ID を渡しても一致しない。
      expect(whereOf().workId).toBe(WORK_ID);
      expect(whereOf().id).toEqual({ in: ["tl-of-other-work"] });
    });

    it("allowlist 外の OA では ID 指定でもクエリまで到達しない", async () => {
      mockPrisma.work.findUnique.mockResolvedValue({ id: WORK_ID, oaId: "oa-other" });
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1`, READ_KEY));

      expect(res.status).toBe(404);
      expect(mockPrisma.ticketLink.findMany).not.toHaveBeenCalled();
    });

    it("ID 指定は unsyncedOnly を自動で無効化しない（既定では未同期条件が残る）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1`, READ_KEY));

      expect(whereOf().uzuSyncedAt).toBeNull();
    });

    it("unsyncedOnly=false + ids なら同期済みの ID でも引ける（再読取りの本丸）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
      const res = await ticketLinksGET(
        getReq(`?workId=${WORK_ID}&unsyncedOnly=false&ids=tl-1`, READ_KEY),
      );
      const body = await res.json();

      expect(whereOf().uzuSyncedAt).toBeUndefined();
      expect(whereOf().id).toEqual({ in: ["tl-1"] });
      expect(body.data).toHaveLength(1);
    });

    it("ID 指定でも status 制限は維持する（REVOKED を復活させない）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(getReq(`?workId=${WORK_ID}&unsyncedOnly=false&ids=tl-revoked`, READ_KEY));

      expect(whereOf().status).toEqual({ in: ["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"] });
    });

    it("ID 指定でも updatedSince は併用できる（条件を緩めない）", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      await ticketLinksGET(
        getReq(`?workId=${WORK_ID}&ids=tl-1&updatedSince=2026-08-01T00:00:00%2B09:00`, READ_KEY),
      );
      expect(whereOf().updatedAt).toHaveProperty("gt");
      expect(whereOf().id).toEqual({ in: ["tl-1"] });
    });

    it("上限ちょうど（100件）は受理する", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([]);
      const ids = Array.from({ length: 100 }, (_, i) => `ids=tl-${i}`).join("&");
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&${ids}`, READ_KEY));

      expect(res.status).toBe(200);
      expect(whereOf().id.in).toHaveLength(100);
    });

    it("上限超過（101件）は 400", async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `ids=tl-${i}`).join("&");
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&${ids}`, READ_KEY));

      expect(res.status).toBe(400);
      expect(mockPrisma.ticketLink.findMany).not.toHaveBeenCalled();
    });

    it("重複を並べて上限を回避できない（正規化前の件数で判定する）", async () => {
      const ids = Array.from({ length: 101 }, () => "ids=tl-same").join("&");
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&${ids}`, READ_KEY));
      expect(res.status).toBe(400);
    });

    it("空文字の ID は 400", async () => {
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=`, READ_KEY));
      expect(res.status).toBe(400);
      expect(mockPrisma.ticketLink.findMany).not.toHaveBeenCalled();
    });

    it("指定した ID は 1 応答で返し切る（ページ外へ押し出さない）", async () => {
      // ids 指定時は limit/cursor を使わず take = ids.length + 1 になる。
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1"), makeLink("tl-2")]);
      const res = await ticketLinksGET(
        // limit=1 / cursor つきでも ID 指定側が優先される。
        getReq(`?workId=${WORK_ID}&unsyncedOnly=false&limit=1&cursor=tl-0&ids=tl-1&ids=tl-2`, READ_KEY),
      );
      const body = await res.json();

      expect(argsOf().take).toBe(3); // ids.length + 1
      expect(argsOf().cursor).toBeUndefined();
      expect(argsOf().skip).toBeUndefined();
      expect(body.data).toHaveLength(2);
      expect(body.meta.has_more).toBe(false);
      expect(body.meta.next_cursor).toBeNull();
    });

    it("存在しない ID を混ぜても、見つかった分だけ返る", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
      const res = await ticketLinksGET(
        getReq(`?workId=${WORK_ID}&unsyncedOnly=false&ids=tl-1&ids=tl-missing`, READ_KEY),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.map((d: { whaleTicketLinkId: string }) => d.whaleTicketLinkId)).toEqual(["tl-1"]);
    });

    it("ID 指定でも ESCAPE.ID 由来の個人情報を返さない", async () => {
      mockPrisma.ticketLink.findMany.mockResolvedValue([makeLink("tl-1")]);
      const res = await ticketLinksGET(getReq(`?workId=${WORK_ID}&ids=tl-1`, READ_KEY));
      const serialized = JSON.stringify(await res.json());

      for (const leak of ["購入者", "purchaserName", "ocr", "venue"]) {
        expect(serialized).not.toContain(leak);
      }
    });
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
    // [0] = status の CAS、[1] = uzuSyncedAt（status 非依存）
    expect(mockPrisma.ticketLink.updateMany.mock.calls[0][0].data.status).toBe("LINKED");
    expect(mockPrisma.ticketLink.updateMany.mock.calls[1][0].data.uzuSyncedAt).toBeInstanceOf(Date);
  });

  it("CONFLICT を反映する（自動上書きしない状態へ）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "CONFLICT" }]), WRITE_KEY));
    expect(mockPrisma.ticketLink.updateMany.mock.calls[0][0].data.status).toBe("CONFLICT");
  });

  it("ERROR は uzuSyncedAt を進めない（次回再試行できる）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    const res = await syncResultPOST(
      postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "ERROR", errorCode: "BOOKING_NOT_FOUND" }]), WRITE_KEY),
    );
    const body = await res.json();

    expect(body.data.errors).toBe(1);
    expect(mockPrisma.ticketLink.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.ticketLinkSyncLog.create.mock.calls[0][0].data.errorCode).toBe("BOOKING_NOT_FOUND");
  });

  it("NO_CHANGE は状態を変えず同期済みにする", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "LINKED" });
    await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "NO_CHANGE" }]), WRITE_KEY));
    const calls = mockPrisma.ticketLink.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].data.status).toBeUndefined();
    expect(calls[0][0].data.uzuSyncedAt).toBeInstanceOf(Date);
  });

  it("REVOKED は同期結果で復活しない（不正遷移を弾く）", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY));
    // status を書く updateMany は 1 件も無い（uzuSyncedAt のみ）
    for (const c of mockPrisma.ticketLink.updateMany.mock.calls) {
      expect(c[0].data.status).toBeUndefined();
    }
    // 既存挙動: uzuSyncedAt は進め、syncLog は残し、applied として数える
    expect(mockPrisma.ticketLink.updateMany.mock.calls[0][0].data.uzuSyncedAt).toBeInstanceOf(Date);
    expect(mockPrisma.ticketLinkSyncLog.create).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.applied).toBe(1);
  });

  it("対象 work 外の id は反映しない", async () => {
    mockPrisma.ticketLink.findFirst.mockResolvedValue(null);
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "other", result: "LINKED" }]), WRITE_KEY));
    const body = await res.json();

    expect(body.data.notFound).toBe(1);
    expect(mockPrisma.ticketLink.updateMany).not.toHaveBeenCalled();
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
    expect(mockPrisma.ticketLink.updateMany).not.toHaveBeenCalled();
  });

  describe("解除（REVOKED）との並行更新 — REVOKED は terminal", () => {
    const linked = () => okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]);

    /**
     * 実 DB の compare-and-swap を最小再現する。
     * revokeAfterFirstRead: sync-result が status を読んだ直後（update 前）に
     * 運営の解除が確定した、という並びを作る。
     */
    function simulateDb(initial: string, opts: { revokeAfterFirstRead?: boolean } = {}) {
      const db = { status: initial };
      let reads = 0;
      mockPrisma.ticketLink.findFirst.mockImplementation(async () => {
        reads += 1;
        const snapshot = { id: "tl-1", status: db.status };
        if (reads === 1 && opts.revokeAfterFirstRead) db.status = "REVOKED";
        return snapshot;
      });
      mockPrisma.ticketLink.updateMany.mockImplementation(
        async (a: { where: { status?: string }; data: { status?: string } }) => {
          if (!a.data.status) return { count: 1 };              // uzuSyncedAt は status 非依存
          if (a.where.status !== db.status) return { count: 0 }; // CAS 不一致 = 競合
          db.status = a.data.status;
          return { count: 1 };
        },
      );
      return db;
    }

    it("read 後・update 直前に REVOKED へ変わったら復活させない", async () => {
      const db = simulateDb("PENDING_UZU_BOOKING", { revokeAfterFirstRead: true });
      await syncResultPOST(postReq(linked(), WRITE_KEY));

      expect(db.status).toBe("REVOKED");
      // stale な PENDING を条件にした CAS は撃つが、成立しない
      const statusWrites = mockPrisma.ticketLink.updateMany.mock.calls.filter((c) => c[0].data.status);
      expect(statusWrites[0][0].where.status).toBe("PENDING_UZU_BOOKING");
      // 最新が REVOKED と判明した後は status を撃ち直さない
      expect(statusWrites.some((c) => c[0].where.status === "REVOKED")).toBe(false);
    });

    it.each(["LINKED", "CONFLICT", "PENDING_BOOKING"] as const)(
      "result=%s でも REVOKED は復活しない",
      async (result) => {
        const db = simulateDb("PENDING_UZU_BOOKING", { revokeAfterFirstRead: true });
        await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result }]), WRITE_KEY));
        expect(db.status).toBe("REVOKED");
      },
    );

    it("race で REVOKED を検知した場合の意味は「最初から REVOKED」と揃う", async () => {
      simulateDb("PENDING_UZU_BOOKING", { revokeAfterFirstRead: true });
      const res = await syncResultPOST(postReq(linked(), WRITE_KEY));
      const body = await res.json();

      // 既存の「最初から REVOKED」と同じ: uzuSyncedAt は進む / syncLog は残る / applied
      expect(res.status).toBe(200);
      expect(body.data.applied).toBe(1);
      expect(body.data.errors).toBe(0);
      expect(mockPrisma.ticketLinkSyncLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.ticketLink.updateMany.mock.calls.some((c) => c[0].data.uzuSyncedAt)).toBe(true);
    });

    it("競合が無ければ通常どおり反映される（PENDING → LINKED / CONFLICT）", async () => {
      const a = simulateDb("PENDING_UZU_BOOKING");
      await syncResultPOST(postReq(linked(), WRITE_KEY));
      expect(a.status).toBe("LINKED");

      const b = simulateDb("PENDING_UZU_BOOKING");
      await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "CONFLICT" }]), WRITE_KEY));
      expect(b.status).toBe("CONFLICT");
    });

    it("race で別の non-REVOKED へ変わった場合は stale 値で更新せず、最新 status で再判定する", async () => {
      // PENDING を読む → 実際は CONFLICT へ動いていた → CONFLICT → LINKED は許可なので CAS 再試行
      mockPrisma.ticketLink.findFirst
        .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
        .mockResolvedValueOnce({ status: "CONFLICT" });
      mockPrisma.ticketLink.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValue({ count: 1 });

      const res = await syncResultPOST(postReq(linked(), WRITE_KEY));

      const statusWrites = mockPrisma.ticketLink.updateMany.mock.calls.filter((c) => c[0].data.status);
      expect(statusWrites).toHaveLength(2);
      expect(statusWrites[0][0].where.status).toBe("PENDING_UZU_BOOKING");
      expect(statusWrites[1][0].where.status).toBe("CONFLICT"); // 最新 status で CAS
      expect((await res.json()).data.applied).toBe(1);
    });

    it("CAS 再試行は 1 回まで（無制限に retry しない）", async () => {
      mockPrisma.ticketLink.findFirst
        .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
        .mockResolvedValue({ status: "CONFLICT" });
      mockPrisma.ticketLink.updateMany.mockResolvedValue({ count: 0 }); // 常に競合

      await syncResultPOST(postReq(linked(), WRITE_KEY));

      const statusWrites = mockPrisma.ticketLink.updateMany.mock.calls.filter((c) => c[0].data.status);
      expect(statusWrites).toHaveLength(2); // 初回 + 再判定 1 回で打ち切る
    });

    it("最新 status が既に target と同値なら撃ち直さない（別の同期が先に適用済み）", async () => {
      // PENDING を読む → 実際は既に LINKED。target === observed なので status は no-op。
      mockPrisma.ticketLink.findFirst
        .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
        .mockResolvedValueOnce({ status: "LINKED" });
      mockPrisma.ticketLink.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValue({ count: 1 });

      const res = await syncResultPOST(postReq(linked(), WRITE_KEY));

      const statusWrites = mockPrisma.ticketLink.updateMany.mock.calls.filter((c) => c[0].data.status);
      expect(statusWrites).toHaveLength(1); // 再評価で no-op → 撃ち直さない
      // 既存の no-op 挙動と同じく uzuSyncedAt は進み、applied として数える
      expect(mockPrisma.ticketLink.updateMany.mock.calls.some((c) => c[0].data.uzuSyncedAt)).toBe(true);
      expect((await res.json()).data.applied).toBe(1);
    });

    it("DB error を CAS 競合として扱わない（500 になり、status を撃ち直さない）", async () => {
      mockPrisma.ticketLink.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
      mockPrisma.ticketLink.updateMany.mockRejectedValue(new Error("db down"));

      const res = await syncResultPOST(postReq(linked(), WRITE_KEY));

      expect(res.status).toBe(500);
      expect(mockPrisma.ticketLink.updateMany).toHaveBeenCalledTimes(1);
    });

    it("revoke と sync-result の競合: 最終 status は REVOKED のまま", async () => {
      const db = simulateDb("PENDING_UZU_BOOKING", { revokeAfterFirstRead: true });
      await syncResultPOST(postReq(linked(), WRITE_KEY));
      // PR-B の revoke が勝ち、sync-result は上書きしない
      expect(db.status).toBe("REVOKED");
    });
  });

  it("allowlist 外の OA は 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({ id: WORK_ID, oaId: "oa-other" });
    const res = await syncResultPOST(postReq(okBody([{ whaleTicketLinkId: "tl-1", result: "LINKED" }]), WRITE_KEY));
    expect(res.status).toBe(404);
  });
});
