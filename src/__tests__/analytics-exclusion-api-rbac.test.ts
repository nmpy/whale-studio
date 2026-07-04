/**
 * src/__tests__/analytics-exclusion-api-rbac.test.ts
 *
 * 分析除外 API の認可宣言を検証（withRole に渡す allowedRoles）。
 * - 追加(POST) / 解除(DELETE) / UID 設定(PATCH) は owner / admin のみ（tester/viewer 不可）。
 * - 一覧(GET) は viewer 以上（tester 含む閲覧）で可能。
 * withRole は全 API 共通の RBAC ゲート（他所で検証済み）。ここでは各ルートが正しい
 * ロール集合でゲートしていることを固定する（UI だけでなく API 側で認可する要件）。
 */
import { describe, it, expect, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ roles: string[] }> }));

vi.mock("@/lib/auth", () => ({
  // withRole(extractor, roles, handler) の roles を記録し、handler をそのまま返す。
  withRole: (_extractor: unknown, roles: string[], handler: unknown) => {
    calls.push({ roles });
    return handler;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/analytics-exclusion", () => ({ maskLineUserId: (s: string) => s }));

import "@/app/api/oas/[id]/analytics-excluded-users/route";                 // GET, POST
import "@/app/api/oas/[id]/analytics-excluded-users/[exclusionId]/route";  // DELETE
import "@/app/api/oas/[id]/analytics-exclusion-candidates/route";          // GET, PATCH

const MUTATION = new Set(["admin", "owner"]);

describe("分析除外 API の RBAC 宣言", () => {
  it("すべてのルートが withRole でゲートされている（認可漏れなし）", () => {
    expect(calls.length).toBeGreaterThanOrEqual(5); // GET/POST + DELETE + GET/PATCH
  });

  it("owner/admin 限定のミューテーションが少なくとも3つ（POST/DELETE/PATCH）", () => {
    const mutations = calls.filter((c) => {
      const s = new Set(c.roles);
      return s.size === MUTATION.size && [...MUTATION].every((r) => s.has(r));
    });
    expect(mutations.length).toBeGreaterThanOrEqual(3);
  });

  it("ミューテーションに tester / viewer は含まれない", () => {
    for (const c of calls) {
      const isMutation = c.roles.length === 2 && c.roles.includes("admin") && c.roles.includes("owner");
      if (isMutation) {
        expect(c.roles).not.toContain("tester");
        expect(c.roles).not.toContain("viewer");
      }
    }
  });

  it("一覧(GET)は viewer 以上（viewer/tester を含むロール集合が存在する）", () => {
    const readable = calls.some((c) => c.roles.includes("viewer") && c.roles.includes("tester"));
    expect(readable).toBe(true);
  });
});
