/**
 * src/__tests__/ticket-link-draft-reservation-number-api.test.ts
 *
 * draft API（POST /api/liff/works/[workId]/ticket-link/draft）が、
 * クライアントを迂回した直接 POST でも予約番号を**厳格に**検証することの回帰テスト。
 *
 * ticket_link 手動入力は「数字 6 桁を 3-3 で区切る」形のみ。
 * 不正文字を含む値は、数字だけ抜き出すと 6 桁になっても保存・照合・外部連携へ流さない。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const WORK_ID = "8887ea5d-21e9-48c9-9bb0-4b957b0e9a70";
const OA_ID   = "8500d2ba-7418-4942-98f7-8ce40a8b27f2";

const mockPrisma = {
  ticketLinkDraft: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// 認証は別テストで担保。ここでは通過させ、予約番号の検証だけを見る。
vi.mock("@/lib/ticket-link/auth", () => ({
  authenticateTicketLinkRequest: vi.fn(async () => ({
    ok: true,
    ctx: {
      lineUserId: "U".padEnd(33, "0"),
      displayName: "tester",
      oaId: OA_ID,
      workId: WORK_ID,
      liffId: "2010632019-YRm96VSK",
      channelId: "2010631915",
      settings: {
        enabled: true, manualInputEnabled: true, imageInputEnabled: false,
        ticketTypes: [{ ticketTypeKey: "two", ticketTypeLabel: "2名チケット", participantCount: 2, enabled: true, sortOrder: 0 }],
        reportButtonEnabled: false, reportButtonLabel: "報告する", reportMessage: "報告する",
        completionMessage: "受け付けました",
      },
    },
  })),
  authFailureMessage: () => "err",
  authFailureStatus: () => 401,
  assertTicketLinkPageBelongsToWork: vi.fn(async () => true),
}));

function postReq(body: unknown) {
  return new Request(`http://localhost/api/liff/works/${WORK_ID}/ticket-link/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

async function callDraft(reservationNumber: string) {
  const { POST } = await import("@/app/api/liff/works/[workId]/ticket-link/draft/route");
  const res = await POST(
    postReq({ accessToken: "tok", ticketTypeKey: "two", purchaserName: "テスト", reservationNumber }),
    { params: Promise.resolve({ workId: WORK_ID }) } as never,
  );
  return { status: (res as Response).status, json: await (res as Response).json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.ticketLinkDraft.findFirst.mockResolvedValue(null);
  mockPrisma.ticketLinkDraft.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "draft-1", step: data.step ?? "TICKET_REVIEW" }),
  );
});

/** create に渡された confirmedPayload を取り出す。 */
function createdPayload(): Record<string, unknown> {
  const call = mockPrisma.ticketLinkDraft.create.mock.calls[0]?.[0] as { data: { confirmedPayload?: unknown } };
  return (call?.data?.confirmedPayload ?? {}) as Record<string, unknown>;
}

describe("draft API — 受理される入力は正規形へ揃う", () => {
  it("123456 を送ると 123-456 に正規化して保存する", async () => {
    const { status } = await callDraft("123456");
    expect(status).toBe(200);
    expect(createdPayload().normalizedReservationNumber).toBe("123-456");
  });

  it("１２３－４５６（全角）を送ると 123-456 に正規化して保存する", async () => {
    const { status } = await callDraft("１２３－４５６");
    expect(status).toBe(200);
    expect(createdPayload().normalizedReservationNumber).toBe("123-456");
  });

  it("123 456（空白区切り）も 123-456 になる", async () => {
    await callDraft("123 456");
    expect(createdPayload().normalizedReservationNumber).toBe("123-456");
  });
});

describe("draft API — 直接 POST でも不正値を拒否する", () => {
  const rejected = [
    ["abc123def456", "英字混在（数字だけ抜くと6桁）"],
    ["123a456",      "英字混在"],
    ["123/456",      "不正記号"],
    ["123_456",      "不正記号"],
    ["123.456",      "不正記号"],
    ["123456円",     "全角文字混在"],
    ["12-34",        "桁数不足"],
    ["123-45",       "桁数不足（整形途中の形）"],
    ["1234-56",      "3-3 でない区切り"],
    ["1234567",      "7桁"],
  ] as const;

  it.each(rejected)("%s は 400 で拒否される（%s）", async (value) => {
    const { status } = await callDraft(value);
    expect(status).toBe(400);
    expect(mockPrisma.ticketLinkDraft.create).not.toHaveBeenCalled();
  });

  it("拒否時は DB へ一切書き込まない", async () => {
    await callDraft("abc123def456");
    expect(mockPrisma.ticketLinkDraft.create).not.toHaveBeenCalled();
    expect(mockPrisma.ticketLinkDraft.update).not.toHaveBeenCalled();
  });
});
