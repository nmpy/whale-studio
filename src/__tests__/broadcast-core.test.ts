// src/__tests__/broadcast-core.test.ts
//
// 配信メッセージ（Broadcast）のコアロジック。
// 既存「応答メッセージ」には一切依存しない（import もしない）ことを含めて検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma / LINE を差し替える ─────────────────────────────────────
const { mockPrisma, mockPushToLine } = vi.hoisted(() => {
  const prisma = {
    work:                  { findMany: vi.fn(), findUnique: vi.fn() },
    userProgress:          { findMany: vi.fn() },
    userTracking:          { findMany: vi.fn() },
    analyticsExcludedUser: { findMany: vi.fn() },
    segment:               { findUnique: vi.fn() },
    broadcast:             { findFirst: vi.fn(), updateMany: vi.fn() },
    broadcastRecipient:    { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockPrisma: prisma, mockPushToLine: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/line", () => ({ pushToLine: (...a: unknown[]) => mockPushToLine(...a) }));

import {
  resolveBroadcastAudience,
  countBroadcastAudience,
  isSendableLineUserId,
} from "@/lib/broadcast/audience";
import { parseBroadcastContent, toLineMessages, BROADCAST_TEXT_MAX } from "@/lib/broadcast/content";
import { startBroadcast, retryFailedRecipients, toBroadcastTarget } from "@/lib/broadcast/service";
import { processBroadcastChunk, finalStatusOf } from "@/lib/broadcast/processor";

const U = (n: number) => "U" + String(n).padStart(32, "0");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.analyticsExcludedUser.findMany.mockResolvedValue([]);
  mockPrisma.userTracking.findMany.mockResolvedValue([]);
  mockPrisma.broadcastRecipient.createMany.mockResolvedValue({ count: 0 });
});

// ══════════════════════════════════════════════════════════════════
describe("isSendableLineUserId — テスト ID / 不正値を宛先にしない", () => {
  it("LINE の userId 形式だけを許可する", () => {
    expect(isSendableLineUserId(U(1))).toBe(true);
    expect(isSendableLineUserId(U(1).toUpperCase())).toBe(true);
  });
  it("テスト用の任意 ID・空・null・非文字列を弾く", () => {
    for (const v of ["test-user", "", "   ", "U123", null, undefined, 123, {}]) {
      expect(isSendableLineUserId(v)).toBe(false);
    }
  });
});

describe("resolveBroadcastAudience — 全体", () => {
  it("OA 配下の Work 経由でしか UserProgress を引かない（OA isolation）", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }]);

    await resolveBroadcastAudience("oa1", { type: "all" });

    expect(mockPrisma.work.findMany).toHaveBeenCalledWith({ where: { oaId: "oa1" }, select: { id: true } });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where.workId).toEqual({ in: ["w1", "w2"] });
    expect(where.isPreview).toBe(false); // プレビュー実行者に配信しない
    expect(mockPrisma.userTracking.findMany).toHaveBeenCalledWith({ where: { oaId: "oa1" }, select: { lineUserId: true } });
  });

  it("UserProgress と UserTracking を統合し、重複を除去する", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    mockPrisma.userTracking.findMany.mockResolvedValue([{ lineUserId: U(2) }, { lineUserId: U(3) }]);

    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1), U(2), U(3)]);
    expect(r.count).toBe(3);
  });

  it("テスト ID / 空 / null を除外する", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([
      { lineUserId: U(1) }, { lineUserId: "test-user" }, { lineUserId: "" }, { lineUserId: null },
    ]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1)]);
  });

  it("analytics_excluded_users は宛先から外す", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    mockPrisma.analyticsExcludedUser.findMany.mockResolvedValue([{ lineUserId: U(2) }]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1)]);
  });

  it("Work が 1 件も無い OA では UserProgress を引かない", async () => {
    mockPrisma.work.findMany.mockResolvedValue([]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
    expect(r.count).toBe(0);
  });
});

