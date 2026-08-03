/**
 * src/__tests__/liff-ticket-link-page-type.test.ts
 *
 * page_type="ticket_link"（チケット連携ページ）の作成回帰テスト。
 *
 * 背景（本番障害）:
 *   `LiffPageType`（src/types）には ticket_link があるのに、Zod の入力許可リスト
 *   `LIFF_PAGE_TYPES`（src/lib/validations）に無かったため、CMS の
 *   「チケット連携ページを作成」が POST /api/works/[workId]/liff-pages で
 *   ZodError → 400「入力内容に誤りがあります」になっていた。
 *   型（コンパイル時）と Zod（実行時）が別管理のため typecheck では検出できない。
 *   → 両者が食い違わないことを実行時に固定する。
 */
import { describe, it, expect } from "vitest";
import { normalizeLiffPageType } from "@/types";
import { LIFF_PAGE_TYPES, createLiffPageSchema } from "@/lib/validations";

describe("page_type=ticket_link 登録", () => {
  it("LIFF_PAGE_TYPES に ticket_link を含む（保存可）", () => {
    expect((LIFF_PAGE_TYPES as readonly string[]).includes("ticket_link")).toBe(true);
  });

  it("normalizeLiffPageType('ticket_link') === 'ticket_link'", () => {
    expect(normalizeLiffPageType("ticket_link")).toBe("ticket_link");
  });

  it("createLiffPageSchema が CMS の実リクエスト body を受理する（本番 400 の再現）", () => {
    // CMS「チケット連携ページを作成」が実際に送る body。
    const parsed = createLiffPageSchema.parse({
      page_type: "ticket_link",
      title:     "チケット連携",
    });
    expect(parsed.page_type).toBe("ticket_link");
    expect(parsed.title).toBe("チケット連携");
  });
});

describe("既存 page_type の挙動は不変", () => {
  // hint_site は「入力は受理し、保存時に hint へ正規化する」旧互換値。
  const acceptedInputs = [
    "default", "hint", "faq", "survey", "location",
    "character", "werewolf", "contact", "puzzle", "hint_site",
  ] as const;

  it.each(acceptedInputs)("createLiffPageSchema が %s を引き続き受理する", (pageType) => {
    expect(() => createLiffPageSchema.parse({ page_type: pageType })).not.toThrow();
  });

  it("hint_site は hint へ正規化される（変換挙動を変えない）", () => {
    expect(createLiffPageSchema.parse({ page_type: "hint_site" }).page_type).toBe("hint");
  });

  it("page_type 省略は許容される（既定は API 側で default）", () => {
    expect(() => createLiffPageSchema.parse({ title: "新規ページ" })).not.toThrow();
  });

  it("未知の page_type は引き続き拒否される", () => {
    expect(() => createLiffPageSchema.parse({ page_type: "bogus" })).toThrow();
  });
});
