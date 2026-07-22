// src/__tests__/uzupro-bind-line-api.test.ts
// for LIFF プレイヤー連携ルート:
//   POST /api/liff/player-links/[publicCode]/bind-line … idToken 検証 → 対象プレイヤーへ紐づけ
//   GET  /api/liff/player-links/[publicCode]           … 公開コード解決（liffId + 粗い状態）
// resolve/bind（line-link）・verify（id-token）・activity・prisma は mock。
// セキュリティ契約: レスポンスに フル LINE User ID / idToken / 内部ID を一切含めない。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp } = vi.hoisted(() => ({ mp: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

const { resolveUzuProPlayerLink, bindPlayerLineUser } = vi.hoisted(() => ({
  resolveUzuProPlayerLink: vi.fn(),
  bindPlayerLineUser: vi.fn(),
}));
vi.mock("@/lib/uzupro/line-link", () => ({ resolveUzuProPlayerLink, bindPlayerLineUser }));

const { verifyLiffIdToken, channelIdFromLiffId } = vi.hoisted(() => ({
  verifyLiffIdToken: vi.fn(),
  channelIdFromLiffId: vi.fn((_liffId?: unknown): string | null => "1656565252"),
}));
vi.mock("@/lib/liff/id-token", () => ({ verifyLiffIdToken, channelIdFromLiffId }));

const { recordUzuProActivity } = vi.hoisted(() => ({
  recordUzuProActivity: vi.fn((): Promise<void> => Promise.resolve()),
}));
vi.mock("@/lib/uzupro/activity", () => ({ recordUzuProActivity }));

import { POST } from "@/app/api/liff/player-links/[publicCode]/bind-line/route";
import { GET } from "@/app/api/liff/player-links/[publicCode]/route";

const CODE = "abcdefghij0123456789"; // 20 chars, matches ^[A-Za-z0-9_-]{16,256}$
const ID_TOKEN = "id-token-secret-abc.def.ghi";
const UID = "U0123456789abcdef0123456789abcdef";

