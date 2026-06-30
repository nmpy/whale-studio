// src/__tests__/spreadsheet-import-route.test.ts
// 取り込み API（POST /api/oas/[id]/works/[workId]/import/spreadsheet）の検証:
// 権限・他作品拒否・apply時の再バリデーション・transaction・logEvent。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockPrisma = {
  work:       { findFirst: vi.fn() },
  character:  { findMany: vi.fn() },
  phase:      { findMany: vi.fn() },
  message:    { findMany: vi.fn() },
  transition: { findMany: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  withAuth: <P>(h: (req: Request, ctx: { params: P }, u: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => h(req, ctx, { id: "user-1" }),
}));
const mockRequireRole = vi.fn((..._a: unknown[]): unknown => undefined);
vi.mock("@/lib/rbac", () => ({ requireRole: (...a: unknown[]) => mockRequireRole(...a) }));
const mockLogEvent = vi.fn((..._a: unknown[]): void => undefined);
vi.mock("@/lib/event-logger", () => ({ logEvent: (...a: unknown[]) => mockLogEvent(...a) }));
const mockApply = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());
vi.mock("@/lib/spreadsheet-import/apply", () => ({ applyImport: (...a: unknown[]) => mockApply(...a) }));

function forbiddenResp() {
  return { ok: false, response: new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN" } }), { status: 403, headers: { "content-type": "application/json" } }) };
}

async function xlsx(opts: { lineContent?: boolean }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const cs = wb.addWorksheet("characters"); cs.addRow(["character_key", "name"]); cs.addRow(["chief", "署長"]);
  const ps = wb.addWorksheet("phases");     ps.addRow(["phase_key", "name", "is_start_phase"]); ps.addRow(["intro", "序章", "TRUE"]);
  const ms = wb.addWorksheet("messages");   ms.addRow(["message_key", "phase_key", "sort_order", "message_kind", "character_key", "content"]);
  ms.addRow(["m1", "intro", "1", "line", "chief", opts.lineContent === false ? "" : "ようこそ"]);
  const buf = await wb.xlsx.writeBuffer();
  return new File([new Uint8Array(buf as ArrayBuffer)], "import.xlsx");
}

async function callRoute(mode: string, file: File | null) {
  const { POST } = await import("@/app/api/oas/[id]/works/[workId]/import/spreadsheet/route");
  const fd = new FormData();
  if (file) fd.append("file", file);
  const req = new Request(`http://localhost/api/oas/oa-1/works/work-1/import/spreadsheet?mode=${mode}`, { method: "POST", body: fd });
  return (POST as never as (r: Request, c: { params: { id: string; workId: string } }) => Promise<Response>)(req, { params: { id: "oa-1", workId: "work-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "true"); // PR3: route は flag ON 前提で従来動作
  mockRequireRole.mockResolvedValue({ ok: true, role: "editor", status: "active" });
  mockPrisma.work.findFirst.mockResolvedValue({ id: "work-1" });
  mockPrisma.character.findMany.mockResolvedValue([]);
  mockPrisma.phase.findMany.mockResolvedValue([]);
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.transition.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb({}));
});
afterEach(() => vi.unstubAllEnvs());

describe("feature flag ガード", () => {
  it("flag OFF は validate でも 404（API 直叩きを閉じる）", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "false");
    const res = await callRoute("validate", await xlsx({}));
    expect(res.status).toBe(404);
  });
  it("flag OFF は apply でも 404・applyImport 未呼び出し", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "false");
    const res = await callRoute("apply", await xlsx({}));
    expect(res.status).toBe(404);
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe("権限 / スコープ", () => {
  it("editor 未満は 403（requireRole が editor を要求）", async () => {
    mockRequireRole.mockResolvedValue(forbiddenResp());
    const res = await callRoute("validate", await xlsx({}));
    expect(res.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "editor");
  });
  it("workId が oaId に属さない場合 404（他作品/他OA 拒否）", async () => {
    mockPrisma.work.findFirst.mockResolvedValue(null);
    const res = await callRoute("validate", await xlsx({}));
    expect(res.status).toBe(404);
    expect(mockPrisma.work.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "work-1", oaId: "oa-1" } }));
  });
});

describe("validate / apply", () => {
  it("validate: 正常データは ok:true・DB書込なし・applyImport 未呼び出し", async () => {
    const res = await callRoute("validate", await xlsx({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    const d = json.data ?? json;
    expect(d.ok).toBe(true);
    expect(d.summary.characters.create).toBe(1);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("apply: 検証NG（line の content 欠落）は 422・applyImport 未呼び出し", async () => {
    const res = await callRoute("apply", await xlsx({ lineContent: false }));
    expect(res.status).toBe(422);
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("apply: 正常データは transaction で applyImport 実行 + logEvent + 200", async () => {
    const res = await callRoute("apply", await xlsx({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith("spreadsheet_imported", expect.objectContaining({ workId: "work-1", oaId: "oa-1" }), expect.objectContaining({ userId: "user-1" }));
    const json = await res.json();
    const d = json.data ?? json;
    expect(d.applied.characters.create).toBe(1);
  });

  it("ファイル未添付は 400", async () => {
    const res = await callRoute("validate", null);
    expect(res.status).toBe(400);
  });

  it(".xlsx 以外は 400（拡張子）", async () => {
    const res = await callRoute("validate", new File([new Uint8Array(10)], "data.csv"));
    expect(res.status).toBe(400);
  });

  it("サイズ上限超過は 400", async () => {
    const { MAX_IMPORT_FILE_BYTES } = await import("@/lib/spreadsheet-import/file-guard");
    const res = await callRoute("validate", new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], "big.xlsx"));
    expect(res.status).toBe(400);
  });

  it("parse 失敗（中身が壊れた .xlsx）は 400（500ではない）", async () => {
    const res = await callRoute("validate", new File([new Uint8Array([1, 2, 3, 4, 5])], "broken.xlsx"));
    expect(res.status).toBe(400);
  });
});
