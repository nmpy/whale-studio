// @vitest-environment jsdom
// src/__tests__/liff-home-back-button.test.tsx
//
// プレイヤー画面上部の「ホームに戻る」導線（settings_json.home_back_button）の描画テスト。
//
// 背景:
//   旧実装は renderer 内で `pageType === "hint_search"` にハードコードされ、文言も
//   "LIFFに戻る" 固定だった。"LIFF" はプレイヤーに通じない用語なので "ホームに戻る" に改称し、
//   表示有無をページ単位で選べるようにした。
//
// 最重要の不変条件:
//   「未設定データ（= 既存の全ページ）の表示有無が従来とまったく同じ」
//   解決ロジック自体は liff-theme-settings.test.ts で網羅しているので、
//   ここでは **実際に DOM に出る文言と onBack の配線** を固定する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { LiffSinglePageRenderer, type LiffSinglePage } from "@/components/liff/LiffSinglePageRenderer";
import type { LiffPageConfigSettings } from "@/types";

// hint_search の renderer が mount 時に呼ぶ。jsdom は未実装で警告を吐くだけなので潰しておく。
window.scrollTo = () => {};

afterEach(cleanup);

const page = (
  pageType: string,
  settings: LiffPageConfigSettings = {},
): LiffSinglePage => ({
  id:            "p1",
  public_id:     "pub1",
  title:         "テストページ",
  description:   null,
  page_type:     pageType,
  is_enabled:    true,
  settings_json: settings,
  blocks:        [],
});

const draw = (pageType: string, settings?: LiffPageConfigSettings) => {
  const onBack = vi.fn();
  render(
    <LiffSinglePageRenderer
      workId="w1"
      workTitle="作品"
      page={page(pageType, settings)}
      onBack={onBack}
    />,
  );
  return onBack;
};

describe("「ホームに戻る」導線の描画", () => {
  it('旧文言 "LIFFに戻る" はどこにも出ない（プレイヤーに通じないため改称済み）', () => {
    draw("hint_search");
    expect(screen.queryByText("LIFFに戻る")).toBeNull();
    expect(screen.queryByLabelText("LIFFに戻る")).toBeNull();
  });

  it("未設定 + hint_search — 従来どおり表示され、文言は「ホームに戻る」", () => {
    draw("hint_search");
    expect(screen.getByRole("button", { name: "ホームに戻る" })).toBeTruthy();
  });

  it("未設定 + hint_search 以外 — 従来どおり出ない", () => {
    for (const t of ["default", "faq", "survey", "contact"]) {
      cleanup();
      draw(t);
      expect(screen.queryByRole("button", { name: "ホームに戻る" })).toBeNull();
    }
  });

  it('hide を指定すると hint_search でも消える（ホームが空のページ向け）', () => {
    draw("hint_search", { home_back_button: "hide" });
    expect(screen.queryByRole("button", { name: "ホームに戻る" })).toBeNull();
  });

  it('show を指定すると hint_search 以外でも出る', () => {
    draw("default", { home_back_button: "show" });
    expect(screen.getByRole("button", { name: "ホームに戻る" })).toBeTruthy();
  });

  it("押すと onBack（= メニューホームへの遷移）が呼ばれる", () => {
    const onBack = draw("default", { home_back_button: "show" });
    screen.getByRole("button", { name: "ホームに戻る" }).click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
