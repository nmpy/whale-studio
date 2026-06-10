// src/__tests__/liff-copy.test.ts
// 体験者向け LIFF（チェックイン）のページレベル文言・プレゼンテーション解決。

import { describe, it, expect } from "vitest";
import {
  resolveLiffErrorPresentation,
  resolveCheckinResultPresentation,
  LIFF_LOADING_COPY,
} from "@/lib/liff/copy";

describe("resolveLiffErrorPresentation", () => {
  it("技術コードを直接出さず、やわらかいタイトルへ変換する", () => {
    expect(resolveLiffErrorPresentation("NOT_IN_LINE").title).toBe("LINE で開いてください");
    expect(resolveLiffErrorPresentation("MISSING_PARAMS").title).toBe("このページはチェックイン用です");
    expect(resolveLiffErrorPresentation("SCENARIO_NOT_STARTED").title).toBe("作品がまだ始まっていません");
  });

  it("SCENARIO_NOT_STARTED は info + 「LINEのトークに戻る」", () => {
    const p = resolveLiffErrorPresentation("SCENARIO_NOT_STARTED");
    expect(p.variant).toBe("info");
    expect(p.closeLabel).toBe("LINEのトークに戻る");
  });

  it("未知コードは error + 汎用タイトル（生コードを露出しない）", () => {
    const p = resolveLiffErrorPresentation("SOME_INTERNAL_CODE_XYZ");
    expect(p.variant).toBe("error");
    expect(p.title).toBe("うまく開けませんでした");
    expect(p.title).not.toContain("XYZ");
    expect(p.closeLabel).toBe("閉じる");
  });

  it("設定系（NO_LIFF_ID / LIFF_INIT_FAILED）は warning", () => {
    expect(resolveLiffErrorPresentation("NO_LIFF_ID").variant).toBe("warning");
    expect(resolveLiffErrorPresentation("LIFF_INIT_FAILED").variant).toBe("warning");
  });
});

describe("resolveCheckinResultPresentation", () => {
  it("checked_in → success", () => {
    expect(resolveCheckinResultPresentation("checked_in").variant).toBe("success");
  });
  it("cooldown → info", () => {
    expect(resolveCheckinResultPresentation("cooldown").variant).toBe("info");
  });
  it("out_of_range / その他 → warning", () => {
    expect(resolveCheckinResultPresentation("out_of_range").variant).toBe("warning");
    expect(resolveCheckinResultPresentation("whatever").variant).toBe("warning");
  });
});

describe("LIFF_LOADING_COPY", () => {
  it("準備中の文言を持つ", () => {
    expect(LIFF_LOADING_COPY.title).toBe("準備しています");
    expect(LIFF_LOADING_COPY.description).toBeTruthy();
  });
});
