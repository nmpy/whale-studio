/**
 * src/__tests__/role-labels.test.ts
 *
 * ロールラベル定数が全ロールをカバーしていることを検証する。
 */

import { describe, it, expect } from "vitest";

// PermissionGuard の ROLE_LABELS / BADGE_STYLES は export されているので直接 import
// ただし React コンポーネントのため、定数だけテストする場合は permissions.ts の定義を使う
import { ROLE_LEVELS } from "@/lib/types/permissions";

const ALL_ROLES = Object.keys(ROLE_LEVELS);

describe("ROLE_LEVELS（ロール階層定義）", () => {
  it("5 つのロールが定義されている", () => {
    expect(ALL_ROLES).toHaveLength(5);
  });

  it("owner / admin / editor / tester / viewer を含む", () => {
    expect(ALL_ROLES).toContain("owner");
    expect(ALL_ROLES).toContain("admin");
    expect(ALL_ROLES).toContain("editor");
    expect(ALL_ROLES).toContain("tester");
    expect(ALL_ROLES).toContain("viewer");
  });

  it("owner が最高レベル", () => {
    const ownerLevel = ROLE_LEVELS.owner;
    for (const [role, level] of Object.entries(ROLE_LEVELS)) {
      if (role !== "owner") {
        expect(ownerLevel).toBeGreaterThan(level);
      }
    }
  });

  it("viewer が最低レベル", () => {
    const viewerLevel = ROLE_LEVELS.viewer;
    for (const [role, level] of Object.entries(ROLE_LEVELS)) {
      if (role !== "viewer") {
        expect(viewerLevel).toBeLessThan(level);
      }
    }
  });
});
