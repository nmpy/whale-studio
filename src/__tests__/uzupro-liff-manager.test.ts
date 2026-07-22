// src/__tests__/uzupro-liff-manager.test.ts
// isAuthorizedLiffManager: env allowlist（UZU_PRO_LIFF_MANAGER_USER_IDS）による LIFF 管理者判定。
//   - 未設定/空 → 常に false（fail-closed・単一アカウント運用の基盤）
//   - 完全一致のみ true（部分一致/別 ID は false）。trim 済み比較。将来複数可。
import { describe, it, expect, afterEach } from "vitest";
import { isAuthorizedLiffManager } from "@/lib/uzupro/liff-manager";

const KEY = "UZU_PRO_LIFF_MANAGER_USER_IDS";
const orig = process.env[KEY];
afterEach(() => {
  if (orig === undefined) delete process.env[KEY];
  else process.env[KEY] = orig;
});

describe("isAuthorizedLiffManager", () => {
  it("env 未設定 → 常に false（fail-closed）", () => {
    delete process.env[KEY];
    expect(isAuthorizedLiffManager("user-1")).toBe(false);
  });

  it("env 空文字 → false", () => {
    process.env[KEY] = "   ";
    expect(isAuthorizedLiffManager("user-1")).toBe(false);
  });

  it("allowlist に一致 → true、非一致 → false", () => {
    process.env[KEY] = "owner-abc";
    expect(isAuthorizedLiffManager("owner-abc")).toBe(true);
    expect(isAuthorizedLiffManager("someone-else")).toBe(false);
  });

  it("空/undefined の userId → false", () => {
    process.env[KEY] = "owner-abc";
    expect(isAuthorizedLiffManager("")).toBe(false);
    expect(isAuthorizedLiffManager(null)).toBe(false);
    expect(isAuthorizedLiffManager(undefined)).toBe(false);
  });

  it("カンマ区切りで複数許可・空白は trim（単一運用でも将来拡張可）", () => {
    process.env[KEY] = " owner-abc , second-id ";
    expect(isAuthorizedLiffManager("owner-abc")).toBe(true);
    expect(isAuthorizedLiffManager("second-id")).toBe(true);
    expect(isAuthorizedLiffManager("third-id")).toBe(false);
  });

  it("部分一致では通さない（完全一致のみ）", () => {
    process.env[KEY] = "owner-abc";
    expect(isAuthorizedLiffManager("owner-ab")).toBe(false);
    expect(isAuthorizedLiffManager("owner-abcd")).toBe(false);
  });
});
