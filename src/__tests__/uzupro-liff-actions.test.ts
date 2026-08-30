// src/__tests__/uzupro-liff-actions.test.ts
// LIFF 状態 → CMS 主要アクション（発行 / 再発行）の純関数マッピング検証。

import { describe, it, expect } from "vitest";
import { liffPrimaryAction } from "@/lib/uzupro/liff-actions";

describe("liffPrimaryAction", () => {
  it("未発行 → 発行（非破壊）", () => {
    expect(liffPrimaryAction("unissued")).toEqual({ kind: "issue", label: "LIFF URLを発行", destructive: false });
  });

  it("発行済み/連携済み → 再発行（破壊的・旧URL失効）", () => {
    for (const s of ["issued", "linked"] as const) {
      const a = liffPrimaryAction(s);
      expect(a.kind).toBe("reissue");
      expect(a.destructive).toBe(true);
      expect(a.label).toContain("再発行");
    }
  });

  it("失効/エラー → 再発行", () => {
    for (const s of ["revoked", "error"] as const) {
      expect(liffPrimaryAction(s).kind).toBe("reissue");
      expect(liffPrimaryAction(s).destructive).toBe(true);
    }
  });
});
