// src/__tests__/liff-home-back-setting.test.ts
//
// 「ホームに戻る」導線 (settings_json.home_back_button) の解決ロジックと保存バリデーション。
//
// 旧実装は renderer 内で `pageType === "hint_search"` にハードコードされ、文言も
// "LIFFに戻る" 固定だった。設定化にあたっての最重要の不変条件は
//   「未設定データ（= 既存の全ページ）の表示有無が従来とまったく同じ」
// なので、そこを最初に固定する。

import { describe, it, expect } from "vitest";
import { resolveHomeBackButton, defaultHomeBackButton } from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;

const OTHER_TYPES = [
  "default", "hint", "faq", "survey", "location",
  "character", "werewolf", "contact", "puzzle", "ticket_link",
] as const;

describe("「ホームに戻る」導線（home_back_button）", () => {
  it("未設定は従来の挙動どおり — hint_search だけ表示、他は非表示", () => {
    expect(resolveHomeBackButton(undefined, "hint_search")).toBe("show");
    expect(resolveHomeBackButton({}, "hint_search")).toBe("show");
    for (const t of OTHER_TYPES) {
      expect(resolveHomeBackButton(undefined, t)).toBe("hide");
      expect(resolveHomeBackButton({}, t)).toBe("hide");
    }
  });

  it("不正値・null・false は未設定と同じ既定にフォールバックする", () => {
    for (const bad of ["none", null, false, 0, "SHOW", "", {}]) {
      expect(resolveHomeBackButton(S({ home_back_button: bad }), "hint_search")).toBe("show");
      expect(resolveHomeBackButton(S({ home_back_button: bad }), "default")).toBe("hide");
    }
  });

  it("明示指定はページ種別の既定より優先される（両方向に上書きできる）", () => {
    // 既定 show の hint_search を消せる = ホームが空のページ向け
    expect(resolveHomeBackButton(S({ home_back_button: "hide" }), "hint_search")).toBe("hide");
    for (const t of OTHER_TYPES) {
      expect(resolveHomeBackButton(S({ home_back_button: "show" }), t)).toBe("show");
      expect(resolveHomeBackButton(S({ home_back_button: "hide" }), t)).toBe("hide");
    }
  });

  it("defaultHomeBackButton は hint_search のみ show", () => {
    expect(defaultHomeBackButton("hint_search")).toBe("show");
    for (const t of OTHER_TYPES) expect(defaultHomeBackButton(t)).toBe("hide");
  });

  it("保存バリデーション — show / hide だけ通る", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ home_back_button: "show" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ home_back_button: "hide" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ home_back_button: "none" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ home_back_button: true }).success).toBe(false);
    // 未設定は通る（= 既存データがそのまま保存できる）
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
