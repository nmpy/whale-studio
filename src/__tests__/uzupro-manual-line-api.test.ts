// src/__tests__/uzupro-manual-line-api.test.ts
// LINE User ID 手動登録/解除ルート（LIFF 管理者のみ）:
//   POST   .../players/:playerId/line/manual … 手動登録（idToken 不要・直接登録）
//   DELETE .../players/:playerId/line/manual … 手動解除
// 認可(authorizeUzuProManager)・service(manualLink/Unlink)・activity・prisma は mock。
// 契約: フル LINE User ID / 入力値がレスポンス・監査ログへ漏れない。想定外 body は 400。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mp } = vi.hoisted(() => ({ mp: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

const { authorizeUzuProManager } = vi.hoisted(() => ({ authorizeUzuProManager: vi.fn() }));
vi.mock("@/lib/uzupro-auth", () => ({ authorizeUzuProManager }));

const { manualLinkPlayerLineUser, manualUnlinkPlayerLineUser } = vi.hoisted(() => ({
  manualLinkPlayerLineUser: vi.fn(),
  manualUnlinkPlayerLineUser: vi.fn(),
}));
vi.mock("@/lib/uzupro/line-link", () => ({ manualLinkPlayerLineUser, manualUnlinkPlayerLineUser }));

const { recordUzuProActivity } = vi.hoisted(() => ({
  recordUzuProActivity: vi.fn((): Promise<void> => Promise.resolve()),
}));
vi.mock("@/lib/uzupro/activity", () => ({ recordUzuProActivity }));

import { POST, DELETE } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/players/[playerId]/line/manual/route";

const OA = "oa1";
const WORK = "w1";
const PLAYER = "p-internal-1";
const UID = "U0123456789abcdef0123456789abcdef"; // U + 32 hex
const ctx = { params: { id: OA, workId: WORK, playerId: PLAYER } } as never;

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/line/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
const del = (body: unknown) =>
  DELETE(
    new NextRequest(`http://localhost/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/line/manual`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );

const authOk = () => authorizeUzuProManager.mockResolvedValue({ ok: true, user: { id: "manager-1" }, via: "liff_manager" });

function assertNoUidLeak(json: unknown) {
  expect(JSON.stringify(json)).not.toContain(UID);
  expect(JSON.stringify(recordUzuProActivity.mock.calls)).not.toContain(UID);
}

type ActCall = [unknown, { action?: string; detail?: { reason?: string; method?: string; outcome?: string } }];
const findAct = (action: string): ActCall | undefined =>
  (recordUzuProActivity.mock.calls as unknown as ActCall[]).find((c) => c[1]?.action === action);

beforeEach(() => vi.clearAllMocks());

describe("POST manual link — 認可", () => {
  it("authorizeUzuProManager fail → その応答（404）、service を呼ばない", async () => {
    authorizeUzuProManager.mockResolvedValue({ ok: false, response: NextResponse.json({ success: false }, { status: 404 }) });
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" });
    expect(res.status).toBe(404);
    expect(manualLinkPlayerLineUser).not.toHaveBeenCalled();
  });
});

describe("POST manual link — バリデーション", () => {
  beforeEach(authOk);

  it("確認用 UID 不一致 → 400、登録しない", async () => {
    const res = await post({ lineUserId: UID, lineUserIdConfirm: "U0000000000000000000000000000ffff", reason: "r" });
    expect(res.status).toBe(400);
    expect(manualLinkPlayerLineUser).not.toHaveBeenCalled();
  });
  it("理由なし → 400", async () => {
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "   " });
    expect(res.status).toBe(400);
    expect(manualLinkPlayerLineUser).not.toHaveBeenCalled();
  });
  it("想定外キー → 400（strict）", async () => {
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r", playerId: "px" });
    expect(res.status).toBe(400);
    expect(manualLinkPlayerLineUser).not.toHaveBeenCalled();
  });
  it("不正形式（U 無し/桁不足）→ 400", async () => {
    for (const bad of ["12345", "Uxyz", "U0123", "0123456789abcdef0123456789abcdef"]) {
      vi.clearAllMocks(); authOk();
      const res = await post({ lineUserId: bad, lineUserIdConfirm: bad, reason: "r" });
      expect(res.status).toBe(400);
      expect(manualLinkPlayerLineUser).not.toHaveBeenCalled();
    }
  });
});

describe("POST manual link — 結果マッピング", () => {
  beforeEach(authOk);

  it("linked → 200 linked、監査に手動登録＋理由・マスク UID（フル UID 非漏洩）", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "linked" });
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "LIFF不可のため代理" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("linked");
    // service へは解決済みの値のみ（client 申告の workId/bookingId ではなく params 由来）。
    expect(manualLinkPlayerLineUser.mock.calls[0][0]).toMatchObject({ oaId: OA, workId: WORK, playerId: PLAYER, lineUserId: UID });
    const act = findAct("line_manual_link_succeeded");
    expect(act).toBeTruthy();
    expect(act?.[1]?.detail?.reason).toBe("LIFF不可のため代理");
    expect(act?.[1]?.detail?.method).toBe("manual");
    assertNoUidLeak(json);
  });

  it("already_linked_same → 200 already_linked", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "already_linked_same" });
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("already_linked");
    assertNoUidLeak(json);
  });

  it("conflict_other_account → 409", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "conflict_other_account" });
    expect((await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" })).status).toBe(409);
  });
  it("conflict_booking_duplicate → 409", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "conflict_booking_duplicate" });
    expect((await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" })).status).toBe(409);
  });
  it("work_disabled → 409（拒否・保存しない）", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "work_disabled" });
    const res = await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" });
    expect(res.status).toBe(409);
  });
  it("player_not_found → 404", async () => {
    manualLinkPlayerLineUser.mockResolvedValue({ kind: "player_not_found" });
    expect((await post({ lineUserId: UID, lineUserIdConfirm: UID, reason: "r" })).status).toBe(404);
  });
});

describe("DELETE manual unlink", () => {
  beforeEach(authOk);

  it("理由なし → 400、解除しない", async () => {
    const res = await del({ reason: "" });
    expect(res.status).toBe(400);
    expect(manualUnlinkPlayerLineUser).not.toHaveBeenCalled();
  });
  it("unlinked → 200、監査に line_manual_unlinked＋理由", async () => {
    manualUnlinkPlayerLineUser.mockResolvedValue({ kind: "unlinked" });
    const res = await del({ reason: "誤登録訂正" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("unlinked");
    const act = findAct("line_manual_unlinked");
    expect(act?.[1]?.detail?.reason).toBe("誤登録訂正");
  });
  it("already_unlinked → 200（冪等）", async () => {
    manualUnlinkPlayerLineUser.mockResolvedValue({ kind: "already_unlinked" });
    const res = await del({ reason: "r" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("already_unlinked");
  });
  it("player_not_found → 404", async () => {
    manualUnlinkPlayerLineUser.mockResolvedValue({ kind: "player_not_found" });
    expect((await del({ reason: "r" })).status).toBe(404);
  });
  it("認可 fail → 404、service 呼ばない", async () => {
    authorizeUzuProManager.mockResolvedValue({ ok: false, response: NextResponse.json({ success: false }, { status: 404 }) });
    const res = await del({ reason: "r" });
    expect(res.status).toBe(404);
    expect(manualUnlinkPlayerLineUser).not.toHaveBeenCalled();
  });
});
