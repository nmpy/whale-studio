// src/__tests__/live-ticket-import-api.test.ts
// POST /api/oas/[id]/live/ticket-import のテスト。prisma / authorizeLive を mock。mint ヘルパー/service は実物。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp, mAuth } = vi.hoisted(() => ({
  mp: {
    work: { findFirst: vi.fn() },
    liveSession: { findFirst: vi.fn() },
    oa: { findUnique: vi.fn() },
    liveTeam: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    liveParticipant: { create: vi.fn() },
    liveTicketLinkToken: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mAuth: { authorizeLive: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));
vi.mock("@/lib/live-auth", () => ({ authorizeLive: mAuth.authorizeLive }));

import { POST } from "@/app/api/oas/[id]/live/ticket-import/route";

const HEADER = "公演日,公演時間,購入日時,チケット種別,ユーザー名,メールアドレス,システム側チケットID";
const CSV = [
  HEADER,
  "2026/08/17,14:00,2026/08/01 10:00,2名券,山田太郎,taro@example.com,TCK-0001",
  "2026/08/17,14:00,2026/08/01 11:00,4名券,鈴木花子,hanako@example.com,TCK-0002",
].join("\n");

function file(csv: string, name = "escape.csv"): File { return new File([csv], name, { type: "text/csv" }); }
function reqOf(f: File, fields: Record<string, string>): NextRequest {
  const fd = new FormData();
  fd.append("file", f);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new NextRequest("http://localhost/api/oas/oa1/live/ticket-import", { method: "POST", body: fd });
}
const req = (csv: string, fields: Record<string, string>, name = "escape.csv") => reqOf(file(csv, name), fields);
const call = (r: NextRequest) => POST(r, { params: { id: "oa1" } });

beforeEach(() => {
  vi.clearAllMocks();
  mAuth.authorizeLive.mockResolvedValue({ ok: true, user: { id: "u1" }, via: "oa_owner" });
  mp.work.findFirst.mockResolvedValue({ id: "w1" });
  mp.liveSession.findFirst.mockResolvedValue({ id: "s1", name: "公演A", status: "active", startsAt: new Date("2026-08-17T05:00:00Z") });
  mp.oa.findUnique.mockResolvedValue({ liffId: "1234-abcd" });
  mp.liveTicketLinkToken.findMany.mockResolvedValue([]);
  mp.liveTeam.findMany.mockResolvedValue([]);
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
  mp.liveTeam.findFirst.mockResolvedValue(null);
  mp.liveTeam.create.mockImplementation(async () => ({ id: "team-" + Math.random().toString(36).slice(2, 8) }));
  mp.liveTeam.update.mockResolvedValue({});
  mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
  mp.liveTicketLinkToken.create.mockResolvedValue({ id: "tok1" });
});

describe("auth / tenant / session", () => {
  it("authorizeLive 失敗はそのレスポンス", async () => {
    mAuth.authorizeLive.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    expect((await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).status).toBe(401);
  });
  it("work が OA 外は 400", async () => {
    mp.work.findFirst.mockResolvedValue(null);
    expect((await call(req(CSV, { work_id: "wX", session_id: "s1", mode: "preview" }))).status).toBe(400);
  });
  it("他 OA / 不在 Session 指定は 404（存在秘匿）", async () => {
    mp.liveSession.findFirst.mockResolvedValue(null);
    expect((await call(req(CSV, { work_id: "w1", session_id: "sX", mode: "preview" }))).status).toBe(404);
  });
  it("終了 Session は 400", async () => {
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", name: "終了公演", status: "ended", startsAt: null });
    expect((await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).status).toBe(400);
  });
});

