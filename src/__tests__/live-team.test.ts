/**
 * src/__tests__/live-team.test.ts
 *
 * LiveTeam 予約/部屋情報（PR2b-0）の純ロジック / スキーマ / レスポンス整形の検証。
 */
import { describe, it, expect } from "vitest";
import {
  LIVE_TEAM_GROUP_TYPES, LIVE_TEAM_GROUP_TYPE_LABELS,
  isLiveTeamGroupType, liveTeamGroupTypeLabel,
  createLiveTeamSchema, patchLiveTeamSchema, toLiveTeamResponse,
} from "@/lib/live-team";

describe("group_type 定数", () => {
  it("two / four の2種", () => {
    expect(LIVE_TEAM_GROUP_TYPES).toEqual(["two", "four"]);
  });
  it("ラベルは 2人 / 4人", () => {
    expect(LIVE_TEAM_GROUP_TYPE_LABELS.two).toBe("2人");
    expect(LIVE_TEAM_GROUP_TYPE_LABELS.four).toBe("4人");
  });
});

describe("isLiveTeamGroupType / liveTeamGroupTypeLabel", () => {
  it("有効値のみ true / ラベル解決", () => {
    expect(isLiveTeamGroupType("two")).toBe(true);
    expect(isLiveTeamGroupType("four")).toBe(true);
    expect(isLiveTeamGroupType("six")).toBe(false);
    expect(isLiveTeamGroupType(null)).toBe(false);
  });
  it("未設定/不正は '-'", () => {
    expect(liveTeamGroupTypeLabel("two")).toBe("2人");
    expect(liveTeamGroupTypeLabel(null)).toBe("-");
    expect(liveTeamGroupTypeLabel("bogus")).toBe("-");
  });
});

describe("createLiveTeamSchema", () => {
  it("name のみで OK（予約/部屋情報は任意）", () => {
    expect(createLiveTeamSchema.safeParse({ name: "チームA" }).success).toBe(true);
  });
  it("予約/部屋情報一式を受理", () => {
    const r = createLiveTeamSchema.safeParse({
      name: "ペア1",
      reservation_number: "R-001",
      ticket_id: "T-123",
      purchaser_name: "山田太郎",
      group_type: "four",
      room_number: "A-1",
      reserved_at: "2026-07-08T10:00:00.000Z",
      memo: "アレルギー対応",
    });
    expect(r.success).toBe(true);
  });
  it("name 空は reject / group_type 不正は reject / 日時不正は reject", () => {
    expect(createLiveTeamSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createLiveTeamSchema.safeParse({ name: "x", group_type: "six" }).success).toBe(false);
    expect(createLiveTeamSchema.safeParse({ name: "x", reserved_at: "not-a-date" }).success).toBe(false);
  });
});

describe("patchLiveTeamSchema", () => {
  it("単一フィールドで OK", () => {
    expect(patchLiveTeamSchema.safeParse({ room_number: "B-2" }).success).toBe(true);
    expect(patchLiveTeamSchema.safeParse({ ticket_id: null }).success).toBe(true);
  });
  it("空 body は reject", () => {
    expect(patchLiveTeamSchema.safeParse({}).success).toBe(false);
  });
});

describe("toLiveTeamResponse", () => {
  it("camelCase → snake_case（新項目含む）", () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const resv = new Date("2026-07-08T10:00:00.000Z");
    const out = toLiveTeamResponse({
      id: "t1", oaId: "oa1", liveSessionId: "s1", name: "チームA",
      reservationNumber: "R-001", memo: "m",
      reservedAt: resv, purchaserName: "山田", groupType: "four", roomNumber: "A-1", ticketId: "T-1",
      createdAt: now, updatedAt: now,
    });
    expect(out.reservation_number).toBe("R-001");
    expect(out.purchaser_name).toBe("山田");
    expect(out.group_type).toBe("four");
    expect(out.room_number).toBe("A-1");
    expect(out.ticket_id).toBe("T-1");
    expect(out.reserved_at).toBe(resv);
  });
});
