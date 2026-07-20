// src/__tests__/live-ticket-import-api.test.ts
// POST /api/oas/[id]/live/ticket-import のテスト。prisma / authorizeLive を mock。mint ヘルパーは実物。
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

const CSV = [
  "公演日,公演時間,購入日時,チケット種別,ユーザー名,メールアドレス,システム側チケットID",
  "2026/08/17,14:00,2026/08/01 10:00,2名券,山田太郎,taro@example.com,TCK-0001",
  "2026/08/17,14:00,2026/08/01 11:00,4名券,鈴木花子,hanako@example.com,TCK-0002",
].join("\n");

function req(csv: string, fields: Record<string, string>, filename = "escape.csv"): NextRequest {
  const fd = new FormData();
  fd.append("file", new File([csv], filename, { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new NextRequest("http://localhost/api/oas/oa1/live/ticket-import", { method: "POST", body: fd });
}
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

describe("auth / tenant", () => {
  it("authorizeLive 失敗はそのレスポンスを返す", async () => {
    mAuth.authorizeLive.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    const res = await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }));
    expect(res.status).toBe(401);
    expect(mp.work.findFirst).not.toHaveBeenCalled();
  });
  it("work が OA 外は 400", async () => {
    mp.work.findFirst.mockResolvedValue(null);
    const res = await call(req(CSV, { work_id: "wX", session_id: "s1", mode: "preview" }));
    expect(res.status).toBe(400);
  });
  it("session が OA/work 外は 404", async () => {
    mp.liveSession.findFirst.mockResolvedValue(null);
    const res = await call(req(CSV, { work_id: "w1", session_id: "sX", mode: "preview" }));
    expect(res.status).toBe(404);
  });
});

describe("preview（URL/token を生成しない）", () => {
  it("件数を返し token を作らない", async () => {
    const res = await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.mode).toBe("preview");
    expect(json.data.counts).toMatchObject({ total: 2, valid: 2, error: 0, teams_create: 2, tokens_issue: 2, tokens_skip: 0 });
    expect(json.data.oa_liff_configured).toBe(true);
    // preview は token/team を作らない・URL を含めない
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    expect(mp.liveTeam.create).not.toHaveBeenCalled();
    expect(JSON.stringify(json)).not.toContain("liff.line.me");
  });
  it("liffId 未設定なら oa_liff_configured=false（preview は通る）", async () => {
    mp.oa.findUnique.mockResolvedValue({ liffId: null });
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.oa_liff_configured).toBe(false);
  });
  it("ファイル内 ticketId 重複は 1 件 error", async () => {
    const dup = CSV + "\n2026/08/17,14:00,x,2名券,別人,z@example.com,TCK-0001";
    const json = await (await call(req(dup, { work_id: "w1", session_id: "s1", mode: "preview" }))).json();
    expect(json.data.counts.error).toBe(1);
  });
});

describe("apply（team upsert + token 発行）", () => {
  it("team + token を作り URL を返す・participant は作らない・平文/メールを保存しない", async () => {
    const res = await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.counts).toMatchObject({ issued: 2, skipped: 0, failed: 0 });
    // team 作成（reservationNumber = ticketId）
    expect(mp.liveTeam.create).toHaveBeenCalledTimes(2);
    const teamData = mp.liveTeam.create.mock.calls[0][0].data;
    expect(teamData.ticketId).toBe("TCK-0001");
    expect(teamData.reservationNumber).toBe("TCK-0001");
    expect(teamData.groupType).toBe("two");
    // participant は作らない
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
    // token は hash のみ保存（平文 token / url フィールドなし）
    expect(mp.liveTicketLinkToken.create).toHaveBeenCalledTimes(2);
    const tokData = mp.liveTicketLinkToken.create.mock.calls[0][0].data;
    expect(tokData.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect("token" in tokData).toBe(false);
    expect("url" in tokData).toBe(false);
    // URL はレスポンスにだけ載る
    const issued = json.data.rows.filter((r: { result: string }) => r.result === "issued");
    expect(issued).toHaveLength(2);
    expect(issued[0].url).toMatch(/^https:\/\/liff\.line\.me\/1234-abcd\/ticket\?t=/);
    // メールアドレスは DB 書き込み（team/token）に一切含めない
    const allWrites = JSON.stringify([...mp.liveTeam.create.mock.calls, ...mp.liveTicketLinkToken.create.mock.calls]);
    expect(allWrites).not.toContain("taro@example.com");
    expect(allWrites).not.toContain("hanako@example.com");
  });
  it("既存の有効 token がある行は skip（新規発行しない）", async () => {
    mp.liveTicketLinkToken.findMany.mockResolvedValue([{ reservationNumber: "TCK-0001" }]);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }))).json();
    expect(json.data.counts.issued).toBe(1);
    expect(json.data.counts.skipped).toBe(1);
    // TCK-0001 は token.create されない（1 回のみ = TCK-0002）
    expect(mp.liveTicketLinkToken.create).toHaveBeenCalledTimes(1);
  });
  it("明示再発行は旧 token を revoke してから新規発行", async () => {
    mp.liveTicketLinkToken.findMany.mockResolvedValue([{ reservationNumber: "TCK-0001" }]);
    const json = await (await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply", reissue_ticket_ids: JSON.stringify(["TCK-0001"]) }))).json();
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalled(); // revoke
    expect(json.data.counts.issued).toBe(2); // 両方発行
  });
  it("liffId 未設定は apply で 422", async () => {
    mp.oa.findUnique.mockResolvedValue({ liffId: null });
    const res = await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }));
    expect(res.status).toBe(422);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
});

describe("入力ガード", () => {
  it("対応外拡張子は 400", async () => {
    const res = await call(req(CSV, { work_id: "w1", session_id: "s1", mode: "apply" }, "data.pdf"));
    expect(res.status).toBe(400);
  });
  it("session_id 未指定は 400", async () => {
    const res = await call(req(CSV, { work_id: "w1", mode: "preview" }));
    expect(res.status).toBe(400);
  });
});

describe("解析（xlsx / Shift_JIS）", () => {
  it("xlsx を読み込める（exceljs）", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["公演日", "公演時間", "購入日時", "チケット種別", "ユーザー名", "メールアドレス", "システム側チケットID"]);
    ws.addRow(["2026/08/17", "14:00", "2026/08/01", "2名券", "山田太郎", "taro@example.com", "TCK-X1"]);
    const buf = await wb.xlsx.writeBuffer();
    const fd = new FormData();
    fd.append("file", new File([buf], "escape.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    fd.append("work_id", "w1"); fd.append("session_id", "s1"); fd.append("mode", "preview");
    const res = await POST(new NextRequest("http://localhost/api/oas/oa1/live/ticket-import", { method: "POST", body: fd }), { params: { id: "oa1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.file.format).toBe("xlsx");
    expect(json.data.counts.valid).toBe(1);
    expect(json.data.counts.tokens_issue).toBe(1);
  });
  it("Shift_JIS CSV を読み込める（iconv 自動判定）", async () => {
    const iconv = (await import("iconv-lite")).default;
    const sjis = iconv.encode(CSV, "Shift_JIS");
    const fd = new FormData();
    fd.append("file", new File([sjis], "escape.csv", { type: "text/csv" }));
    fd.append("work_id", "w1"); fd.append("session_id", "s1"); fd.append("mode", "preview");
    const res = await POST(new NextRequest("http://localhost/api/oas/oa1/live/ticket-import", { method: "POST", body: fd }), { params: { id: "oa1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.counts.valid).toBe(2);
  });
});