describe("preview（URL/token を生成しない）", () => {
  it("件数を返し token/team を作らない・URL を含めない", async () => {
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.mode).toBe("preview");
    expect(json.data.counts).toMatchObject({ total: 2, valid: 2, error: 0, teams_create: 2, tokens_issue: 2, tokens_skip: 0 });
    expect(json.data.oa_liff_configured).toBe(true);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    expect(mp.liveTeam.create).not.toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toContain("liff.line.me");
  });
  it("liffId 未設定は oa_liff_configured=false", async () => {
    mp.oa.findUnique.mockResolvedValue({ liffId: null });
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.oa_liff_configured).toBe(false);
  });
  it("ファイル内 ticketId 重複は 2件目以降が error", async () => {
    const dup = CSV + "\n2026/08/17,14:00,x,2名券,別人,z@example.com,TCK-0001";
    const json = await (await call(req(dup, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.error).toBe(1);
    expect(json.data.counts.valid).toBe(2);
  });
  it("表に無い/1名/3名 のチケット種別は validation error（Apply 対象外・行番号+種別+理由）", async () => {
    const csv = [HEADER,
      "2026/08/17,14:00,x,1名券,A,a@example.com,T1",
      "2026/08/17,14:00,x,3名券,B,b@example.com,T2",
      "2026/08/17,14:00,x,特別席,C,c@example.com,T3",
      "2026/08/17,14:00,x,2名券,D,d@example.com,T4",
    ].join("\n");
    const json = await (await call(req(csv, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.error).toBe(3);
    expect(json.data.counts.valid).toBe(1);
    const errRow = json.data.rows.find((r: { plan: string }) => r.plan === "error");
    expect(errRow.ticketType).toBeDefined();
    expect(errRow.error).toContain("対応外");
  });
  it("公演日時が Session と不一致なら preview 警告", async () => {
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", name: "公演A", status: "active", startsAt: new Date("2026-08-18T05:00:00Z") });
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.date_mismatch).toBe(2);
    expect(json.data.warnings.date_mismatch).toBeTruthy();
  });
  it("同一 OA・別 Session に既存 ticketId は error", async () => {
    mp.liveTeam.findMany.mockImplementation(async (args: { where?: { liveSessionId?: { not?: string } } }) =>
      args?.where?.liveSessionId?.not ? [{ ticketId: "TCK-0001" }] : []);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.error).toBe(1);
    const err = json.data.rows.find((r: { plan: string }) => r.plan === "error");
    expect(err.error).toContain("別のSession");
  });
});

describe("apply（team upsert + token 発行・共通 mint service 経由）", () => {
  it("team+token を作り URL を返す・participant 非作成・平文/メール非保存・URL をログに出さない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).json();
    expect(json.data.counts).toMatchObject({ total: 2, valid: 2, created: 2, updated: 0, issued: 2, skipped: 0, reissued: 0, validationFailed: 0, applyFailed: 0 });
    expect(mp.liveTeam.create).toHaveBeenCalledTimes(2);
    expect(mp.liveTeam.create.mock.calls[0][0].data.reservationNumber).toBe("TCK-0001");
    expect(mp.liveTeam.create.mock.calls[0][0].data.purchaserName).toBeNull(); // 氏名は DB 非保存
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
    expect(mp.liveTicketLinkToken.create).toHaveBeenCalledTimes(2);
    const tok = mp.liveTicketLinkToken.create.mock.calls[0][0].data;
    expect(tok.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect("token" in tok).toBe(false);
    expect("url" in tok).toBe(false);
    const issued = json.data.rows.filter((r: { result: string }) => r.result === "issued");
    expect(issued[0].url).toMatch(/^https:\/\/liff\.line\.me\/1234-abcd\/ticket\?t=/);
    const writes = JSON.stringify([...mp.liveTeam.create.mock.calls, ...mp.liveTeam.update.mock.calls, ...mp.liveTicketLinkToken.create.mock.calls]);
    expect(writes).not.toContain("taro@example.com"); // メール非保存
    expect(writes).not.toContain("山田太郎");           // 氏名非保存
    expect(writes).not.toContain("liff.line.me");      // 平文 URL 非保存
    const logged = [...errSpy.mock.calls, ...logSpy.mock.calls].map((a) => JSON.stringify(a)).join();
    expect(logged).not.toContain("liff.line.me");
    errSpy.mockRestore(); logSpy.mockRestore();
  });
  it("既存有効 token は skip（発行しない）", async () => {
    mp.liveTicketLinkToken.findMany.mockResolvedValue([{ reservationNumber: "TCK-0001" }]);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).json();
    expect(json.data.counts).toMatchObject({ issued: 1, skipped: 1 });
    expect(mp.liveTicketLinkToken.create).toHaveBeenCalledTimes(1);
  });
  it("明示再発行は旧 token revoke → 新規発行", async () => {
    mp.liveTicketLinkToken.findMany.mockResolvedValue([{ reservationNumber: "TCK-0001" }]);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply", reissue_ticket_ids: JSON.stringify(["TCK-0001"]) }))).json();
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalled();
    expect(json.data.counts).toMatchObject({ issued: 1, reissued: 1 });
  });
  it("既存 team は update（重複作成しない）", async () => {
    mp.liveTeam.findFirst.mockImplementation(async (args: { where?: { ticketId?: string } }) =>
      args?.where?.ticketId === "TCK-0001" ? { id: "existing-team" } : null);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).json();
    expect(json.data.counts).toMatchObject({ created: 1, updated: 1 });
  });
  it("liffId 未設定は apply で 422（token 非作成）", async () => {
    mp.oa.findUnique.mockResolvedValue({ liffId: null });
    expect((await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).status).toBe(422);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("transaction が予期せず失敗したら全件 applyFailed（rollback）", async () => {
    mp.$transaction.mockRejectedValue(new Error("db down"));
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).json();
    expect(json.data.counts).toMatchObject({ created: 0, issued: 0, applyFailed: 2 });
  });
});

