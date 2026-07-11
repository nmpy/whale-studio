/**
 * src/__tests__/external-api-routes.test.ts
 *
 * 外部連携 API 3 ルートの挙動を検証する（prisma はモック）。
 *
 * 検証観点:
 *   - APIキーなし/不一致 → 401
 *   - allowlist が空（未設定）→ works は空・DB を引かない（fail closed）
 *   - allowlist 外 OA / draft・paused の Work → 個別エンドポイントは 404
 *   - works の where に publish_status=active と oaId allowlist が渡る（draft/paused 除外）
 *   - phases 応答に message 本文・answer・transition・startTrigger 等が含まれない（whitelist マッピング）
 *   - phase-links: adminUrl はフェーズ単位 / liveAdminUrl・liveActorUrl は作品単位のみ
 *   - 返却キーが camelCase
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    work:  { findMany: vi.fn(), findUnique: vi.fn() },
    phase: { findMany: vi.fn(), groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { GET as worksGET } from "@/app/api/external/v1/works/route";
import { GET as phasesGET } from "@/app/api/external/v1/works/[workId]/phases/route";
import { GET as phaseLinksGET } from "@/app/api/external/v1/works/[workId]/phase-links/route";

const API_KEY = "test-secret-key-1234567890";
const BASE = "https://test.whale-studio.app";

function makeReq(key?: string): NextRequest {
  const headers = new Headers();
  if (key !== undefined) headers.set("x-whale-api-key", key);
  return { headers } as unknown as NextRequest;
}

const ENV_KEYS = [
  "WHALE_EXTERNAL_API_KEY",
  "WHALE_EXTERNAL_OA_IDS",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.WHALE_EXTERNAL_API_KEY = API_KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa-1";
  process.env.NEXT_PUBLIC_BASE_URL = BASE;
  delete process.env.NEXT_PUBLIC_APP_URL;
  mockPrisma.work.findMany.mockReset();
  mockPrisma.work.findUnique.mockReset();
  mockPrisma.phase.findMany.mockReset();
  mockPrisma.phase.groupBy.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── GET /works ─────────────────────────────────────────────
describe("GET /api/external/v1/works", () => {
  it("APIキーなし → 401、DB を引かない", async () => {
    const res = await worksGET(makeReq());
    expect(res.status).toBe(401);
    expect(mockPrisma.work.findMany).not.toHaveBeenCalled();
  });

  it("APIキー不一致 → 401", async () => {
    const res = await worksGET(makeReq("nope"));
    expect(res.status).toBe(401);
  });

  it("allowlist 未設定 → works は空・DB を引かない（fail closed）", async () => {
    delete process.env.WHALE_EXTERNAL_OA_IDS;
    const res = await worksGET(makeReq(API_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.works).toEqual([]);
    expect(mockPrisma.work.findMany).not.toHaveBeenCalled();
  });

  it("allowlist 内の active 作品のみ・camelCase・phaseCount 付き", async () => {
    mockPrisma.work.findMany.mockResolvedValue([
      { id: "w1", publicId: "pub1", oaId: "oa-1", title: "作品1", publishStatus: "active", sortOrder: 0 },
    ]);
    mockPrisma.phase.groupBy.mockResolvedValue([{ workId: "w1", _count: { _all: 3 } }]);

    const res = await worksGET(makeReq(API_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.works).toHaveLength(1);
    const w = body.data.works[0];
    expect(Object.keys(w).sort()).toEqual(
      ["id", "oaId", "phaseCount", "publicId", "publishStatus", "sortOrder", "title"].sort(),
    );
    expect(w).toMatchObject({ id: "w1", publicId: "pub1", oaId: "oa-1", phaseCount: 3 });

    // draft/paused を除外し allowlist で絞る where が渡っていること
    const where = mockPrisma.work.findMany.mock.calls[0][0].where;
    expect(where.publishStatus).toBe("active");
    expect(where.oaId).toEqual({ in: ["oa-1"] });
  });
});

// ── GET /works/:id/phases ──────────────────────────────────
describe("GET /api/external/v1/works/:workId/phases", () => {
  const ctx = (workId: string) => ({ params: { workId } });

  it("作品が存在しない → 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue(null);
    const res = await phasesGET(makeReq(API_KEY), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("draft の作品 → 404（active のみ露出）", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({
      id: "w1", publicId: "pub1", oaId: "oa-1", title: "t", publishStatus: "draft",
    });
    const res = await phasesGET(makeReq(API_KEY), ctx("w1"));
    expect(res.status).toBe(404);
  });

  it("allowlist 外 OA → 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({
      id: "w1", publicId: "pub1", oaId: "oa-OTHER", title: "t", publishStatus: "active",
    });
    const res = await phasesGET(makeReq(API_KEY), ctx("w1"));
    expect(res.status).toBe(404);
  });

  it("active + allowlist 内 → フェーズを最小フィールドで返す（機密は漏れない）", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({
      id: "w1", publicId: "pub1", oaId: "oa-1", title: "作品1", publishStatus: "active",
    });
    // モックが余計なフィールドを返しても、ルートの whitelist マッピングで落ちることを証明する
    mockPrisma.phase.findMany.mockResolvedValue([
      {
        id: "p1", phaseKey: "intro", name: "序章", phaseType: "start", sortOrder: 0, isActive: true,
        startTrigger: "はじめる", resumeSummary: "秘密のあらすじ", description: "内部メモ",
      },
    ]);

    const res = await phasesGET(makeReq(API_KEY), ctx("w1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.work).toEqual({ id: "w1", publicId: "pub1", oaId: "oa-1", title: "作品1" });
    expect(body.data.phases).toHaveLength(1);
    const p = body.data.phases[0];
    expect(Object.keys(p).sort()).toEqual(
      ["id", "isActive", "key", "name", "order", "phaseType"].sort(),
    );
    expect(p).toEqual({ id: "p1", key: "intro", name: "序章", phaseType: "start", order: 0, isActive: true });
    // 機密フィールドが漏れていないこと
    expect(p).not.toHaveProperty("startTrigger");
    expect(p).not.toHaveProperty("resumeSummary");
    expect(p).not.toHaveProperty("description");

    // global フェーズを除外する where が渡っていること
    const where = mockPrisma.phase.findMany.mock.calls[0][0].where;
    expect(where.phaseType).toEqual({ not: "global" });
  });
});

// ── GET /works/:id/phase-links ─────────────────────────────
describe("GET /api/external/v1/works/:workId/phase-links", () => {
  const ctx = (workId: string) => ({ params: { workId } });

  it("allowlist 外 OA → 404", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({
      id: "w1", oaId: "oa-OTHER", title: "t", publishStatus: "active",
    });
    const res = await phaseLinksGET(makeReq(API_KEY), ctx("w1"));
    expect(res.status).toBe(404);
  });

  it("adminUrl はフェーズ単位 / liveAdminUrl・liveActorUrl は作品単位", async () => {
    mockPrisma.work.findUnique.mockResolvedValue({
      id: "w1", oaId: "oa-1", title: "作品1", publishStatus: "active",
    });
    mockPrisma.phase.findMany.mockResolvedValue([
      { id: "p1", phaseKey: "intro", name: "序章", sortOrder: 0 },
      { id: "p2", phaseKey: null, name: "中盤", sortOrder: 1 },
    ]);

    const res = await phaseLinksGET(makeReq(API_KEY), ctx("w1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // 作品単位リンク
    expect(body.data.links).toEqual({
      scenarioUrl:  `${BASE}/oas/oa-1/works/w1/scenario`,
      liveAdminUrl: `${BASE}/oas/oa-1/live/admin?workId=w1`,
      liveActorUrl: `${BASE}/oas/oa-1/live/actor?workId=w1`,
    });

    // フェーズ単位リンク（adminUrl に phaseId を含む・フェーズごとに異なる）
    const [a, b] = body.data.phases;
    expect(Object.keys(a).sort()).toEqual(["adminUrl", "id", "key", "name", "order"].sort());
    expect(a.adminUrl).toBe(`${BASE}/oas/oa-1/works/w1/phases/p1`);
    expect(b.adminUrl).toBe(`${BASE}/oas/oa-1/works/w1/phases/p2`);
    expect(a.adminUrl).not.toEqual(b.adminUrl);

    // 存在しないフェーズ別 Staff URL は返さない
    expect(a).not.toHaveProperty("staffUrl");
    expect(a).not.toHaveProperty("liveAdminUrl");
    expect(a).not.toHaveProperty("liveActorUrl");
  });
});
