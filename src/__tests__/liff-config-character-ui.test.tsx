// @vitest-environment jsdom
// src/__tests__/liff-config-character-ui.test.tsx
//
// CMS「キャラクター画像」セクションの UI。
//
// 追加の経緯: この UI を移植した際、画像アップロード欄 (ImageUploadField) を
// 単なる URL テキスト入力に落としてしまい、運用者が画像をアップロードできなくなっていた。
// 設定キー・renderer 側は同じだったため、既存テストでは検出できなかった。
// 「CMS で何ができるか」をここで固定する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import type { LiffPageConfig, LiffPageConfigSettings } from "@/types";

afterEach(cleanup);

const config = (settings: LiffPageConfigSettings = {}): LiffPageConfig =>
  ({
    id: "c1", work_id: "w1", page_type: "default", publish_status: "draft",
    is_enabled: true, title: "テスト", description: null, settings_json: settings,
  }) as unknown as LiffPageConfig;

const draw = (settings?: LiffPageConfigSettings, readOnly = false) => {
  const onLocalChange = vi.fn();
  render(
    <LiffConfigHeader
      config={config(settings)}
      saving={false}
      readOnly={readOnly}
      onToggleEnabled={vi.fn()}
      onLocalChange={onLocalChange}
      onUpdatePageType={vi.fn()}
      onUpdatePublishStatus={vi.fn()}
    />,
  );
  return { onLocalChange };
};

const URL_OK = "https://example.com/dot.png";

describe("キャラクター画像セクション", () => {
  it("独立したカードとして出る", () => {
    draw();
    expect(screen.getByText("キャラクター画像")).toBeTruthy();
  });

  // ここが移植時に落ちた箇所。URL 直接入力だけに退化していないことを固定する。
  it("画像アップロード欄がある（URL 直接入力だけに退化していない）", () => {
    draw();
    // ImageUploadField はファイル選択 input を持つ
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length, "ファイル選択欄が無い＝アップロードできない").toBeGreaterThan(0);
    // URL 直接入力は折りたたみとして併存する
    expect(screen.getByText("URL を直接入力する")).toBeTruthy();
  });

  it("画像が未設定なら詳細項目は出さない", () => {
    draw();
    expect(screen.queryByText("大きさ")).toBeNull();
    expect(screen.queryByText("配置")).toBeNull();
    expect(screen.queryByText("画質（拡大縮小のしかた）")).toBeNull();
    expect(screen.queryByText("代替テキスト（任意）")).toBeNull();
  });

  it("画像を設定すると詳細項目が出る", () => {
    draw({ character_url: URL_OK });
    for (const label of ["大きさ", "配置", "画質（拡大縮小のしかた）", "代替テキスト（任意）"]) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it("固定表示はトグル（Switch）で、注意書きを添える", () => {
    draw({ character_url: URL_OK });
    const sw = screen.getByLabelText("スクロールしても固定表示する");
    expect(sw).toBeTruthy();
    // select ではなくトグルであること
    expect(sw.tagName).not.toBe("SELECT");
    expect(screen.getByText(/LINE は画面上部に標準ヘッダー/)).toBeTruthy();
  });

  // 入力欄と保存バリデーションの上限がズレていると、入力できたのに保存で弾かれる。
  it("代替テキストの maxLength が保存バリデーションと同じ 200", () => {
    draw({ character_url: URL_OK });
    const input = screen.getByPlaceholderText("例: 案内役のドットちゃん") as HTMLInputElement;
    expect(input.maxLength).toBe(200);
  });

  it("選択肢の文言（既定がどれか読める）", () => {
    draw({ character_url: URL_OK });
    for (const t of ["小（48px）", "中（既定・72px）", "大（96px）", "右上（既定）", "左上",
                     "ドット絵（既定・輪郭をぼかさない）", "なめらか（写真・イラスト向け）"]) {
      expect(screen.getByText(t), t).toBeTruthy();
    }
  });

  it("readOnly では操作できない", () => {
    draw({ character_url: URL_OK }, true);
    const input = screen.getByPlaceholderText("例: 案内役のドットちゃん") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
