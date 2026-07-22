// src/__tests__/uzupro-mask.test.ts
// for マスク表示ユーティリティ maskLineUserId: 完全な LINE User ID を表示・保存しない。
//   - 先頭5 + 固定8ドット + 末尾4。長さを固定ドットにして UID 長も推測させない。
//   - 空文字は ""。極端に短い入力も原文を漏らさない。
import { describe, it, expect } from "vitest";
import { maskLineUserId } from "@/lib/mask";

describe("maskLineUserId", () => {
  it("完全な UID をマスク（先頭5 + 8ドット固定 + 末尾4、原文を含まない）", () => {
    const uid = "U0123456789abcdef0123456789abcdef";
    const masked = maskLineUserId(uid);
    expect(masked).toContain("•");
    expect(masked).not.toBe(uid);
    // 原文（フル UID）がマスク結果の部分文字列として現れない。
    expect(masked).not.toContain(uid);
    // 先頭5 + 8ドット + 末尾4。
    expect(masked).toBe("U0123" + "•".repeat(8) + "cdef");
    // 固定ドット長: 別の長さの UID でも中間ドット数は 8 で一定。
    const uid2 = "U0123456789";
    expect(maskLineUserId(uid2)).toBe("U0123" + "•".repeat(8) + "6789");
  });

  it("極端に短い入力は先頭1文字のみ残す（原文を漏らさない）", () => {
    const short = "Uabcd"; // length 5 (<= head+tail)
    const masked = maskLineUserId(short);
    expect(masked).toBe("U" + "•".repeat(8));
    expect(masked).not.toContain("abcd");
  });

  it("空 / 空白 / null / undefined → ''", () => {
    expect(maskLineUserId("")).toBe("");
    expect(maskLineUserId("   ")).toBe("");
    expect(maskLineUserId(null)).toBe("");
    expect(maskLineUserId(undefined)).toBe("");
  });
});
