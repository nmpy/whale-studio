/**
 * src/__tests__/liff-page-delete.test.ts
 * PR-B: LIFFページ完全削除の可否判定（純ロジック）。
 */
import { describe, it, expect } from "vitest";
import {
  getLiffPageDeleteBlockReason,
  canDeleteLiffPage,
  LIFF_PAGE_DELETE_MESSAGES,
} from "@/lib/liff-page-delete";

describe("getLiffPageDeleteBlockReason / canDeleteLiffPage", () => {
  it("draft かつ参照なしは削除可能", () => {
    expect(getLiffPageDeleteBlockReason({ publishStatus: "draft", referenceCount: 0 })).toBeNull();
    expect(canDeleteLiffPage({ publishStatus: "draft", referenceCount: 0 })).toBe(true);
  });

  it("archived かつ参照なしは削除可能", () => {
    expect(getLiffPageDeleteBlockReason({ publishStatus: "archived", referenceCount: 0 })).toBeNull();
    expect(canDeleteLiffPage({ publishStatus: "archived", referenceCount: 0 })).toBe(true);
  });

  it("published は削除不可（参照なしでも）", () => {
    expect(getLiffPageDeleteBlockReason({ publishStatus: "published", referenceCount: 0 })).toBe("published");
    expect(canDeleteLiffPage({ publishStatus: "published", referenceCount: 0 })).toBe(false);
  });

  it("published は参照ありでも reason=published（published 優先）", () => {
    expect(getLiffPageDeleteBlockReason({ publishStatus: "published", referenceCount: 3 })).toBe("published");
  });

  it("参照中（draft / archived）は削除不可 = referenced", () => {
    expect(getLiffPageDeleteBlockReason({ publishStatus: "draft", referenceCount: 1 })).toBe("referenced");
    expect(getLiffPageDeleteBlockReason({ publishStatus: "archived", referenceCount: 2 })).toBe("referenced");
    expect(canDeleteLiffPage({ publishStatus: "draft", referenceCount: 1 })).toBe(false);
  });

  it("archive と delete の判定が混ざらない（archived は削除可・published は不可）", () => {
    // archived（=アーカイブ済み）は削除できる。published（公開中）は削除できない。
    expect(canDeleteLiffPage({ publishStatus: "archived", referenceCount: 0 })).toBe(true);
    expect(canDeleteLiffPage({ publishStatus: "published", referenceCount: 0 })).toBe(false);
  });

  it("不可理由ごとに文言が定義されている", () => {
    expect(LIFF_PAGE_DELETE_MESSAGES.published).toContain("公開中");
    expect(LIFF_PAGE_DELETE_MESSAGES.referenced).toContain("参照");
  });
});
