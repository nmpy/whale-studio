/**
 * src/__tests__/liff-contact.test.ts
 *
 * PR5a: お問い合わせフォーム（page_type="contact"）の純ロジック + 登録/検証。
 *  - contact-helpers: resolveContactConfig / validateContactSubmission / buildContactSubmissionBlocks / isValidEmail
 *  - normalizeLiffPageType / LIFF_PAGE_TYPES に contact
 *  - liffPageConfigSettingsSchema が contact_* を受理
 */
import { describe, it, expect } from "vitest";
import {
  resolveContactConfig,
  validateContactSubmission,
  buildContactSubmissionBlocks,
  isValidEmail,
  CONTACT_BODY_MAX,
} from "@/components/liff/contact-helpers";
import { normalizeLiffPageType } from "@/types";
import { LIFF_PAGE_TYPES, liffPageConfigSettingsSchema } from "@/lib/validations";

describe("page_type=contact 登録", () => {
  it("normalizeLiffPageType('contact') === 'contact'", () => {
    expect(normalizeLiffPageType("contact")).toBe("contact");
  });
  it("未知値は default（既存挙動維持）", () => {
    expect(normalizeLiffPageType("bogus")).toBe("default");
  });
  it("LIFF_PAGE_TYPES に contact を含む", () => {
    expect((LIFF_PAGE_TYPES as readonly string[]).includes("contact")).toBe(true);
  });
});

describe("resolveContactConfig — 既定値（未設定セーフ）", () => {
  it("未設定は 表示=true / 必須は category・body のみ true", () => {
    const c = resolveContactConfig(undefined);
    expect(c.categories).toEqual([]);
    expect(c.categoryRequired).toBe(true);
    expect(c.showName).toBe(true);
    expect(c.nameRequired).toBe(false);
    expect(c.showEmail).toBe(true);
    expect(c.emailRequired).toBe(false);
    expect(c.bodyRequired).toBe(true);
    expect(c.customFields).toEqual([]);
    expect(c.successMessage).not.toBe("");
  });
  it("空白のみの種別は除外", () => {
    expect(resolveContactConfig({ contact_categories: ["不具合", " ", ""] }).categories).toEqual(["不具合"]);
  });
  it("明示 false で非表示/任意にできる", () => {
    const c = resolveContactConfig({ contact_show_name: false, contact_show_email: false, contact_body_required: false });
    expect(c.showName).toBe(false);
    expect(c.showEmail).toBe(false);
    expect(c.bodyRequired).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("妥当な形式は true / 不正は false", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail(" a@b.co ")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("abc")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("validateContactSubmission", () => {
  const cfg = resolveContactConfig({
    contact_categories: ["不具合", "要望"],
  });

  it("必須を満たせば null（OK）", () => {
    expect(validateContactSubmission(cfg, { category: "不具合", body: "こんにちは" })).toBeNull();
  });
  it("種別必須なのに未選択は失敗", () => {
    expect(validateContactSubmission(cfg, { category: "", body: "x" })).toMatch(/問い合わせ種別/);
  });
  it("選択肢外の種別は失敗", () => {
    expect(validateContactSubmission(cfg, { category: "存在しない", body: "x" })).toMatch(/不正/);
  });
  it("本文必須が空は失敗", () => {
    expect(validateContactSubmission(cfg, { category: "不具合", body: "  " })).toMatch(/お問い合わせ内容/);
  });
  it(`本文 ${CONTACT_BODY_MAX} 文字超は失敗`, () => {
    expect(validateContactSubmission(cfg, { category: "不具合", body: "あ".repeat(CONTACT_BODY_MAX + 1) })).toMatch(/100文字以内/);
  });
  it("メール任意・形式不正は失敗", () => {
    expect(validateContactSubmission(cfg, { category: "不具合", body: "x", email: "bad" })).toMatch(/メールアドレス/);
  });
  it("メール必須・空は失敗", () => {
    const c2 = resolveContactConfig({ contact_show_email: true, contact_email_required: true });
    expect(validateContactSubmission(c2, { body: "x", email: "" })).toMatch(/メールアドレス/);
  });
  it("お名前必須・空は失敗", () => {
    const c3 = resolveContactConfig({ contact_name_required: true });
    expect(validateContactSubmission(c3, { body: "x", name: "" })).toMatch(/お名前/);
  });
  it("custom 必須未回答は失敗", () => {
    const c4 = resolveContactConfig({ contact_custom_fields: [{ id: "f1", question: "プラン", input_type: "text", required: true }] });
    expect(validateContactSubmission(c4, { body: "x", custom_answers: {} })).toMatch(/プラン/);
    expect(validateContactSubmission(c4, { body: "x", custom_answers: { f1: "Pro" } })).toBeNull();
  });
});

describe("buildContactSubmissionBlocks", () => {
  const cfg = resolveContactConfig({
    contact_categories: ["不具合"],
    contact_custom_fields: [{ id: "f1", question: "プラン", input_type: "radio", options: ["A", "B"], required: false }],
  });

  it("固定項目 + custom を blockType='contact' で組み立てる", () => {
    const blocks = buildContactSubmissionBlocks(cfg, {
      category: "不具合", name: "山田", email: "y@example.com", body: "テスト", custom_answers: { f1: "A" },
    });
    expect(blocks.every((b) => b.blockType === "contact")).toBe(true);
    const byId = Object.fromEntries(blocks.map((b) => [b.blockId, b]));
    expect(byId.contact_category?.value).toBe("不具合");
    expect(byId.contact_category?.answerType).toBe("singleChoice");
    expect(byId.contact_name?.value).toBe("山田");
    expect(byId.contact_email?.value).toBe("y@example.com");
    expect(byId.contact_body?.value).toBe("テスト");
    expect(byId.f1?.value).toBe("A");
    expect(byId.f1?.answerType).toBe("singleChoice");
  });

  it("非表示/空項目はスキップ（本文のみ）", () => {
    const cfg2 = resolveContactConfig({ contact_show_name: false, contact_show_email: false });
    const blocks = buildContactSubmissionBlocks(cfg2, { name: "無視", email: "ignore@x.co", body: "本文だけ" });
    expect(blocks.map((b) => b.blockId)).toEqual(["contact_body"]);
  });
});

describe("liffPageConfigSettingsSchema — contact_* 受理", () => {
  it("contact_* 未指定でも success（既存ページ互換）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
  it("妥当な contact 設定は success", () => {
    expect(liffPageConfigSettingsSchema.safeParse({
      contact_categories: ["不具合", "要望"],
      contact_show_name: true, contact_name_required: false,
      contact_show_email: true, contact_email_required: true,
      contact_body_required: true,
      contact_custom_fields: [{ question: "プラン", input_type: "text" }],
      contact_success_message: "ありがとうございました",
    }).success).toBe(true);
  });
  it("種別が 21 件以上は失敗", () => {
    expect(liffPageConfigSettingsSchema.safeParse({
      contact_categories: Array.from({ length: 21 }, (_, i) => `c${i}`),
    }).success).toBe(false);
  });
});
