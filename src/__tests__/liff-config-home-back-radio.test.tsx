// @vitest-environment jsdom
// src/__tests__/liff-config-home-back-radio.test.tsx
//
// CMS の LIFF設定パネルにある「ホームに戻る」ボタンのラジオ操作テスト。
//
// このパネルの他項目は select だが、この項目だけラジオにしている（ページ種別で既定が
// 変わるため、どちらが既定かをその場で読ませたい）。CMS 画面はログインが要るので
// ブラウザで直接触れない ＝ ここで「選択状態」と「保存される値」を固定しておく。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import type { LiffPageConfig, LiffPageConfigSettings } from "@/types";

afterEach(cleanup);

const config = (pageType: string, settings: LiffPageConfigSettings = {}): LiffPageConfig =>
  ({
    id:             "c1",
    work_id:        "w1",
    page_type:      pageType,
    publish_status: "draft",
    is_enabled:     true,
    title:          "テスト",
    description:    null,
    settings_json:  settings,
  }) as unknown as LiffPageConfig;

const draw = (pageType: string, settings?: LiffPageConfigSettings) => {
  const onLocalChange = vi.fn();
  render(
    <LiffConfigHeader
      config={config(pageType, settings)}
      saving={false}
      readOnly={false}
      onToggleEnabled={vi.fn()}
      onLocalChange={onLocalChange}
      onUpdatePageType={vi.fn()}
      onUpdatePublishStatus={vi.fn()}
    />,
  );
  // ラジオ 2 つを含む行を label テキストから引く
  const group = screen.getByText("「ホームに戻る」ボタン").parentElement!;
  const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
  return { onLocalChange, group, show: radios[0], hide: radios[1] };
};

describe("CMS —「ホームに戻る」ボタンのラジオ", () => {
  it("ラジオが 2 つ（表示する / 表示しない）出る", () => {
    const { group } = draw("hint_search");
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(group.textContent).toContain("表示する");
    expect(group.textContent).toContain("表示しない");
  });

  it("hint_search では「表示する」が既定と表示され、未設定でもそちらが選択済み", () => {
    const { group, show, hide } = draw("hint_search");
    expect(group.textContent).toContain("表示する（既定）");
    expect(show.checked).toBe(true);
    expect(hide.checked).toBe(false);
  });

  it("hint_search 以外では「表示しない」が既定と表示され、未設定でもそちらが選択済み", () => {
    for (const t of ["default", "faq", "survey", "contact"]) {
      cleanup();
      const { group, show, hide } = draw(t);
      expect(group.textContent).toContain("表示しない（既定）");
      expect(hide.checked).toBe(true);
      expect(show.checked).toBe(false);
    }
  });

  it("保存済みの値が選択状態に反映される（既定より優先）", () => {
    const a = draw("hint_search", { home_back_button: "hide" });
    expect(a.hide.checked).toBe(true);
    cleanup();
    const b = draw("default", { home_back_button: "show" });
    expect(b.show.checked).toBe(true);
  });

  it("選ぶと home_back_button だけが更新され、他の設定は保持される", () => {
    const { onLocalChange, hide } = draw("hint_search", { font_scale: "lg", layout_density: "compact" });
    hide.click();
    expect(onLocalChange).toHaveBeenCalledWith({
      settings_json: { font_scale: "lg", layout_density: "compact", home_back_button: "hide" },
    });
  });

  it("readOnly のときは操作できない", () => {
    const onLocalChange = vi.fn();
    render(
      <LiffConfigHeader
        config={config("hint_search")}
        saving={false}
        readOnly
        onToggleEnabled={vi.fn()}
        onLocalChange={onLocalChange}
        onUpdatePageType={vi.fn()}
        onUpdatePublishStatus={vi.fn()}
      />,
    );
    const group = screen.getByText("「ホームに戻る」ボタン").parentElement!;
    for (const r of within(group).getAllByRole("radio") as HTMLInputElement[]) {
      expect(r.disabled).toBe(true);
    }
  });
});
