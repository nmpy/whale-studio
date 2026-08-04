/**
 * src/__tests__/liff-config-api-public-id.test.ts
 *
 * GET /api/liff/config が workId / pageId / locationId を **UUID / publicId の両方**で
 * 解決できることの回帰テスト。
 *
 * 背景:
 *   LIFF 短縮 URL（/liff/w/[workPublicId]/p/[pagePublicId]、
 *   /liff/c/[workPublicId]/[locationPublicId]）は publicId しか持たない。
 *   UUID 限定だと OA を解決できず liffId が返せないため、per-OA 初期化ができなかった。
 *
 * 併せて、公開レスポンスに秘匿情報が含まれないことも固定する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = {
  work:           { findUnique: vi.fn() },
  liffPageConfig: { findUnique: vi.fn() },
  location:       { findUnique: vi.fn(), count: vi.fn() },
  oa:             { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const WORK_UUID = "8887ea5d-21e9-48c9-9bb0-4b957b0e9a70";
const WORK_PUBLIC = "ek80uvru81";
const PAGE_UUID = "55f35b35-66ac-4749-883d-ea22e705a32e";
const PAGE_PUBLIC = "oqcocxuvo4";
const LOC_UUID = "11111111-2222-3333-4444-555555555555";
const LOC_PUBLIC = "locpub123";
const OA_A = "8500d2ba-7418-4942-98f7-8ce40a8b27f2";
const OA_B = "99999999-1111-2222-3333-444444444444";
const OA_A_LIFF = "2010632019-YRm96VSK";
const OA_B_LIFF = "2010342756-WWXmBJ7w";

const req = (qs: string) =>
  new Request(`http://localhost/api/liff/config?${qs}`) as unknown as import("next/server").NextRequest;

async function callGet(qs: string) {
  const { GET } = await import("@/app/api/liff/config/route");
  const res = await GET(req(qs));
  return { status: (res as Response).status, json: await (res as Response).json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  mockPrisma.location.count.mockResolvedValue(0);
  // OA は id で引かれる。A / B で別 liffId を返す。
  mockPrisma.oa.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === OA_A) return Promise.resolve({ id: OA_A, liffId: OA_A_LIFF, liffScanQrEnabled: true });
    if (where.id === OA_B) return Promise.resolve({ id: OA_B, liffId: OA_B_LIFF, liffScanQrEnabled: false });
    return Promise.resolve(null);
  });
});

/** work.findUnique を UUID / publicId の両方に応答させる。 */
function mockWork(opts: { oaId?: string } = {}) {
  const oaId = opts.oaId ?? OA_A;
  mockPrisma.work.findUnique.mockImplementation(({ where }: { where: { id?: string; publicId?: string } }) => {
    if (where.id === WORK_UUID || where.publicId === WORK_PUBLIC) {
      return Promise.resolve({ id: WORK_UUID, publicId: WORK_PUBLIC, oaId });
    }
    return Promise.resolve(null);
  });
}

describe("workId の解決（UUID / publicId 両対応）", () => {
  it("Work UUID で解決できる", async () => {
    mockWork();
    const { status, json } = await callGet(`workId=${WORK_UUID}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    expect(json.data.liffIdSource).toBe("oa");
    expect(json.data.workId).toBe(WORK_UUID);
  });

  it("Work publicId で解決できる（短縮 LIFF URL 経路）", async () => {
    mockWork();
    const { status, json } = await callGet(`workId=${WORK_PUBLIC}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    // workId は必ず UUID 実体へ正規化して返す。
    expect(json.data.workId).toBe(WORK_UUID);
  });

  it("存在しない workId は 404", async () => {
    mockWork();
    const { status } = await callGet("workId=nosuchwork");
    expect(status).toBe(404);
  });
});

describe("pageId の解決（UUID / publicId 両対応）", () => {
  beforeEach(() => {
    mockPrisma.liffPageConfig.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; publicId?: string } }) => {
        if (where.id === PAGE_UUID || where.publicId === PAGE_PUBLIC) {
          return Promise.resolve({ id: PAGE_UUID, publicId: PAGE_PUBLIC, workId: WORK_UUID });
        }
        return Promise.resolve(null);
      },
    );
    mockWork();
  });

  it("Page UUID で解決できる", async () => {
    const { status, json } = await callGet(`pageId=${PAGE_UUID}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
  });

  it("Page publicId で解決できる（ticket_link ページ等）", async () => {
    const { status, json } = await callGet(`pageId=${PAGE_PUBLIC}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    expect(json.data.workId).toBe(WORK_UUID);
  });
});

