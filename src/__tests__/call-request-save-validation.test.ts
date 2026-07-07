/**
 * src/__tests__/call-request-save-validation.test.ts
 *
 * 通話リクエスト（message_type="call_request"）の保存バリデーション。
 * 空/不正な flex_payload_json の call_request は create/update スキーマで保存を弾く
 * （＝「保存できたが実機では無言で送られない」状態を作らせない）。
 */
import { describe, it, expect } from "vitest";
import { createMessageSchema, updateMessageSchema } from "@/lib/validations";

const WORK_ID = "11111111-1111-1111-1111-111111111111";
const VALID_CFG = JSON.stringify({
  title: "電話でのお問い合わせ",
  body: "下のボタンから通話を開始できます。",
  buttonLabel: "電話をかける",
  callType: "tel",
  tel: "03-1234-5678",
});

describe("createMessageSchema: call_request の空/不正 payload は保存不可", () => {
  it("flex_payload_json 未指定 → 保存不可", () => {
    const r = createMessageSchema.safeParse({ work_id: WORK_ID, message_type: "call_request" });
    expect(r.success).toBe(false);
  });
  it("flex_payload_json 空文字 → 保存不可", () => {
    const r = createMessageSchema.safeParse({ work_id: WORK_ID, message_type: "call_request", flex_payload_json: "" });
    expect(r.success).toBe(false);
  });
  it("flex_payload_json 不正 JSON → 保存不可", () => {
    const r = createMessageSchema.safeParse({ work_id: WORK_ID, message_type: "call_request", flex_payload_json: "not-json" });
    expect(r.success).toBe(false);
  });
  it("通話先未入力の設定 → 保存不可", () => {
    const bad = JSON.stringify({ title: "電話", body: "本文", buttonLabel: "発信", callType: "tel", tel: "" });
    const r = createMessageSchema.safeParse({ work_id: WORK_ID, message_type: "call_request", flex_payload_json: bad });
    expect(r.success).toBe(false);
  });
  it("有効な設定 → 保存可", () => {
    const r = createMessageSchema.safeParse({ work_id: WORK_ID, message_type: "call_request", flex_payload_json: VALID_CFG });
    expect(r.success).toBe(true);
  });
});

describe("updateMessageSchema: message_type=call_request を含む更新は payload を検証", () => {
  it("message_type=call_request + 空 payload → 保存不可", () => {
    const r = updateMessageSchema.safeParse({ message_type: "call_request", flex_payload_json: "" });
    expect(r.success).toBe(false);
  });
  it("message_type=call_request + 有効 payload → 保存可", () => {
    const r = updateMessageSchema.safeParse({ message_type: "call_request", flex_payload_json: VALID_CFG });
    expect(r.success).toBe(true);
  });
});

describe("call_request を kind=response（応答メッセージ）として作成/保存できる（問題B）", () => {
  it("6) kind=response + message_type=call_request + 有効 payload → 保存可", () => {
    const r = createMessageSchema.safeParse({
      work_id: WORK_ID, kind: "response", message_type: "call_request",
      trigger_keyword: "でんわ", flex_payload_json: VALID_CFG,
    });
    expect(r.success).toBe(true);
  });
  it("kind=response でも空 payload の call_request は保存不可", () => {
    const r = createMessageSchema.safeParse({
      work_id: WORK_ID, kind: "response", message_type: "call_request",
      trigger_keyword: "でんわ", flex_payload_json: "",
    });
    expect(r.success).toBe(false);
  });
});
