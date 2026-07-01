/**
 * src/__tests__/studio-invite-ui.test.ts
 * 統合招待UI の純ロジック（個人/法人 × 招待内容・期限）の検証（モック不要）。
 */
import { describe, it, expect } from "vitest";
import {
  INVITE_ACTIONS_BY_SCOPE, INVITE_ACTION_LABELS, inviteActionRequiresRole, scopeUsageType,
  STUDIO_INVITE_EXPIRES_OPTIONS, studioInviteState, studioInviteLandingShowsAcceptForm, UNIFIED_INVITE_OPTIONS,
} from "@/lib/studio-invite-ui";
import { resolveStudioInviteExpiresAt } from "@/lib/studio-invite";

describe("studioInviteLandingShowsAcceptForm（受諾フォームは active のみ表示）", () => {
  it("active のときだけ受諾フォームを表示する", () => {
    expect(studioInviteLandingShowsAcceptForm("active")).toBe(true);
  });
  it("used_up（上限到達）ではフォームを表示しない", () => {
    expect(studioInviteLandingShowsAcceptForm("used_up")).toBe(false);
  });
  it("accepted / expired / revoked / none / suspended / 未知 でもフォームを表示しない", () => {
    for (const s of ["accepted", "expired", "revoked", "none", "suspended", "unknown_future", "", null, undefined]) {
      expect(studioInviteLandingShowsAcceptForm(s as string)).toBe(false);
    }
  });
});

describe("scope → usageType", () => {
  it("個人=personal / 法人=business", () => {
    expect(scopeUsageType("personal")).toBe("personal");
    expect(scopeUsageType("business")).toBe("business");
  });
});

describe("INVITE_ACTIONS_BY_SCOPE（既存OAへの招待のみ・OA作成/登録系は含めない）", () => {
  it("個人は member_invite のみ（register/OA作成系は含めない）", () => {
    expect(INVITE_ACTIONS_BY_SCOPE.personal).toEqual(["member_invite"]);
    expect(INVITE_ACTIONS_BY_SCOPE.personal).not.toContain("register_user");
    expect(INVITE_ACTIONS_BY_SCOPE.personal).not.toContain("register_and_member");
  });
  it("法人は corp_oa_link / corp_admin_invite のみ（corp_register系は含めない）", () => {
    expect(INVITE_ACTIONS_BY_SCOPE.business).toEqual(["corp_oa_link", "corp_admin_invite"]);
    expect(INVITE_ACTIONS_BY_SCOPE.business).not.toContain("corp_register");
    expect(INVITE_ACTIONS_BY_SCOPE.business).not.toContain("corp_register_admin_oa");
  });
});

describe("UNIFIED_INVITE_OPTIONS（UI表示）", () => {
  it("個人/法人それぞれ メンバー/管理者 の2択・既存値にマップ・OA作成/登録は出さない", () => {
    expect(UNIFIED_INVITE_OPTIONS.personal.map((o) => o.inviteAction)).toEqual(["member_invite", "member_invite"]);
    expect(UNIFIED_INVITE_OPTIONS.business.map((o) => o.inviteAction)).toEqual(["corp_oa_link", "corp_admin_invite"]);
    // 管理者オプションは role=admin を既定
    expect(UNIFIED_INVITE_OPTIONS.personal.find((o) => o.key === "personal_admin")?.defaultRole).toBe("admin");
    expect(UNIFIED_INVITE_OPTIONS.business.find((o) => o.key === "business_admin")?.defaultRole).toBe("admin");
    // ラベルに「作成」「登録」を含まない（既存OA向けと分かる）
    for (const o of [...UNIFIED_INVITE_OPTIONS.personal, ...UNIFIED_INVITE_OPTIONS.business]) {
      expect(o.label).not.toMatch(/作成|登録/);
      expect(o.label).toContain("既存");
    }
  });
  it("UI表示 inviteAction のラベルに「作成」「登録」を含まない", () => {
    for (const a of ["member_invite", "corp_oa_link", "corp_admin_invite"] as const) {
      expect(INVITE_ACTION_LABELS[a]).not.toMatch(/作成|登録/);
    }
  });
});

describe("inviteActionRequiresRole", () => {
  it("メンバー/管理者/OA紐づけ系は role 必須", () => {
    expect(inviteActionRequiresRole("member_invite")).toBe(true);
    expect(inviteActionRequiresRole("register_and_member")).toBe(true);
    expect(inviteActionRequiresRole("corp_oa_link")).toBe(true);
    expect(inviteActionRequiresRole("corp_admin_invite")).toBe(true);
  });
  it("単純登録/OA作成のみは role 任意", () => {
    expect(inviteActionRequiresRole("register_user")).toBe(false);
    expect(inviteActionRequiresRole("corp_register")).toBe(false);
  });
});

describe("有効期限", () => {
  it("プルダウン候補に 7/14/30 を含む", () => {
    expect(STUDIO_INVITE_EXPIRES_OPTIONS).toContain(7);
    expect(STUDIO_INVITE_EXPIRES_OPTIONS).toContain(30);
  });
  it("resolveStudioInviteExpiresAt: 日数指定で算出 / 省略は既定7日 / 範囲外はクランプ", () => {
    const now = new Date("2026-06-18T00:00:00Z");
    expect(resolveStudioInviteExpiresAt(now).toISOString()).toBe("2026-06-25T00:00:00.000Z"); // 既定7
    expect(resolveStudioInviteExpiresAt(now, 14).toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(resolveStudioInviteExpiresAt(now, 0).toISOString()).toBe("2026-06-19T00:00:00.000Z"); // 1にクランプ
    expect(resolveStudioInviteExpiresAt(now, 9999).toISOString()).toBe("2026-09-16T00:00:00.000Z"); // 90にクランプ
  });
});

describe("studioInviteState (再掲・client安全モジュール)", () => {
  const now = new Date("2026-06-18T15:00:00Z");
  const future = new Date("2026-12-31T00:00:00Z");
  it("複数回 上限到達は used_up / 部分使用は active", () => {
    expect(studioInviteState({ acceptedAt: now, revokedAt: null, expiresAt: future, maxUses: 5, usedCount: 5 }, now)).toBe("used_up");
    expect(studioInviteState({ acceptedAt: now, revokedAt: null, expiresAt: future, maxUses: 5, usedCount: 2 }, now)).toBe("active");
  });
});