describe("locationId の解決（UUID / publicId 両対応）", () => {
  beforeEach(() => {
    mockPrisma.location.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; publicId?: string } }) => {
        if (where.id === LOC_UUID || where.publicId === LOC_PUBLIC) {
          return Promise.resolve({ id: LOC_UUID, publicId: LOC_PUBLIC, workId: WORK_UUID, gpsEnabled: true, isActive: true });
        }
        return Promise.resolve(null);
      },
    );
    mockWork();
  });

  it("Location UUID で解決でき、gpsCheckin を反映する", async () => {
    const { status, json } = await callGet(`locationId=${LOC_UUID}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    expect(json.data.features.gpsCheckin).toBe(true);
  });

  it("Location publicId で解決できる（短縮チェックイン URL 経路）", async () => {
    const { status, json } = await callGet(`workId=${WORK_PUBLIC}&locationId=${LOC_PUBLIC}`);
    expect(status).toBe(200);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    expect(json.data.features.gpsCheckin).toBe(true);
  });
});

describe("Oa.liffId 優先 / env レガシーフォールバック", () => {
  it("Oa.liffId があれば env より優先する（source='oa'）", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "2010049684-aJNy8Ljv";
    mockWork();
    const { json } = await callGet(`workId=${WORK_PUBLIC}`);
    expect(json.data.liffId).toBe(OA_A_LIFF);
    expect(json.data.liffId).not.toBe("2010049684-aJNy8Ljv");
    expect(json.data.liffIdSource).toBe("oa");
  });

  it("【レガシー】Oa.liffId が NULL のときだけ env へフォールバックする（source='env'）", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "2010049684-aJNy8Ljv";
    mockWork({ oaId: "oa-null" });
    mockPrisma.oa.findUnique.mockResolvedValue({ id: "oa-null", liffId: null, liffScanQrEnabled: false });
    const { json } = await callGet(`workId=${WORK_PUBLIC}`);
    expect(json.data.liffId).toBe("2010049684-aJNy8Ljv");
    expect(json.data.liffIdSource).toBe("env");
    expect(json.data.configured).toBe(true);
  });

  it("Oa.liffId も env も無ければ configured=false / source='none'", async () => {
    mockWork({ oaId: "oa-null" });
    mockPrisma.oa.findUnique.mockResolvedValue({ id: "oa-null", liffId: null, liffScanQrEnabled: false });
    const { json } = await callGet(`workId=${WORK_PUBLIC}`);
    expect(json.data.liffId).toBeNull();
    expect(json.data.liffIdSource).toBe("none");
    expect(json.data.configured).toBe(false);
  });

  it("複数 OA で別々の liffId を返す（別 Work の値が混ざらない）", async () => {
    mockWork({ oaId: OA_A });
    const a = await callGet(`workId=${WORK_PUBLIC}`);
    expect(a.json.data.liffId).toBe(OA_A_LIFF);

    mockWork({ oaId: OA_B });
    const b = await callGet(`workId=${WORK_PUBLIC}`);
    expect(b.json.data.liffId).toBe(OA_B_LIFF);
    expect(b.json.data.liffId).not.toBe(OA_A_LIFF);
  });
});

describe("公開レスポンスの安全性", () => {
  it("channelSecret / channelAccessToken 等の秘匿情報を含まない", async () => {
    mockWork();
    const { json } = await callGet(`workId=${WORK_PUBLIC}`);
    const body = JSON.stringify(json).toLowerCase();
    for (const forbidden of [
      "channelsecret", "channel_secret",
      "channelaccesstoken", "channel_access_token",
      "lineuserid", "line_user_id", "idtoken", "id_token", "accesstoken", "access_token",
      "ownerkey", "owner_key",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("レスポンス形状（既存キー）を維持する", async () => {
    mockWork();
    const { json } = await callGet(`workId=${WORK_PUBLIC}`);
    expect(Object.keys(json.data).sort()).toEqual(
      ["configured", "features", "liffId", "liffIdSource", "locationId", "oaId", "ok", "pageId", "workId"],
    );
    expect(Object.keys(json.data.features).sort()).toEqual(["gpsCheckin", "scanQr"]);
  });

  it("識別子が 1 つも無ければ 400", async () => {
    const { status } = await callGet("");
    expect(status).toBe(400);
  });
});
