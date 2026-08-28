/**
 * src/__tests__/oa-credential-validation.test.ts
 *
 * OA の LINE チャネル資格情報バリデーション。
 *
 * 背景: 以前は `.min(1)` だけだったため、Webhook URL を Access Token 欄に貼っても
 * 保存できてしまい、その OA の LINE API 呼び出しが全て 401 になる状態が
 * 本番に 1 件存在した（【QA】Account / 2026-05-14 作成）。保存時に何のエラーも
 * 出ないため、後から原因を特定するのが難しい。
 */

import { describe, it, expect } from "vitest";
import { createOaSchema, updateOaSchema } from "@/lib/validations";

/** 実在する形（172 文字・base64 系）を模したダミー。実トークンではない。 */
const VALID_TOKEN = "A".repeat(150) + "+/=abcDEF123";
const VALID_SECRET = "bf8a62e6021234567890abcdef123456";
const VALID_CHANNEL_ID = "2009623906";

const base = {
  title: "テストOA",
  channel_id: VALID_CHANNEL_ID,
  channel_secret: VALID_SECRET,
  channel_access_token: VALID_TOKEN,
};

/** 最初のエラーメッセージを返す（parse 成功なら null）。 */
function errorOf(input: Record<string, unknown>): string | null {
  const r = createOaSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].message;
}

describe("createOaSchema — channel_access_token", () => {
  it("正常なトークンは通る", () => {
    expect(errorOf(base)).toBeNull();
  });

  it("Webhook URL を貼った場合は弾く（実際に起きた事故）", () => {
    const msg = errorOf({
      ...base,
      channel_access_token: "https://whale-studio.app/api/line/845ojcpo/webhook",
    });
    expect(msg).toContain("URL");
    expect(msg).toContain("Webhook URL ではありません");
  });

  it("http:// の URL も弾く", () => {
    expect(errorOf({ ...base, channel_access_token: "http://example.com/webhook" })).toContain("URL");
  });

  it("空白や改行が混ざっている場合は弾く", () => {
    expect(errorOf({ ...base, channel_access_token: VALID_TOKEN + " " })).toContain("空白");
    expect(errorOf({ ...base, channel_access_token: "AAAA\nBBBB" })).toContain("空白");
  });

  it("トークンとして不正な文字が含まれる場合は弾く", () => {
    expect(errorOf({ ...base, channel_access_token: "あ".repeat(120) })).toContain("使用できない文字");
  });

  it("短すぎる値は弾く（コピペ途中で切れたケース）", () => {
    const msg = errorOf({ ...base, channel_access_token: "A".repeat(57) });
    expect(msg).toContain("短すぎます");
  });

  it("空文字は必須エラー", () => {
    expect(errorOf({ ...base, channel_access_token: "" })).toBe("Access Tokenは必須です");
  });
});

describe("createOaSchema — channel_secret", () => {
  it("32 桁 hex は通る", () => {
    expect(errorOf(base)).toBeNull();
  });

  it("32 桁 hex でない場合は弾く", () => {
    expect(errorOf({ ...base, channel_secret: "too-short" })).toContain("32 桁");
    expect(errorOf({ ...base, channel_secret: "Z".repeat(32) })).toContain("32 桁");
  });

  it("Access Token を Channel Secret 欄に貼った場合も弾く", () => {
    expect(errorOf({ ...base, channel_secret: VALID_TOKEN })).toContain("32 桁");
  });
});

describe("createOaSchema — channel_id", () => {
  it("数字のみは通る", () => {
    expect(errorOf(base)).toBeNull();
  });

  it("Basic ID を入れた場合は弾く", () => {
    const msg = errorOf({ ...base, channel_id: "@845ojcpo" });
    expect(msg).toContain("数字のみ");
    expect(msg).toContain("Basic ID");
  });
});

describe("updateOaSchema", () => {
  it("partial なので資格情報を省略できる", () => {
    expect(updateOaSchema.safeParse({ title: "名前だけ変更" }).success).toBe(true);
  });

  it("資格情報を指定した場合は create と同じ検証がかかる", () => {
    const r = updateOaSchema.safeParse({
      channel_access_token: "https://whale-studio.app/api/line/845ojcpo/webhook",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("URL");
  });

  it("正常な値の更新は通る", () => {
    expect(updateOaSchema.safeParse({ channel_access_token: VALID_TOKEN }).success).toBe(true);
  });
});