describe("入力上限 / 解析", () => {
  it("5000 行は許可・5001 行は拒否", async () => {
    const rowsN = (n: number) => [HEADER, ...Array.from({ length: n }, (_, i) => `2026/08/17,14:00,x,2名券,U,u@example.com,TCK-${i}`)].join("\n");
    expect((await call(req(rowsN(5000), { work_id: "w1", session_id: "s1", mode: "preview" }))).status).toBe(200);
    expect((await call(req(rowsN(5001), { work_id: "w1", session_id: "s1", mode: "preview" }))).status).toBe(400);
  });
  it("10MB 超過は拒否（parse 前 size ガード）", async () => {
    const big = new File(["a".repeat(10 * 1024 * 1024 + 100)], "big.csv", { type: "text/csv" });
    expect((await call(reqOf(big, { work_id: "w1", session_id: "s1", mode: "preview" }))).status).toBe(400);
  });
  it("未対応拡張子は 400 / session_id 未指定は 400", async () => {
    expect((await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }, "data.pdf"))).status).toBe(400);
    expect((await call(req(CSV, { work_id: "w1", mode: "preview" }))).status).toBe(400);
  });
  it("xlsx を読み込める（最初のシートのみ・シート名を返す）", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("予約一覧");
    ws.addRow(["公演日", "公演時間", "購入日時", "チケット種別", "ユーザー名", "メールアドレス", "システム側チケットID"]);
    ws.addRow(["2026/08/17", "14:00", "2026/08/01", "2名券", "山田太郎", "taro@example.com", "TCK-X1"]);
    const buf = await wb.xlsx.writeBuffer();
    const f = new File([buf as unknown as BlobPart], "escape.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const json = await (await call(reqOf(f, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.file.format).toBe("xlsx");
    expect(json.data.file.sheet_name).toBe("予約一覧");
    expect(json.data.counts.valid).toBe(1);
  });
  it("Shift_JIS CSV を読み込める", async () => {
    const iconv = (await import("iconv-lite")).default;
    const f = new File([iconv.encode(CSV, "Shift_JIS") as unknown as BlobPart], "escape.csv", { type: "text/csv" });
    const json = await (await call(reqOf(f, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.valid).toBe(2);
  });
});
