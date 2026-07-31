// src/__tests__/ticket-link-rules.test.ts
//
// チケット連携のドメインルール（状態遷移 / 人数解決 / コードネーム検証）の単体テスト。

import { describe, it, expect } from "vitest";
import {
  canTransitionDraft,
  canTransitionLink,
  needsUzuSync,
  resolveParticipantCount,
  validateCodeNames,
  CODE_NAME_MAX_LENGTH,
} from "@/lib/ticket-link/rules";

describe("canTransitionDraft", () => {
  it("受信から解析・確認・失敗へ進める", () => {
    expect(canTransitionDraft("RECEIVED", "EXTRACTING")).toBe(true);
    expect(canTransitionDraft("EXTRACTING", "NEEDS_REVIEW")).toBe(true);
    expect(canTransitionDraft("NEEDS_REVIEW", "CONFIRMED")).toBe(true);
  });

  it("確認画面から再解析へ戻せる（やり直し）", () => {
    expect(canTransitionDraft("NEEDS_REVIEW", "EXTRACTING")).toBe(true);
  });

  it("確定後は戻せない（終端）", () => {
    expect(canTransitionDraft("CONFIRMED", "NEEDS_REVIEW")).toBe(false);
    expect(canTransitionDraft("CONFIRMED", "EXTRACTING")).toBe(false);
    expect(canTransitionDraft("EXPIRED", "NEEDS_REVIEW")).toBe(false);
  });

  it("解析中からいきなり確定はできない（確認を飛ばさない）", () => {
    expect(canTransitionDraft("EXTRACTING", "CONFIRMED")).toBe(false);
  });
});

describe("canTransitionLink", () => {
  it("取込待ちから連携済み・競合へ遷移できる", () => {
    expect(canTransitionLink("PENDING_UZU_BOOKING", "LINKED")).toBe(true);
    expect(canTransitionLink("PENDING_UZU_BOOKING", "CONFLICT")).toBe(true);
  });

  it("競合は運営確認を経て解消できる", () => {
    expect(canTransitionLink("CONFLICT", "LINKED")).toBe(true);
  });

  it("無効化は終端", () => {
    expect(canTransitionLink("REVOKED", "LINKED")).toBe(false);
    expect(canTransitionLink("REVOKED", "PENDING_UZU_BOOKING")).toBe(false);
  });

  it("連携済みから取込待ちへは戻さない", () => {
    expect(canTransitionLink("LINKED", "PENDING_UZU_BOOKING")).toBe(false);
  });
});

describe("needsUzuSync", () => {
  it("未同期は対象", () => {
    expect(needsUzuSync({ uzuSyncedAt: null, updatedAt: new Date("2026-08-01T00:00:00Z") })).toBe(true);
  });

  it("同期後に更新されていれば対象", () => {
    expect(needsUzuSync({
      uzuSyncedAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt:   new Date("2026-08-01T01:00:00Z"),
    })).toBe(true);
  });

  it("同期後に更新が無ければ対象外", () => {
    expect(needsUzuSync({
      uzuSyncedAt: new Date("2026-08-01T01:00:00Z"),
      updatedAt:   new Date("2026-08-01T00:00:00Z"),
    })).toBe(false);
  });
});

describe("resolveParticipantCount", () => {
  const options = [
    { label: "1名チケット",        participantCount: 1 },
    { label: "2名グループチケット", participantCount: 2 },
    { label: "4名グループチケット", participantCount: 4 },
    { label: "人数未設定チケット",  participantCount: null },
  ];

  it("設定された人数を返す", () => {
    expect(resolveParticipantCount("2名グループチケット", options)).toBe(2);
    expect(resolveParticipantCount("4名グループチケット", options)).toBe(4);
  });

  it("表記ゆれ（全角/空白/大小）を吸収して照合する", () => {
    expect(resolveParticipantCount(" 1名チケット ", options)).toBe(1);
  });

  it("名称の数字から人数を推測しない", () => {
    // 設定に無い種別は、名前に "3名" とあっても解決しない。
    expect(resolveParticipantCount("3名グループチケット", options)).toBeNull();
  });

  it("人数未設定なら null（呼び出し側が確認を求める）", () => {
    expect(resolveParticipantCount("人数未設定チケット", options)).toBeNull();
  });

  it("種別未指定なら null", () => {
    expect(resolveParticipantCount(null, options)).toBeNull();
    expect(resolveParticipantCount("", options)).toBeNull();
  });
});

describe("validateCodeNames", () => {
  it("正常な入力を通し、trim 済みの値を返す", () => {
    const r = validateCodeNames([" アリス ", "ボブ"]);
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual(["アリス", "ボブ"]);
    expect(r.errors).toEqual([]);
  });

  it("空欄をエラーにする", () => {
    const r = validateCodeNames(["アリス", "   "]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ index: 1, code: "EMPTY" });
  });

  it("最大文字数超過をエラーにする", () => {
    const r = validateCodeNames(["あ".repeat(CODE_NAME_MAX_LENGTH + 1)]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ index: 0, code: "TOO_LONG" });
  });

  it("制御文字をエラーにする", () => {
    const r = validateCodeNames(["アリス\u0000"]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ index: 0, code: "CONTROL_CHAR" });
  });

  it("同一予約内の重複は警告（登録は止めない）", () => {
    const r = validateCodeNames(["アリス", "アリス"]);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatchObject({ index: 1, code: "DUPLICATE" });
  });

  it("人数分すべてを検証する", () => {
    const r = validateCodeNames(["", "", "", ""]);
    expect(r.errors).toHaveLength(4);
  });
});
