// src/__tests__/spreadsheet-import-template-route.test.ts
// テンプレDL API（GET /api/oas/[id]/works/[workId]/import/spreadsheet/template）:
// flag OFF=404 / editor未満=403 / work-oa不一致=404 / 正常=xlsx。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockPrisma = { work: { findFirst: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  withAuth: <P>(h: (req: Request, ctx: { params: P }, u: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => h(req, ctx, { id: "user-1" }),
}));
const mockRequireRole = vi.fn((..._a: unknown[]): unknown => undefined);
vi.mock("@/lib/rbac", () => ({ requireRole: (...a: unknown[]) => mockRequireRole(...a) }));

function forbiddenResp() {
  return { ok: false, response: new Response(JSON.stringify({ success: false }), { status: 403, headers: { "content-type": "application/json" } }) };
}

async function callRoute() {
  const { GET } = await import("@/app/api/oas/[id]/works/[workId]/import/spreadsheet/template/route");
  const req = new Request("http://localhost/api/oas/oa-1/works/work-1/import/spreadsheet/template");
  return (GET as never as (r: Request, c: { params: { id: string; workId: string } }) => Promise<Response>)(req, { params: { id: "oa-1", workId: "work-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "true");
  mockRequireRole.mockResolvedValue({ ok: true, role: "editor", status: "active" });
  mockPrisma.work.findFirst.mockResolvedValue({ id: "work-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("template route", () => {
  it("flag OFF は 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "false");
    expect((await callRoute()).status).toBe(404);
  });
  it("editor 未満は 403", async () => {
    mockRequireRole.mockResolvedValue(forbiddenResp());
    expect((await callRoute()).status).toBe(403);
  });
  it("work が oa に属さない場合 404", async () => {
    mockPrisma.work.findFirst.mockResolvedValue(null);
    expect((await callRoute()).status).toBe(404);
    expect(mockPrisma.work.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "work-1", oaId: "oa-1" } }));
  });
  it("正常時は xlsx を返す", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain("spreadsheet-import-template.xlsx");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000); // 実体のある xlsx
  });
});
