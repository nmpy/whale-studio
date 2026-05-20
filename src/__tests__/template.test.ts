// src/__tests__/template.test.ts
// src/lib/template.ts の単体テスト。

import { describe, it, expect } from "vitest";
import { interpolate, interpolateWithDiagnostics, extractVariableKeys } from "@/lib/template";
import { VARIABLE_KEY_REGEX } from "@/lib/validations";

// validations 側の VARIABLE_KEY_REGEX が許可 / 拒否するパターン。
// (template.ts の INTERPOLATE_REGEX は private だが、同じ文字クラスを使うため
//  ここで validation 側の regex を sanity-check しておく)
describe("VARIABLE_KEY_REGEX 検証", () => {
  it("有効な変数名を受理する", () => {
    const valid = ["userName", "_foo", "answer_1", "x", "favoriteColor", "user_name_with_underscore"];
    for (const s of valid) expect(VARIABLE_KEY_REGEX.test(s)).toBe(true);
  });
  it("無効な変数名を reject する", () => {
    const invalid = ["1user", "user-name", "user name", "", "ユーザー名", "user.name"];
    for (const s of invalid) expect(VARIABLE_KEY_REGEX.test(s)).toBe(false);
  });
});

describe("interpolate()", () => {
  it("単一変数を置換する", () => {
    expect(interpolate("へぇー！{userName}って素敵な名前ね！", { userName: "なみぽよ" }))
      .toBe("へぇー！なみぽよって素敵な名前ね！");
  });

  it("複数変数を置換する", () => {
    expect(
      interpolate("{nickname}さんの好きな色は{favoriteColor}ですね！", {
        nickname:       "ぽよ",
        favoriteColor:  "青",
      }),
    ).toBe("ぽよさんの好きな色は青ですね！");
  });

  it("同じ変数を複数回置換する", () => {
    expect(interpolate("{x}{x}{x}", { x: "a" })).toBe("aaa");
  });

  it("未保存変数は空文字に置換する", () => {
    expect(interpolate("へぇー！{userName}って素敵な名前ね！", { otherKey: "x" }))
      .toBe("へぇー！って素敵な名前ね！");
  });

  it("variables が null でも空文字置換で動く", () => {
    expect(interpolate("こんにちは{userName}", null)).toBe("こんにちは");
    expect(interpolate("こんにちは{userName}", undefined)).toBe("こんにちは");
  });

  it("text が null / undefined のとき空文字を返す", () => {
    expect(interpolate(null, { x: "y" })).toBe("");
    expect(interpolate(undefined, { x: "y" })).toBe("");
  });

  it("text に変数記法が含まれていなければそのまま返す", () => {
    expect(interpolate("これは普通の文章です。", { x: "y" }))
      .toBe("これは普通の文章です。");
  });

  it("無効な変数名パターン (1abc / user-name / 空) はテンプレと見なさず残す", () => {
    expect(interpolate("テスト {1abc} {user-name} {} 完了", { "1abc": "x" }))
      .toBe("テスト {1abc} {user-name} {} 完了");
  });

  it("空文字 value はそのまま空文字に展開", () => {
    expect(interpolate("「{x}」と言った", { x: "" })).toBe("「」と言った");
  });
});

describe("interpolateWithDiagnostics()", () => {
  it("未解決キーを列挙する", () => {
    const r = interpolateWithDiagnostics("hi {userName}, your color is {favoriteColor}", { userName: "ぽよ" });
    expect(r.text).toBe("hi ぽよ, your color is ");
    expect(r.unresolved).toEqual(["favoriteColor"]);
  });

  it("解決できた場合は unresolved は空", () => {
    const r = interpolateWithDiagnostics("hi {x}", { x: "a" });
    expect(r.text).toBe("hi a");
    expect(r.unresolved).toEqual([]);
  });

  it("同じ未解決キーは 1 回だけ列挙", () => {
    const r = interpolateWithDiagnostics("{a}{a}{a}", null);
    expect(r.text).toBe("");
    expect(r.unresolved).toEqual(["a"]);
  });
});

describe("extractVariableKeys()", () => {
  it("本文から変数キーを抽出する (重複なし)", () => {
    expect(extractVariableKeys("hi {userName}, hello {userName}, your color is {favoriteColor}"))
      .toEqual(["userName", "favoriteColor"]);
  });

  it("text が空のとき空配列", () => {
    expect(extractVariableKeys(null)).toEqual([]);
    expect(extractVariableKeys("")).toEqual([]);
  });

  it("無効パターンは無視", () => {
    expect(extractVariableKeys("{1abc} {user-name} {valid}")).toEqual(["valid"]);
  });
});

// VARIABLE_KEY_REGEX を export しているか sanity
describe("export sanity", () => {
  it("VARIABLE_KEY_REGEX が validations 側で export されている", () => {
    expect(VARIABLE_KEY_REGEX).toBeInstanceOf(RegExp);
  });
});
