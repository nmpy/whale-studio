// src/__tests__/business-invite.test.ts
// 法人招待リンク (Phase2) の純ロジック: token hash / state machine / 有効期限 /
// 入力バリデーション (role は admin|editor|viewer のみ) / 表示ラベル。
import { describe, it, expect } from "vitest";
import {
  hashBusinessInviteToken,
  generateBusinessInviteToken,
  resolveExpiresAt,
  DEFAULT_EXPIRES_IN_DAYS,
  businessInviteState,
  issueBusinessInviteSchema,
  applyBusinessInviteSchema,
  reviewBusinessApplicationSchema,
  BUSINESS_APP_STATUS_LABELS,
  planTierLabel,
  roleLabel,
  usageTypeLabel,
} from "@/lib/business-invite";

describe("token hash", () => {
  it("sha256 hex(64char) を返し、同一 token は同一 hash", () => {
    const t = "sample-token-abc";
    const h = hashBusinessInviteToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBusinessInviteToken(t)).toBe(h);
  });

  it("異なる token は異なる hash", () => {
    expect(hashBusinessInviteToken("a")).not.toBe(hashBusinessInviteToken("b"));
  });

  it("生成 token は十分な長さ (base64url 43 char) を持つ", () => {
    expect(generateBusinessInviteToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe("resolveExpiresAt", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("未指定 (既定 30 日) は 30 日後", () => {
    const d = resolveExpiresAt(DEFAULT_EXPIRES_IN_DAYS, now);
    expect(d?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("null は無期限 (= null)", () => {
    expect(resolveExpiresAt(null, now)).toBeNull();
  });

  it("0 以下も無期限扱い", () => {
    expect(resolveExpiresAt(0, now)).toBeNull();
    expect(resolveExpiresAt(-5, now)).toBeNull();
  });

  it("正の日数はその日数後", () => {
    expect(resolveExpiresAt(7, now)?.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
});

describe("businessInviteState", () => {
  const now = new Date("2026-06-10T00:00:00.000Z");
  const base = { expiresAt: null, usedAt: null, revokedAt: null };

  it("null link は none", () => {
    expect(businessInviteState(null, now)).toBe("none");
  });

  it("無期限・未使用・未失効は active", () => {
    expect(businessInviteState(base, now)).toBe("active");
  });

  it("期限内 (expiresAt 未来) は active", () => {
    expect(businessInviteState({ ...base, expiresAt: new Date("2026-06-20T00:00:00Z") }, now)).toBe("active");
  });

  it("revoked が最優先", () => {
    expect(businessInviteState({ ...base, revokedAt: now, usedAt: now }, now)).toBe("revoked");
  });

  it("used は expired より優先 (revoked なし)", () => {
    expect(businessInviteState({ ...base, usedAt: now, expiresAt: new Date("2020-01-01T00:00:00Z") }, now)).toBe("used");
  });

  it("期限切れ (expiresAt 過去) は expired", () => {
    expect(businessInviteState({ ...base, expiresAt: new Date("2026-06-09T23:59:59Z") }, now)).toBe("expired");
  });
});

describe("issueBusinessInviteSchema", () => {
  it("admin/editor/viewer は許可", () => {
    for (const role of ["admin", "editor", "viewer"]) {
      const r = issueBusinessInviteSchema.safeParse({ planTier: "pro", role });
      expect(r.success).toBe(true);
    }
  });

  it("owner / tester は弾く", () => {
    for (const role of ["owner", "tester"]) {
      expect(issueBusinessInviteSchema.safeParse({ planTier: "pro", role }).success).toBe(false);
    }
  });

  it("delegated を含む全プランティアを許可", () => {
    for (const planTier of ["basic", "standard", "plus", "pro", "delegated"]) {
      expect(issueBusinessInviteSchema.safeParse({ planTier, role: "editor" }).success).toBe(true);
    }
  });

  it("未知の planTier は弾く", () => {
    expect(issueBusinessInviteSchema.safeParse({ planTier: "enterprise", role: "editor" }).success).toBe(false);
  });

  it("usageType は既定 business", () => {
    const r = issueBusinessInviteSchema.parse({ planTier: "pro", role: "editor" });
    expect(r.usageType).toBe("business");
  });
});

describe("applyBusinessInviteSchema", () => {
  const valid = {
    token: "tok", companyName: "株式会社X", contactName: "山田", contactEmail: "a@example.com",
  };

  it("必須項目が揃えば成功 (LINE OA / message は任意)", () => {
    expect(applyBusinessInviteSchema.safeParse(valid).success).toBe(true);
    expect(applyBusinessInviteSchema.safeParse({ ...valid, lineOfficialAccountName: "@x", message: "よろしく" }).success).toBe(true);
  });

  it("メール形式不正は弾く", () => {
    expect(applyBusinessInviteSchema.safeParse({ ...valid, contactEmail: "not-email" }).success).toBe(false);
  });

  it("会社名・氏名の空は弾く", () => {
    expect(applyBusinessInviteSchema.safeParse({ ...valid, companyName: "" }).success).toBe(false);
    expect(applyBusinessInviteSchema.safeParse({ ...valid, contactName: "  " }).success).toBe(false);
  });
});

describe("reviewBusinessApplicationSchema", () => {
  it("approved / rejected のみ許可、reviewNote は任意", () => {
    expect(reviewBusinessApplicationSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(reviewBusinessApplicationSchema.safeParse({ status: "rejected", reviewNote: "ng" }).success).toBe(true);
  });

  it("pending / 未知ステータスは弾く", () => {
    expect(reviewBusinessApplicationSchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(reviewBusinessApplicationSchema.safeParse({ status: "approve" }).success).toBe(false);
    expect(reviewBusinessApplicationSchema.safeParse({}).success).toBe(false);
  });
});

describe("BUSINESS_APP_STATUS_LABELS", () => {
  it("pending=未対応 / approved=承認済み / rejected=却下", () => {
    expect(BUSINESS_APP_STATUS_LABELS.pending).toBe("未対応");
    expect(BUSINESS_APP_STATUS_LABELS.approved).toBe("承認済み");
    expect(BUSINESS_APP_STATUS_LABELS.rejected).toBe("却下");
  });
});

describe("表示ラベル", () => {
  it("planTierLabel は PLAN_LABELS に一致 (delegated=委託プラン)", () => {
    expect(planTierLabel("pro")).toBe("Pro Max");
    expect(planTierLabel("plus")).toBe("Pro");
    expect(planTierLabel("delegated")).toBe("委託プラン");
    expect(planTierLabel("unknown")).toBe("unknown");
  });

  it("roleLabel は日本語表示", () => {
    expect(roleLabel("admin")).toBe("管理者");
    expect(roleLabel("editor")).toBe("編集者");
    expect(roleLabel("viewer")).toBe("閲覧者");
  });

  it("usageTypeLabel", () => {
    expect(usageTypeLabel("business")).toBe("法人利用");
    expect(usageTypeLabel("personal")).toBe("個人利用");
  });
});
