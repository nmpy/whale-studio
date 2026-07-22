// src/__tests__/uzupro-liff.test.ts
// for ウズプロ プレイヤー LIFF 発行ルート（個別 / 再発行 / 一括）の挙動検証:
//   (a) 個別発行は url を返し issueLiffForPlayer を reissue:false で呼ぶ
//   (b) UZU_PRO access なし（authorizeUzuPro fail 404）→ 404 で発行しない
//   (c) 別作品/別 OA のプレイヤー（findFirst=null）→ 404
//   (d) キャンセル済みプレイヤー（skipped_cancelled）→ 409
//   (e) 一括は「active かつ未発行」のみ対象（where 検証）+ 集計を返す
//   (f) 再発行は reissue:true で呼ぶ
// authorizeUzuPro / issueLiffForPlayer / liff config / activity / prisma は mock。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mp } = vi.hoisted(() => ({
  mp: {
    uzuProPlayer: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    oa: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

const { authorizeUzuPro } = vi.hoisted(() => ({ authorizeUzuPro: vi.fn() }));
vi.mock("@/lib/uzupro-auth", () => ({ authorizeUzuPro }));

const { issueLiffForPlayer } = vi.hoisted(() => ({
  issueLiffForPlayer: vi.fn((_tx?: unknown, _args?: unknown): unknown => undefined),
}));
vi.mock("@/lib/uzupro/liff", () => ({ issueLiffForPlayer }));

const { getLiffIdForUrlGeneration } = vi.hoisted(() => ({
  getLiffIdForUrlGeneration: vi.fn((_oa?: unknown): string | null => "liff-123"),
}));
vi.mock("@/lib/liff/config", () => ({ getLiffIdForUrlGeneration }));

const { recordUzuProActivity } = vi.hoisted(() => ({
  recordUzuProActivity: vi.fn((_db?: unknown, _args?: unknown): Promise<void> => Promise.resolve()),
}));
vi.mock("@/lib/uzupro/activity", () => ({ recordUzuProActivity }));

import { POST as individualPost } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/players/[playerId]/liff/route";
import { POST as reissuePost } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/players/[playerId]/liff/reissue/route";
import { POST as bulkPost } from "@/app/api/oas/[id]/works/[workId]/uzu-pro/players/liff/bulk/route";

const OA = "oa1";
const WORK = "w1";
const PLAYER = "p1";

const req = (path: string) => new NextRequest(`http://localhost${path}`, { method: "POST" });
const indCtx = { params: { id: OA, workId: WORK, playerId: PLAYER } } as never;
const bulkCtx = { params: { id: OA, workId: WORK } } as never;

const authOk = () => authorizeUzuPro.mockResolvedValue({ ok: true, user: { id: "actor1" }, via: "platform_admin" });
const playerActive = () =>
  mp.uzuProPlayer.findFirst.mockResolvedValue({ id: PLAYER, status: "active", booking: { liveSession: { startsAt: null } } });

beforeEach(() => {
  vi.clearAllMocks();
  getLiffIdForUrlGeneration.mockReturnValue("liff-123");
  mp.oa.findUnique.mockResolvedValue({ liffId: "liff-123" });
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
});

describe("個別 LIFF 発行", () => {
  it("(a) 発行成功で url を返し issueLiffForPlayer を reissue:false で呼ぶ", async () => {
    authOk();
    playerActive();
    issueLiffForPlayer.mockResolvedValue({ kind: "issued", url: "https://liff.line.me/liff-123?t=tok", linkId: "l1" });
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ status: "issued", url: "https://liff.line.me/liff-123?t=tok" });
    expect(issueLiffForPlayer).toHaveBeenCalledTimes(1);
    expect(issueLiffForPlayer.mock.calls[0][1]).toMatchObject({ oaId: OA, playerId: PLAYER, liffId: "liff-123", reissue: false });
    expect(recordUzuProActivity.mock.calls[0][1]).toMatchObject({ action: "liff_issue" });
  });

  it("既発行（already_issued）は url を返さない", async () => {
    authOk();
    playerActive();
    issueLiffForPlayer.mockResolvedValue({ kind: "already_issued", linkId: "l1" });
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ status: "already_issued" });
    expect(json.data.url).toBeUndefined();
  });

  it("(b) UZU_PRO access なし → 404 で発行しない", async () => {
    authorizeUzuPro.mockResolvedValue({ ok: false, response: NextResponse.json({ success: false }, { status: 404 }) });
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    expect(res.status).toBe(404);
    expect(mp.uzuProPlayer.findFirst).not.toHaveBeenCalled();
    expect(issueLiffForPlayer).not.toHaveBeenCalled();
  });

  it("(c) 別作品/別 OA のプレイヤー（findFirst=null）→ 404、where に oaId+booking.workId", async () => {
    authOk();
    mp.uzuProPlayer.findFirst.mockResolvedValue(null);
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    expect(res.status).toBe(404);
    expect(issueLiffForPlayer).not.toHaveBeenCalled();
    expect(mp.uzuProPlayer.findFirst.mock.calls[0][0].where).toMatchObject({
      id: PLAYER, oaId: OA, booking: { workId: WORK },
    });
  });

  it("(d) キャンセル済み（skipped_cancelled）→ 409", async () => {
    authOk();
    playerActive();
    issueLiffForPlayer.mockResolvedValue({ kind: "skipped_cancelled" });
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    expect(res.status).toBe(409);
  });

  it("LIFF 未設定 → 422 LIFF_NOT_CONFIGURED", async () => {
    authOk();
    playerActive();
    getLiffIdForUrlGeneration.mockReturnValue(null);
    const res = await individualPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff`), indCtx);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("LIFF_NOT_CONFIGURED");
    expect(issueLiffForPlayer).not.toHaveBeenCalled();
  });
});

describe("LIFF 再発行", () => {
  it("(f) reissue:true で呼び、liff_reissue を記録し新 url を返す", async () => {
    authOk();
    playerActive();
    issueLiffForPlayer.mockResolvedValue({ kind: "issued", url: "https://liff.line.me/liff-123?t=new", linkId: "l2" });
    const res = await reissuePost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/${PLAYER}/liff/reissue`), indCtx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ status: "issued", url: "https://liff.line.me/liff-123?t=new" });
    expect(issueLiffForPlayer.mock.calls[0][1]).toMatchObject({ reissue: true });
    expect(recordUzuProActivity.mock.calls[0][1]).toMatchObject({ action: "liff_reissue" });
  });
});