describe("resolveBroadcastAudience — セグメント", () => {
  const seg = (over: Record<string, unknown> = {}) =>
    ({ id: "s1", oaId: "oa1", filterType: "phase", phaseId: "p1", ...over });

  it("他 OA の Segment を指定しても解決しない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ oaId: "OTHER" }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
  });

  it("他 OA の Work を指定しても解決しない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg());
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "OTHER" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
  });

  it("phase セグメントは currentPhaseId で絞る", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg());
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }]);
    await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ workId: "w1", isPreview: false, currentPhaseId: "p1" });
  });

  it("phaseId 未設定の phase セグメントは「全員送信」に化けない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ phaseId: null }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
  });

  it("inactive_7d は未クリア かつ 7日以上未接触で絞る", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ filterType: "inactive_7d", phaseId: null }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mockPrisma.userProgress.findMany.mockResolvedValue([]);
    await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where.reachedEnding).toBe(false);
    expect(where.lastInteractedAt).toHaveProperty("lt");
  });

  it("countBroadcastAudience は件数だけ返す", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    expect(await countBroadcastAudience("oa1", { type: "all" })).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("parseBroadcastContent", () => {
  it("正しいテキストを受理する", () => {
    expect(parseBroadcastContent({ kind: "text", text: "こんにちは" })).toEqual({ kind: "text", text: "こんにちは" });
  });
  it("空・空白のみ・未知 kind・非文字列・上限超過を弾く", () => {
    expect(parseBroadcastContent({ kind: "text", text: "" })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "   " })).toBeNull();
    expect(parseBroadcastContent({ kind: "flex", text: "x" })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: 1 })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "a".repeat(BROADCAST_TEXT_MAX + 1) })).toBeNull();
    expect(parseBroadcastContent(null)).toBeNull();
    expect(parseBroadcastContent([])).toBeNull();
  });
  it("LINE message 形式に変換できる", () => {
    expect(toLineMessages({ kind: "text", text: "やあ" })).toEqual([{ type: "text", text: "やあ" }]);
  });
});

