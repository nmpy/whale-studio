// src/__tests__/free-input.test.ts
//
// 自由入力受付モードの統合テスト (Zod + runtime helpers + template interpolation)。
//
// このテストは DB / LINE webhook を起動せず、純関数のロジックだけ検証する。
// E2E (実 webhook 経由) は別ステージング環境で手動検証する想定。

import { describe, it, expect } from "vitest";
import { createMessageSchema, updateMessageSchema } from "@/lib/validations";
import { safeParseVariables, safeParseWaitingForInput } from "@/lib/runtime";
import { replacePlaceholders } from "@/lib/line";

// ─ Zod: free_input_* ─────────────────────────────────────
describe("createMessageSchema with free_input fields", () => {
  const base = {
    work_id: "11111111-1111-1111-1111-111111111111",
    message_type: "text" as const,
    body: "あなたの名前は？",
    kind: "response" as const,
    trigger_keyword: "名前",
  };

  it("free_input_enabled=true + 有効な variable_key を受理する", () => {
    const r = createMessageSchema.safeParse({
      ...base,
      free_input_enabled: true,
      free_input_variable_key: "userName",
      free_input_next_message_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(true);
  });

  it("free_input_enabled=true で variable_key が空欄 / null でも受理する (任意項目)", () => {
    // null
    const r1 = createMessageSchema.safeParse({
      ...base,
      free_input_enabled: true,
      free_input_variable_key: null,
    });
    expect(r1.success).toBe(true);
    // 未指定
    const r2 = createMessageSchema.safeParse({
      ...base,
      free_input_enabled: true,
    });
    expect(r2.success).toBe(true);
  });

  it("無効な変数名 (1abc / user-name / 空白を含む / 日本語) は Zod で reject (空文字は許容)", () => {
    // 空文字は許容に変わったため、無効値リストから "" は除外
    const invalids = ["1abc", "user-name", "user name", "ユーザー名"];
    for (const key of invalids) {
      const r = createMessageSchema.safeParse({
        ...base,
        free_input_enabled: true,
        free_input_variable_key: key,
      });
      expect(r.success, `key=${JSON.stringify(key)} should be rejected`).toBe(false);
    }
  });

  it("free_input_enabled=false なら variable_key 不要", () => {
    const r = createMessageSchema.safeParse({
      ...base,
      free_input_enabled: false,
    });
    expect(r.success).toBe(true);
  });

  it("free_input_enabled が省略されたら default false でパスする", () => {
    const r = createMessageSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.free_input_enabled).toBe(false);
  });
});

describe("updateMessageSchema with free_input fields", () => {
  it("有効な変数名を部分更新できる", () => {
    const r = updateMessageSchema.safeParse({
      free_input_enabled: true,
      free_input_variable_key: "favoriteColor",
    });
    expect(r.success).toBe(true);
  });
  it("無効な変数名は reject", () => {
    const r = updateMessageSchema.safeParse({
      free_input_enabled: true,
      free_input_variable_key: "1abc",
    });
    expect(r.success).toBe(false);
  });
});

// ─ safeParse* ────────────────────────────────────────────
describe("safeParseVariables()", () => {
  it("正常な JSON を Record<string, string> に変換", () => {
    expect(safeParseVariables('{"userName": "なみぽよ", "color": "blue"}'))
      .toEqual({ userName: "なみぽよ", color: "blue" });
  });
  it("number / boolean は文字列化", () => {
    expect(safeParseVariables('{"score": 10, "isActive": true}'))
      .toEqual({ score: "10", isActive: "true" });
  });
  it("null や配列、非 object は空オブジェクトに", () => {
    expect(safeParseVariables(null)).toEqual({});
    expect(safeParseVariables(undefined)).toEqual({});
    expect(safeParseVariables('"')).toEqual({});
    expect(safeParseVariables("[]")).toEqual({});
    expect(safeParseVariables("null")).toEqual({});
  });
  it("不正 JSON は空オブジェクトに (フォールバック)", () => {
    expect(safeParseVariables("{not json}")).toEqual({});
  });
});

describe("safeParseWaitingForInput()", () => {
  it("正常な waitingForInput を parse する", () => {
    const json = JSON.stringify({
      messageId:     "m1",
      variableKey:   "userName",
      nextMessageId: "m2",
      setAt:         "2026-05-20T12:00:00.000Z",
    });
    const r = safeParseWaitingForInput(json);
    expect(r).toEqual({
      messageId:     "m1",
      variableKey:   "userName",
      nextMessageId: "m2",
      setAt:         "2026-05-20T12:00:00.000Z",
    });
  });
  it("nextMessageId なしでも parse する (null 扱い)", () => {
    const json = JSON.stringify({ messageId: "m1", variableKey: "userName" });
    const r = safeParseWaitingForInput(json);
    expect(r?.nextMessageId).toBeNull();
  });
  it("messageId 欠落は null を返す", () => {
    expect(safeParseWaitingForInput('{}')).toBeNull();
  });
  it("variableKey なし (任意化後) でも parse する — variableKey は null", () => {
    const json = JSON.stringify({ messageId: "m1", nextMessageId: "m2" });
    const r = safeParseWaitingForInput(json);
    expect(r).not.toBeNull();
    expect(r?.variableKey).toBeNull();
    expect(r?.messageId).toBe("m1");
    expect(r?.nextMessageId).toBe("m2");
  });
  it("variableKey が空文字でも null として扱う", () => {
    const json = JSON.stringify({ messageId: "m1", variableKey: "" });
    const r = safeParseWaitingForInput(json);
    expect(r?.variableKey).toBeNull();
  });
  it("null / 不正 JSON は null", () => {
    expect(safeParseWaitingForInput(null)).toBeNull();
    expect(safeParseWaitingForInput(undefined)).toBeNull();
    expect(safeParseWaitingForInput("{bad")).toBeNull();
  });
});

// ─ replacePlaceholders (interpolate 統合) ─────────────────
describe("replacePlaceholders with userVariables", () => {
  it("{{user_name}} と {key} 両方を展開する", () => {
    const out = replacePlaceholders(
      "{{user_name}} さん、{userName} って素敵な名前ね！",
      {
        userName:    "あいう",     // {{user_name}} 用 (LINE display name)
        userVariables: { userName: "なみぽよ" }, // {key} 用 (保存変数)
      },
    );
    expect(out).toBe("あいう さん、なみぽよ って素敵な名前ね！");
  });
  it("未保存変数は空文字に置換", () => {
    const out = replacePlaceholders("hi {userName}, your color is {favoriteColor}", {
      userVariables: { userName: "ぽよ" },
    });
    expect(out).toBe("hi ぽよ, your color is ");
  });
  it("userVariables が undefined なら interpolate は no-op", () => {
    const out = replacePlaceholders("hi {userName}", { userName: "ぽよ" });
    // userVariables 未指定 → {userName} はそのまま残る
    expect(out).toBe("hi {userName}");
  });
  it("二重括弧 {{userName}} は interpolate されない (lookbehind 効いている)", () => {
    const out = replacePlaceholders("test {{userName}}", { userVariables: { userName: "ぽよ" } });
    // {{user_name}} ではないので双方ノータッチ → そのまま
    expect(out).toBe("test {{userName}}");
  });
});

// ─ webhook の処理順 (シナリオ確認) ────────────────────────
describe("Webhook 自由入力フロー — ロジック整合性", () => {
  it("waitingForInput がある場合、ユーザー入力が variableKey に保存される (変数 merge ロジック)", () => {
    // safeParseVariables で旧 variables を読み、新規 key を merge してから JSON.stringify する
    // という webhook の処理を模倣する
    const oldRaw = '{"nickname": "ぽよ"}';
    const oldVars = safeParseVariables(oldRaw);
    const waitingRaw = JSON.stringify({ messageId: "m1", variableKey: "userName" });
    const waiting = safeParseWaitingForInput(waitingRaw)!;
    const userInput = "なみぽよ";
    const newVars = waiting.variableKey
      ? { ...oldVars, [waiting.variableKey]: userInput }
      : oldVars;

    expect(newVars).toEqual({ nickname: "ぽよ", userName: "なみぽよ" });
    expect(JSON.parse(JSON.stringify(newVars))).toEqual(newVars); // serialize 可能
  });

  it("variableKey が null の場合、入力を受け取っても variables には保存しない (ログ用途)", () => {
    // 「感想を教えてください」のようなケース。waiting に variableKey は無い。
    const oldRaw = '{"nickname": "ぽよ"}';
    const oldVars = safeParseVariables(oldRaw);
    const waitingRaw = JSON.stringify({ messageId: "m1", nextMessageId: "m2" });
    const waiting = safeParseWaitingForInput(waitingRaw)!;
    expect(waiting.variableKey).toBeNull();

    // webhook 側のロジックを模倣: variableKey が null なら variables は更新しない
    const newVars = waiting.variableKey
      ? { ...oldVars, [waiting.variableKey]: "入力テキスト" }
      : oldVars;
    expect(newVars).toEqual({ nickname: "ぽよ" }); // 変化なし
  });

  it("variableKey が null でも nextMessage は送信される (= waiting.nextMessageId を持つ)", () => {
    // 「感想を教えてください」→「ありがとうございます」フロー
    const waitingRaw = JSON.stringify({
      messageId: "m_feedback",
      nextMessageId: "m_thanks",
    });
    const waiting = safeParseWaitingForInput(waitingRaw)!;
    expect(waiting.variableKey).toBeNull();
    expect(waiting.nextMessageId).toBe("m_thanks"); // 次メッセージ送信可能
  });

  it("waitingForInput が無い場合、入力は variables に保存されない (= 通常のキーワード判定に進む)", () => {
    const waiting = safeParseWaitingForInput(null);
    expect(waiting).toBeNull();
    // webhook 側ではこの分岐に入らずキーワード判定に進む
  });

  it("入力後の次メッセージ本文に {userName} を差し込み", () => {
    const nextVars = { userName: "なみぽよ" };
    const out = replacePlaceholders("へぇー！{userName}って素敵な名前ね！", {
      userVariables: nextVars,
    });
    expect(out).toBe("へぇー！なみぽよって素敵な名前ね！");
  });
});
