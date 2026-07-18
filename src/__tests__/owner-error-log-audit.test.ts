// src/__tests__/owner-error-log-audit.test.ts
// エラーログ監査記録（writeErrorLogAudit）のテスト。
//   - resolve/reopen/bulk で AdminAuditLog.create が正しい payload で await されること。
//   - create 失敗でも throw しない（本処理を止めない）が、握りつぶさず console.error に残すこと。
//   - 失敗ログに秘密情報・生 sourceId・actorId・oaId を出さないこと。
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { adminAuditLog: { create: mockCreate } } }));

import { writeErrorLogAudit } from "@/lib/owner-error-log/audit";

const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: "audit1" });
});
afterAll(() => errSpy.mockRestore());

describe("writeErrorLogAudit — resolve / reopen / bulk の payload", () => {
  it("resolve: action=update・resource=error_log・resourceId=source:sourceId・detail.op=resolve", async () => {
    await writeErrorLogAudit({ actorId: "u1", operation: "resolve", source: "beacon_event", sourceId: "b1", detail: { oaId: "oa1" } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.action).toBe("update");
    expect(data.resource).toBe("error_log");
    expect(data.resourceId).toBe("beacon_event:b1");
    expect(data.actorId).toBe("u1");
    const detail = JSON.parse(data.detail);
    expect(detail).toMatchObject({ op: "resolve", source: "beacon_event", oaId: "oa1" });
  });

  it("reopen: action=delete・detail.op=reopen（resolve と区別される）", async () => {
    await writeErrorLogAudit({ actorId: "u1", operation: "reopen", source: "scheduled_line_message", sourceId: "s9", detail: { oaId: "oa2" } });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.action).toBe("delete");
    expect(data.resourceId).toBe("scheduled_line_message:s9");
    expect(JSON.parse(data.detail).op).toBe("reopen");
  });

  it("bulk_resolve: resourceId=bulk・detail に件数集計", async () => {
    await writeErrorLogAudit({ actorId: "u1", operation: "bulk_resolve", detail: { requested: 5, resolved: 4, skipped: 1, oaIds: ["oa1", "oa2"] } });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.action).toBe("update");
    expect(data.resourceId).toBe("bulk");
    expect(JSON.parse(data.detail)).toMatchObject({ op: "bulk_resolve", requested: 5, resolved: 4, skipped: 1 });
  });

  it("detail は JSON.parse 可能な文字列（Date/undefined 等を直接入れない）", async () => {
    await writeErrorLogAudit({ actorId: "u1", operation: "resolve", source: "checkin_attempt", sourceId: "c1", detail: { oaId: "oa3" } });
    const data = mockCreate.mock.calls[0][0].data;
    expect(typeof data.detail).toBe("string");
    expect(() => JSON.parse(data.detail)).not.toThrow();
  });
});

describe("writeErrorLogAudit — 失敗時のレジリエンスと可観測性", () => {
  it("create 失敗でも throw しない（本処理を止めない）", async () => {
    mockCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(
      writeErrorLogAudit({ actorId: "u1", operation: "resolve", source: "beacon_event", sourceId: "b1", detail: { oaId: "oa1" } })
    ).resolves.toBeUndefined();
  });

  it("create 失敗を握りつぶさず console.error に残す", async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P2010", name: "PrismaClientKnownRequestError" }));
    await writeErrorLogAudit({ actorId: "u1", operation: "reopen", source: "beacon_event", sourceId: "b1", detail: { oaId: "oa1" } });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [msg, ctx] = errSpy.mock.calls[0];
    expect(String(msg)).toContain("error-log audit");
    expect(ctx).toMatchObject({ operation: "reopen", resource: "error_log", action: "delete", code: "P2010" });
  });

  it("失敗ログに actorId / 生 sourceId / oaId / secret を出さない", async () => {
    mockCreate.mockRejectedValueOnce(new Error("fail"));
    await writeErrorLogAudit({ actorId: "SECRET_ACTOR", operation: "resolve", source: "beacon_event", sourceId: "RAW_SOURCE_ID", detail: { oaId: "RAW_OA_ID" } });
    const logged = JSON.stringify(errSpy.mock.calls[0]);
    expect(logged).not.toContain("SECRET_ACTOR");
    expect(logged).not.toContain("RAW_SOURCE_ID");
    expect(logged).not.toContain("RAW_OA_ID");
  });
});
