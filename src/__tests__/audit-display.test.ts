/**
 * src/__tests__/audit-display.test.ts
 * 操作ログ表示ヘルパー: 操作者名の解決 + resource の日本語ラベル。
 */
import { describe, it, expect } from "vitest";
import { resolveAuditActorName, auditResourceLabel } from "@/lib/audit-display";

describe("resolveAuditActorName — 操作者名の優先順位", () => {
  it("username を最優先で返す", () => {
    expect(resolveAuditActorName({ username: "tanaka", firstName: "太郎", lastName: "田中" })).toBe("tanaka");
  });
  it("username が空なら 姓 名 を返す", () => {
    expect(resolveAuditActorName({ username: "  ", firstName: "太郎", lastName: "田中" })).toBe("田中 太郎");
  });
  it("姓のみ / 名のみでも返す", () => {
    expect(resolveAuditActorName({ username: "", lastName: "田中" })).toBe("田中");
    expect(resolveAuditActorName({ username: "", firstName: "太郎" })).toBe("太郎");
  });
  it("profile が無い古いログは「不明」（UUID は出さない）", () => {
    expect(resolveAuditActorName(null)).toBe("不明");
    expect(resolveAuditActorName(undefined)).toBe("不明");
  });
  it("username も姓名も無い → 「不明」", () => {
    expect(resolveAuditActorName({ username: "", firstName: null, lastName: null })).toBe("不明");
  });
});

describe("auditResourceLabel — 対象（機能）の日本語表示", () => {
  it("既知キーを日本語化", () => {
    expect(auditResourceLabel("announcement")).toBe("お知らせ管理");
    expect(auditResourceLabel("personal_plan")).toBe("プラン権限");
    expect(auditResourceLabel("plan_permission")).toBe("プラン権限");
    expect(auditResourceLabel("business_invite")).toBe("招待URL発行");
    expect(auditResourceLabel("oa_review")).toBe("OA連携審査");
    expect(auditResourceLabel("audit")).toBe("操作ログ");
  });
  it("未定義キーは元の値をそのまま返す（壊さない）", () => {
    expect(auditResourceLabel("future_unknown_key")).toBe("future_unknown_key");
  });
  it("null/空は「—」", () => {
    expect(auditResourceLabel(null)).toBe("—");
    expect(auditResourceLabel("")).toBe("—");
  });
});