describe("LIFF 一括発行", () => {
  it("(e) active かつ未発行のみ対象（where 検証）+ 集計を返す", async () => {
    authOk();
    mp.uzuProPlayer.findMany.mockResolvedValue([
      { id: "pa", booking: { liveSession: { startsAt: null } } },
      { id: "pb", booking: { liveSession: { startsAt: null } } },
    ]);
    mp.uzuProPlayer.count
      .mockResolvedValueOnce(1) // cancelled
      .mockResolvedValueOnce(3); // already issued
    issueLiffForPlayer
      .mockResolvedValueOnce({ kind: "issued", url: "u1", linkId: "l1" })
      .mockResolvedValueOnce({ kind: "issued", url: "u2", linkId: "l2" });

    const res = await bulkPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/liff/bulk`), bulkCtx);
    const json = await res.json();
    expect(res.status).toBe(200);

    // 対象抽出 where: active + 当該 OA/work + issued リンク無し
    const where = mp.uzuProPlayer.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      oaId: OA, status: "active", booking: { workId: WORK }, liffLinks: { none: { status: "issued" } },
    });

    // 集計（URL は返さない）
    expect(json.data).toMatchObject({ generated: 2, alreadyIssued: 3, excluded: 1, failed: 0, failures: [] });
    expect(JSON.stringify(json.data)).not.toContain("liff.line.me");
    expect(issueLiffForPlayer).toHaveBeenCalledTimes(2);
    expect(issueLiffForPlayer.mock.calls[0][1]).toMatchObject({ reissue: false });
    expect(recordUzuProActivity.mock.calls[0][1]).toMatchObject({ action: "liff_bulk_issue" });
  });

  it("発行中の例外は failed に計上され全体を止めない（PII フリー reason）", async () => {
    authOk();
    mp.uzuProPlayer.findMany.mockResolvedValue([
      { id: "pa", booking: { liveSession: { startsAt: null } } },
      { id: "pb", booking: { liveSession: { startsAt: null } } },
    ]);
    mp.uzuProPlayer.count.mockResolvedValue(0);
    issueLiffForPlayer
      .mockResolvedValueOnce({ kind: "issued", url: "u1", linkId: "l1" })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await bulkPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/liff/bulk`), bulkCtx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.generated).toBe(1);
    expect(json.data.failed).toBe(1);
    expect(json.data.failures[0]).toEqual({ playerId: "pb", reason: "error" });
  });

  it("UZU_PRO access なし → 404 で findMany しない", async () => {
    authorizeUzuPro.mockResolvedValue({ ok: false, response: NextResponse.json({ success: false }, { status: 404 }) });
    const res = await bulkPost(req(`/api/oas/${OA}/works/${WORK}/uzu-pro/players/liff/bulk`), bulkCtx);
    expect(res.status).toBe(404);
    expect(mp.uzuProPlayer.findMany).not.toHaveBeenCalled();
  });
});
