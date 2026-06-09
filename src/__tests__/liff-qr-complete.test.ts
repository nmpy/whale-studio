// src/__tests__/liff-qr-complete.test.ts
//
// POST /api/liff/qr/complete の API テスト。
// LINE への通信（token 検証 / push）と DB はすべて mock し、分岐とセキュリティ不変条件を検証する。

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Prisma mock ──
const mockOa = { findUnique: vi.fn() };
const mockWork = { findUnique: vi.fn() };
const mockMessage = { findUnique: vi.fn() };
const mockLiffEventLog = { create: vi.fn(), findMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({
  prisma: { oa: mockOa, work: mockWork, message: mockMessage, liffEventLog: mockLiffEventLog },
}));

// ── accessToken 検証 mock（LINE /v2/profile を叩かない）──
const mockVerify = vi.fn();
vi.mock("@/lib/liff/session", () => ({
  verifyLiffAccessToken: (...a: unknown[]) => mockVerify(...a),
  LIFF_SESSION_USER_ERROR: "LINE連携に失敗しました。",
}));

// ── LINE 送信 mock ──
const mockPush = vi.fn();
vi.mock("@/lib/line", () => ({
  pushToLine: (...a: unknown[]) => mockPush(...a),
  buildKeywordMessages: () => [{ type: "text", text: "hi" }],
}));

// ── QR → Location 解決 mock ──
const mockFindLocation = vi.fn();
vi.mock("@/lib/public-id-resolver", () => ({
  findLocationByIdOrPublicId: (...a: unknown[]) => mockFindLocation(...a),
}));

function makeReq(body: unknown) {
  return new Request("http://localhost/api/liff/qr/complete", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  }) as unknown as Parameters<typeof callPost>[0];
}

// 動的 import（mock 適用後に route を読む）
async function callPost(req: unknown) {
  const { POST } = await import("@/app/api/liff/qr/complete/route");
  return POST(req as never);
}

const VALID_BODY = { accessToken: "tok", oaId: "oa-1", workId: "work-1", qrValue: "L1", scanId: "scan-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue({ ok: true, lineUserId: "U1", displayName: "なみ" });
  mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "OA", channelAccessToken: "cat", liffScanQrEnabled: true, serviceSuspendedAt: null });
  mockWork.findUnique.mockResolvedValue({ id: "work-1", oaId: "oa-1" });
  mockFindLocation.mockResolvedValue({ id: "loc-1", name: "スポットA", workId: "work-1", qrSuccessMessageId: "msg-1" });
  mockMessage.findUnique.mockResolvedValue({
    id: "msg-1", messageType: "text", body: "hi", assetUrl: null, altText: null,
    flexPayloadJson: null, quickReplies: null, nextMessageId: null, sortOrder: 0,
    imageActionType: null, imageActionText: null, imageActionUrl: null,
    imageActionLiffPageId: null, imageActionPostbackData: null, lagMs: null,
    freeInputEnabled: false, character: null,
  });
  mockLiffEventLog.create.mockResolvedValue({});
  mockLiffEventLog.findMany.mockResolvedValue([]); // 重複なし
  mockPush.mockResolvedValue({ ok: true, status: 200 });
});

describe("POST /api/liff/qr/complete", () => {
  it("accessToken なし → 401（検証ステップで弾く）", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "missing_access_token" });
    const res = await callPost(makeReq({ oaId: "oa-1", workId: "work-1", qrValue: "L1" }));
    expect(res.status).toBe(401);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("token 検証失敗 → 401", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "token_invalid" });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("scanQrEnabled=false → 403 FEATURE_DISABLED", async () => {
    mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "OA", channelAccessToken: "cat", liffScanQrEnabled: false, serviceSuspendedAt: null });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("FEATURE_DISABLED");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("scanQrEnabled=true なら plan guard で 403 にならず push 経路へ進む（plan guard 撤去）", async () => {
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sent).toBe(true);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("他 OA の work → 404（テナント分離）", async () => {
    mockWork.findUnique.mockResolvedValue({ id: "work-1", oaId: "other-oa" });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("QR 未一致（Location 解決できない）→ qr_not_matched / push しない", async () => {
    mockFindLocation.mockResolvedValue(null);
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(false);
    expect(json.data.code).toBe("qr_not_matched");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("メッセージ未設定 → message_not_configured / push しない", async () => {
    mockFindLocation.mockResolvedValue({ id: "loc-1", name: "スポットA", workId: "work-1", qrSuccessMessageId: null });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sent).toBe(false);
    expect(json.data.code).toBe("message_not_configured");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("正常系 → push が verified lineUserId 宛に呼ばれ sent:true", async () => {
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sent).toBe(true);
    expect(json.data.target.id).toBe("loc-1");
    expect(mockPush).toHaveBeenCalledTimes(1);
    // push の宛先は検証済み lineUserId（フロントの userId ではない）
    const callArgs = mockPush.mock.calls[0];
    expect(callArgs[0]).toBe("U1");
    expect(callArgs[2]).toBe("cat"); // channel access token
  });

  it("二重送信 → alreadyProcessed:true / 再 push しない", async () => {
    mockLiffEventLog.findMany.mockResolvedValue([{ metadataJson: { targetId: "loc-1" } }]);
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alreadyProcessed).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("push 失敗 → 502 SEND_FAILED", async () => {
    mockPush.mockResolvedValue({ ok: false, status: 500 });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("SEND_FAILED");
  });

  it("OA 停止中 → push せず service_suspended", async () => {
    mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "OA", channelAccessToken: "cat", liffScanQrEnabled: true, serviceSuspendedAt: new Date("2026-01-01") });
    const res = await callPost(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sent).toBe(false);
    expect(json.data.code).toBe("service_suspended");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
