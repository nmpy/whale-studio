// src/__tests__/rh-e2e/token-neg.e2e.ts
// Token capability 負テスト（§7）。business-invite validate/apply を実 route × docker PG で。
// expired/revoked/used/malformed/nonexistent/並行apply/replay/P2002/raw token 非漏洩 を確認。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/slack/business-application", () => ({ notifyBusinessApplicationSubmitted: vi.fn(async () => {}) }));

import { prisma } from "@/lib/prisma";
import { hashBusinessInviteToken } from "@/lib/business-invite";
import { POST as validatePOST } from "@/app/api/business-invite/validate/route";
import { POST as applyPOST } from "@/app/api/business-invite/apply/route";

const createdLinkIds: string[] = [];
const req = (body: unknown) => ({ json: async () => body, headers: new Headers(), method: "POST", url: "http://localhost/api" } as never);

async function makeLink(token: string, opts: { expiresAt?: Date | null; usedAt?: Date | null; revokedAt?: Date | null } = {}) {
  const link = await prisma.businessInviteLink.create({
    data: {
      tokenHash: hashBusinessInviteToken(token), usageType: "business", planTier: "standard", role: "editor",
      createdByUserId: "rh-test-user-0001", expiresAt: opts.expiresAt ?? null, usedAt: opts.usedAt ?? null, revokedAt: opts.revokedAt ?? null,
    },
  });
  createdLinkIds.push(link.id);
  return link;
}
const applyBody = (token: string) => ({ token, companyName: "SYNTH社", contactName: "テスト担当", contactEmail: "test@example.com", lineOfficialAccountName: "SYNTH-OA", message: "テスト" });

beforeAll(async () => {
  await prisma.profile.upsert({ where: { userId: "rh-test-user-0001" }, update: {}, create: { userId: "rh-test-user-0001", username: "rh" } });
  await makeLink("tok-active");
  await makeLink("tok-expired", { expiresAt: new Date("2020-01-01") });
  await makeLink("tok-used", { usedAt: new Date("2021-01-01") });
  await makeLink("tok-revoked", { revokedAt: new Date("2021-01-01") });
  await makeLink("tok-apply-ok");
  await makeLink("tok-apply-race");
});
afterAll(async () => {
  await prisma.businessInviteApplication.deleteMany({ where: { linkId: { in: createdLinkIds } } });
  await prisma.businessInviteLink.deleteMany({ where: { id: { in: createdLinkIds } } });
  await prisma.$disconnect();
});

describe("validate: state 判定", () => {
  it("active → valid", async () => { const b = await (await validatePOST(req({ token: "tok-active" }))).json(); expect(b.data?.state ?? b.state).toBe("active"); });
  it("expired → expired", async () => { const b = await (await validatePOST(req({ token: "tok-expired" }))).json(); expect(JSON.stringify(b)).toContain("expired"); });
  it("used → used", async () => { const b = await (await validatePOST(req({ token: "tok-used" }))).json(); expect(JSON.stringify(b)).toContain("used"); });
  it("revoked → revoked", async () => { const b = await (await validatePOST(req({ token: "tok-revoked" }))).json(); expect(JSON.stringify(b)).toContain("revoked"); });
  it("存在しない token → none（内部情報漏らさない）", async () => {
    const res = await validatePOST(req({ token: "tok-nonexistent-xyz" }));
    const raw = JSON.stringify(await res.json());
    expect(raw).toContain("none");
    expect(raw).not.toContain("tokenHash"); // hash も漏らさない
  });
  it("malformed（token 欠落）→ 400 or 安全処理（500 でない）", async () => {
    const res = await validatePOST(req({}));
    expect(res.status).not.toBe(500);
  });
  it("raw token を response に含めない", async () => {
    const raw = JSON.stringify(await (await validatePOST(req({ token: "tok-active" }))).json());
    expect(raw).not.toContain("tok-active");
  });
});

describe("apply: state 別 + replay + 並行", () => {
  it("expired/used/revoked → 410（再申請不可）", async () => {
    for (const t of ["tok-expired", "tok-used", "tok-revoked"]) {
      const res = await applyPOST(req(applyBody(t)));
      expect(res.status, t).toBe(410);
    }
  });
  it("active → 成功 + usedAt セット、replay（再apply）→ 410 used", async () => {
    const first = await applyPOST(req(applyBody("tok-apply-ok")));
    expect([200, 201]).toContain(first.status);
    const link = await prisma.businessInviteLink.findUnique({ where: { tokenHash: hashBusinessInviteToken("tok-apply-ok") } });
    expect(link?.usedAt).not.toBeNull(); // 消費された
    const replay = await applyPOST(req(applyBody("tok-apply-ok")));
    expect(replay.status).toBe(410); // 再利用不可
  });
  it("同一 active token の並行 apply → 1 件のみ成功（linkId@unique / usedAt ガードで二重防止）", async () => {
    const results = await Promise.allSettled([
      applyPOST(req(applyBody("tok-apply-race"))),
      applyPOST(req(applyBody("tok-apply-race"))),
      applyPOST(req(applyBody("tok-apply-race"))),
    ]);
    const statuses = await Promise.all(results.map(async (r) => r.status === "fulfilled" ? (r.value as Response).status : 0));
    const ok = statuses.filter((s) => s === 200 || s === 201).length;
    const apps = await prisma.businessInviteApplication.count({ where: { linkId: createdLinkIds[5] } });
    expect(ok).toBe(1);   // ちょうど1件だけ成功
    expect(apps).toBe(1); // application も1件のみ（二重作成なし）
  });
});