const req = (body: unknown, code = CODE) =>
  new NextRequest(`http://localhost/api/liff/player-links/${code}/bind-line`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (code = CODE) => ({ params: { publicCode: code } });

const resolveOk = () =>
  resolveUzuProPlayerLink.mockResolvedValue({
    kind: "ok",
    linkId: "l-internal-1",
    playerId: "p-internal-1",
    bookingId: "b-internal-1",
    oaId: "oa1",
    liffId: "1656565252-abcd",
  });
const verifyOk = () => verifyLiffIdToken.mockResolvedValue({ ok: true, lineUserId: UID });

// レスポンス本文（parse 済み JSON）に秘匿値・内部ID が漏れていないことを保証する共通アサート。
function assertNoLeak(json: unknown) {
  const raw = JSON.stringify(json);
  expect(raw).not.toContain(UID); // フル LINE User ID
  expect(raw).not.toContain(ID_TOKEN); // 生 idToken
  expect(raw).not.toContain("l-internal-1"); // 内部リンクID
  expect(raw).not.toContain("p-internal-1"); // 内部プレイヤーID
  expect(raw).not.toContain("b-internal-1"); // 内部予約ID
}

beforeEach(() => {
  vi.clearAllMocks();
  channelIdFromLiffId.mockReturnValue("1656565252");
});

describe("POST bind-line — publicCode / 本文検証", () => {
  it("形式不正な publicCode → 400 invalid_code（resolve しない）", async () => {
    const res = await POST(req({ idToken: ID_TOKEN }, "short"), ctx("short"));
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("invalid_code");
    expect(resolveUzuProPlayerLink).not.toHaveBeenCalled();
  });

  it("本文に余分キー（PII）→ 400（strict 拒否・bind しない）", async () => {
    resolveOk();
    verifyOk();
    for (const extra of [{ lineUserId: UID }, { playerId: "px" }, { bookingId: "bx" }, { displayName: "山田" }]) {
      vi.clearAllMocks();
      channelIdFromLiffId.mockReturnValue("1656565252");
      const res = await POST(req({ idToken: ID_TOKEN, ...extra }), ctx());
      expect(res.status).toBe(400);
      expect(bindPlayerLineUser).not.toHaveBeenCalled();
      assertNoLeak(await res.json());
    }
  });
});

describe("POST bind-line — リンク解決 / トークン検証", () => {
  it("リンクが ok でない（not_found）→ 410、verify/bind しない", async () => {
    resolveUzuProPlayerLink.mockResolvedValue({ kind: "not_found" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(410);
    expect(verifyLiffIdToken).not.toHaveBeenCalled();
    expect(bindPlayerLineUser).not.toHaveBeenCalled();
  });

  it("idToken 欠如判定（missing_id_token）→ 400 id_token_required", async () => {
    resolveOk();
    verifyLiffIdToken.mockResolvedValue({ ok: false, reason: "missing_id_token" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("id_token_required");
  });

  it("一時障害（temporarily_unavailable）→ 503 retryable:true", async () => {
    resolveOk();
    verifyLiffIdToken.mockResolvedValue({ ok: false, reason: "temporarily_unavailable" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("line_unavailable");
    expect(json.retryable).toBe(true);
    expect(bindPlayerLineUser).not.toHaveBeenCalled();
  });

  it("token_invalid → 401 line_auth_failed retryable:false", async () => {
    resolveOk();
    verifyLiffIdToken.mockResolvedValue({ ok: false, reason: "token_invalid" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.status).toBe("line_auth_failed");
    expect(json.retryable).toBe(false);
    expect(bindPlayerLineUser).not.toHaveBeenCalled();
  });

  it("audience_mismatch → 401 line_auth_failed", async () => {
    resolveOk();
    verifyLiffIdToken.mockResolvedValue({ ok: false, reason: "audience_mismatch" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(401);
    expect((await res.json()).status).toBe("line_auth_failed");
  });
});

describe("POST bind-line — 紐づけ結果", () => {
  it("linked → 200 linked（秘匿値・内部ID を漏らさない）", async () => {
    resolveOk();
    verifyOk();
    bindPlayerLineUser.mockResolvedValue({ kind: "linked" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("linked");
    // verify 済み sub のみを bind に渡す（クライアント申告ではない）。
    expect(bindPlayerLineUser.mock.calls[0][0]).toMatchObject({ lineUserId: UID, playerId: "p-internal-1" });
    assertNoLeak(json);
  });

  it("already_linked_same → 200 already_linked", async () => {
    resolveOk();
    verifyOk();
    bindPlayerLineUser.mockResolvedValue({ kind: "already_linked_same" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("already_linked");
    assertNoLeak(json);
  });

  it("conflict_other_account → 409", async () => {
    resolveOk();
    verifyOk();
    bindPlayerLineUser.mockResolvedValue({ kind: "conflict_other_account" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.status).toBe("conflict_other_account");
    expect(json.retryable).toBe(false);
    assertNoLeak(json);
  });

  it("conflict_booking_duplicate → 409", async () => {
    resolveOk();
    verifyOk();
    bindPlayerLineUser.mockResolvedValue({ kind: "conflict_booking_duplicate" });
    const res = await POST(req({ idToken: ID_TOKEN }), ctx());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.status).toBe("conflict_booking_duplicate");
    assertNoLeak(json);
  });
});

describe("GET player-link resolve", () => {
  it("active（ok）→ state:active + liffId（公開値）", async () => {
    resolveUzuProPlayerLink.mockResolvedValue({ kind: "ok", liffId: "1656565252-abcd", linkId: "l1", playerId: "p1", bookingId: "b1", oaId: "oa1" });
    const res = await GET(new NextRequest(`http://localhost/api/liff/player-links/${CODE}`), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ state: "active", liffId: "1656565252-abcd" });
    // 内部ID を返さない。
    expect(JSON.stringify(json.data)).not.toContain("p1");
    expect(JSON.stringify(json.data)).not.toContain("b1");
  });

  it("not_found → state:not_found, liffId:null", async () => {
    resolveUzuProPlayerLink.mockResolvedValue({ kind: "not_found" });
    const res = await GET(new NextRequest(`http://localhost/api/liff/player-links/${CODE}`), ctx());
    expect((await res.json()).data).toEqual({ state: "not_found", liffId: null });
  });

  it("revoked → state:revoked", async () => {
    resolveUzuProPlayerLink.mockResolvedValue({ kind: "revoked" });
    const res = await GET(new NextRequest(`http://localhost/api/liff/player-links/${CODE}`), ctx());
    expect((await res.json()).data).toEqual({ state: "revoked", liffId: null });
  });

  it("expired → state:expired", async () => {
    resolveUzuProPlayerLink.mockResolvedValue({ kind: "expired" });
    const res = await GET(new NextRequest(`http://localhost/api/liff/player-links/${CODE}`), ctx());
    expect((await res.json()).data).toEqual({ state: "expired", liffId: null });
  });

  it("形式不正な publicCode → DB を触らず not_found（存在推測防止）", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/liff/player-links/bad`), ctx("bad"));
    expect((await res.json()).data).toEqual({ state: "not_found", liffId: null });
    expect(resolveUzuProPlayerLink).not.toHaveBeenCalled();
  });
});