describe("toBroadcastTarget", () => {
  it("all / segment を復元し、欠損した segment 指定は null", () => {
    expect(toBroadcastTarget({ targetType: "all", segmentId: null, segmentWorkId: null })).toEqual({ type: "all" });
    expect(toBroadcastTarget({ targetType: "segment", segmentId: "s1", segmentWorkId: "w1" }))
      .toEqual({ type: "segment", segmentId: "s1", workId: "w1" });
    expect(toBroadcastTarget({ targetType: "segment", segmentId: "s1", segmentWorkId: null })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("startBroadcast — 二重配信防止", () => {
  const draft = { id: "b1", status: "draft", targetType: "all", segmentId: null, segmentWorkId: null };

  beforeEach(() => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
  });

  it("draft のときだけ開始し、宛先を snapshot する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(draft);
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });

    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: true, recipientCount: 2 });

    // CAS: where に status:"draft" が入っていること
    expect(mockPrisma.broadcast.updateMany.mock.calls[0][0].where)
      .toEqual({ id: "b1", oaId: "oa1", status: "draft" });
    // snapshot
    expect(mockPrisma.broadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [{ broadcastId: "b1", lineUserId: U(1) }, { broadcastId: "b1", lineUserId: U(2) }],
      skipDuplicates: true,
    });
  });

  it("既に sending なら何もしない（ダブルクリック / reload / retry）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...draft, status: "sending" });
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "already_started", status: "sending" });
    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("並行実行で CAS に負けたら snapshot も作らない", async () => {
    mockPrisma.broadcast.findFirst
      .mockResolvedValueOnce(draft)                      // 1 回目の読み取りでは draft
      .mockResolvedValueOnce({ status: "sending" });     // CAS 失敗後の再読み取り
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 0 }); // 他リクエストが先に確定

    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "already_started", status: "sending" });
    expect(mockPrisma.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("他 OA の配信は開始できない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(mockPrisma.broadcast.findFirst.mock.calls[0][0].where).toMatchObject({ oaId: "oa1" });
  });

  it("宛先 0 件なら開始しない（sending のまま止まる状態を作らない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(draft);
    mockPrisma.userProgress.findMany.mockResolvedValue([]);
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "empty_audience" });
    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("processBroadcastChunk", () => {
  const sending = {
    id: "b1", status: "sending",
    contentJson: { kind: "text", text: "やあ" },
    oa: { channelAccessToken: "tok" },
  };
  const counts = (sent: number, failed: number, pending: number) => {
    mockPrisma.broadcastRecipient.count
      .mockResolvedValueOnce(sent).mockResolvedValueOnce(failed).mockResolvedValueOnce(pending);
  };

  it("全件成功なら sent で完了する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: true, processed: 1, sent: 1, failed: 0, hasMore: false, status: "sent" });
    expect(mockPushToLine).toHaveBeenCalledWith(U(1), [{ type: "text", text: "やあ" }], "tok");
  });

  it("一部失敗は partial_failed。宛先ごとに結果を記録する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([
      { id: "r1", lineUserId: U(1) }, { id: "r2", lineUserId: U(2) },
    ]);
    mockPushToLine
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    counts(1, 1, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ sent: 1, failed: 1, status: "partial_failed" });
    const updates = mockPrisma.broadcastRecipient.update.mock.calls.map((c) => c[0].data.status);
    expect(updates).toEqual(["sent", "failed"]);
    // エラーメッセージに本文・PII を含めない
    const failedData = mockPrisma.broadcastRecipient.update.mock.calls[1][0].data;
    expect(failedData.errorMessage).toBe("LINE push failed (HTTP 400)");
    expect(JSON.stringify(failedData)).not.toContain("やあ");
  });

  it("全件失敗は failed", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: false, status: 500 });
    counts(0, 1, 0);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ status: "failed" });
  });

  it("ネットワークエラー（status なし）でも例外にせず failed として記録する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: false });
    counts(0, 1, 0);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ failed: 1, status: "failed" });
    expect(mockPrisma.broadcastRecipient.update.mock.calls[0][0].data.errorMessage).toBe("LINE push failed");
  });

  it("残りがあれば sending のまま hasMore=true（完了扱いにしない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 5);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ hasMore: true, status: "sending" });
    expect(mockPrisma.broadcast.updateMany.mock.calls[0][0].data.completedAt).toBeUndefined();
  });

  it("chunkSize 件だけ取り出す", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
    counts(0, 0, 0);
    await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1", chunkSize: 7 });
    expect(mockPrisma.broadcastRecipient.findMany.mock.calls[0][0]).toMatchObject({
      where: { broadcastId: "b1", status: "pending" }, take: 7,
    });
  });

  it("sending でない配信は処理しない（二重 process 防止）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, status: "sent" });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "not_sending" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("本文が壊れていたら 1 通も送らない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, contentJson: { kind: "text", text: "" } });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "invalid_content" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("channelAccessToken が無ければ送らない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, oa: { channelAccessToken: "" } });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "no_token" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("finalStatusOf の判定", () => {
    expect(finalStatusOf(3, 0)).toBe("sent");
    expect(finalStatusOf(0, 3)).toBe("failed");
    expect(finalStatusOf(2, 1)).toBe("partial_failed");
  });
});

// ══════════════════════════════════════════════════════════════════
describe("retryFailedRecipients — 失敗した宛先だけ再送", () => {
  it("failed だけを pending に戻す（sent には触れない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ id: "b1", status: "partial_failed" });
    mockPrisma.broadcastRecipient.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });

    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: true, requeued: 2 });
    expect(mockPrisma.broadcastRecipient.updateMany.mock.calls[0][0].where)
      .toEqual({ broadcastId: "b1", status: "failed" });
  });

  it("送信中の配信は再送できない（worker と競合させない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ id: "b1", status: "sending" });
    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: false, reason: "not_retryable" });
    expect(mockPrisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
  });

  it("他 OA の配信は再送できない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });
});
