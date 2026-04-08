/**
 * src/__tests__/owner-protection.test.ts
 *
 * ensureActiveOwnerRemains の単体テスト
 * - 最後の active owner を消す操作は LastOwnerError で拒否
 * - 他に active owner がいれば成功
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock のファクトリ内ではトップレベル変数を参照できないため
// vi.hoisted で mock 関数を巻き上げる
const { mockCount } = vi.hoisted(() => ({
  mockCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceMember: { count: mockCount },
  },
}));

import { ensureActiveOwnerRemains, LastOwnerError } from "@/lib/rbac";

// tx mock: ensureActiveOwnerRemains に渡すトランザクションクライアント
const txMock = { workspaceMember: { count: mockCount } };

const WS_ID = "ws-test-001";
const MEMBER_ID = "member-target";

describe("ensureActiveOwnerRemains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("他に active owner がいなければ LastOwnerError を投げる", async () => {
    mockCount.mockResolvedValue(0);

    await expect(
      ensureActiveOwnerRemains(WS_ID, MEMBER_ID, txMock)
    ).rejects.toThrow(LastOwnerError);
  });

  it("他に active owner が 1 人以上いれば成功する", async () => {
    mockCount.mockResolvedValue(1);

    await expect(
      ensureActiveOwnerRemains(WS_ID, MEMBER_ID, txMock)
    ).resolves.toBeUndefined();
  });

  it("他に active owner が複数いれば成功する", async () => {
    mockCount.mockResolvedValue(3);

    await expect(
      ensureActiveOwnerRemains(WS_ID, MEMBER_ID, txMock)
    ).resolves.toBeUndefined();
  });

  it("正しいフィルタ条件で count を呼ぶ", async () => {
    mockCount.mockResolvedValue(2);

    await ensureActiveOwnerRemains(WS_ID, MEMBER_ID, txMock);

    expect(mockCount).toHaveBeenCalledWith({
      where: {
        workspaceId: WS_ID,
        role: "owner",
        status: "active",
        id: { not: MEMBER_ID },
      },
    });
  });

  it("LastOwnerError は LAST_OWNER コードを持つ", () => {
    const error = new LastOwnerError();
    expect(error.code).toBe("LAST_OWNER");
    expect(error.name).toBe("LastOwnerError");
    expect(error.message).toContain("オーナー");
  });
});
