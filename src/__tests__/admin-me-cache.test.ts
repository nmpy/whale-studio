/**
 * src/__tests__/admin-me-cache.test.ts
 * PR-AUTH1/AUTH2: /api/admin/me が per-user/auth 応答として非キャッシュ化され、
 * is_platform_owner を反映すること（route）＋ レスポンス→boolean 導出が false も反映すること（hook helper）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { platformOwnerFromResponseBody } from "@/hooks/platform-owner";

// withAuth を素通しモック（user.id 固定）。isPlatformOwner はテストごとに差し替え。
const isOwnerMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  withAuth:
    <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) =>
      handler(req, ctx, { id: "user-1" }),
}));
vi.mock("@/lib/platform-admin", () => ({ isPlatformOwner: (id: string) => isOwnerMock(id) }));

import { GET } from "@/app/api/admin/me/route";

const call = () => (GET as unknown as (req: Request, ctx: { params: unknown }) => Promise<Response>)(
  new Request("https://x/api/admin/me"),
  { params: {} },
);

describe("GET /api/admin/me — 非キャッシュ + per-user 反映 (PR-AUTH1)", () => {
  afterEach(() => vi.clearAllMocks());

  it("Cache-Control: private, no-store … を返す（共有/ブラウザキャッシュ不可）", async () => {
    isOwnerMock.mockReturnValue(true);
    const res = await call();
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("no-store");
    expect(cc).toContain("must-revalidate");
    expect(res.headers.get("Vary") ?? "").toMatch(/Cookie/i);
  });

  it("platform owner=true を反映", async () => {
    isOwnerMock.mockReturnValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ is_platform_owner: true });
  });

  it("platform owner=false を反映（判定ソースは PLATFORM_ADMIN_USER_IDS のまま不変）", async () => {
    isOwnerMock.mockReturnValue(false);
    const res = await call();
    expect((await res.json()).data).toEqual({ is_platform_owner: false });
    // 判定は user.id を渡して isPlatformOwner に委譲（権限ロジックは変更しない）。
    expect(isOwnerMock).toHaveBeenCalledWith("user-1");
  });
});

describe("platformOwnerFromResponseBody — true/false/失敗を確定反映 (PR-AUTH2)", () => {
  it("is_platform_owner=true → true", () => {
    expect(platformOwnerFromResponseBody({ data: { is_platform_owner: true } })).toBe(true);
  });
  it("is_platform_owner=false → false（true だけでなく false も反映）", () => {
    expect(platformOwnerFromResponseBody({ data: { is_platform_owner: false } })).toBe(false);
  });
  it("body=null（!ok / fetch失敗相当）→ false に確定", () => {
    expect(platformOwnerFromResponseBody(null)).toBe(false);
    expect(platformOwnerFromResponseBody(undefined)).toBe(false);
  });
  it("data 欠落 / フィールド欠落 → false", () => {
    expect(platformOwnerFromResponseBody({})).toBe(false);
    expect(platformOwnerFromResponseBody({ data: {} })).toBe(false);
  });
});
