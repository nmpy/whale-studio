// src/__tests__/x-post-intent.test.ts
// X 手動投稿導線の純関数（buildXPostText / buildXIntentUrl / pickTrackingUrl）の検証。
import { describe, it, expect } from "vitest";
import {
  buildXPostText,
  buildXIntentUrl,
  pickTrackingUrl,
  formatHashtagsForPost,
  X_INTENT_BASE,
} from "@/lib/x-posts/intent";

describe("pickTrackingUrl — 計測URL > UTM付きURL > 遷移先URL", () => {
  it("tracking_url を最優先", () => {
    expect(pickTrackingUrl({ tracking_url: "https://t/r/abc", generated_url: "https://g", link_url: "https://l" }))
      .toBe("https://t/r/abc");
  });
  it("tracking_url が無ければ generated_url", () => {
    expect(pickTrackingUrl({ tracking_url: null, generated_url: "https://g", link_url: "https://l" })).toBe("https://g");
  });
  it("両方無ければ link_url", () => {
    expect(pickTrackingUrl({ generated_url: "", link_url: "https://l" })).toBe("https://l");
  });
  it("どれも無ければ空文字", () => {
    expect(pickTrackingUrl({})).toBe("");
  });
});

describe("formatHashtagsForPost — # 補完・空除外", () => {
  it("# なしは補完する", () => {
    expect(formatHashtagsForPost(["謎解き", "LINE"])).toBe("#謎解き #LINE");
  });
  it("# ありはそのまま", () => {
    expect(formatHashtagsForPost(["#謎解き", "#LINE"])).toBe("#謎解き #LINE");
  });
  it("混在・空要素は除外", () => {
    expect(formatHashtagsForPost(["#謎解き", " ", "LINE", ""])).toBe("#謎解き #LINE");
  });
  it("null/空配列は空文字", () => {
    expect(formatHashtagsForPost(null)).toBe("");
    expect(formatHashtagsForPost([])).toBe("");
  });
});

describe("buildXPostText — 本文 / 空行 / 計測URL / 空行 / ハッシュタグ", () => {
  it("本文のみ", () => {
    expect(buildXPostText({ body: "告知です" })).toBe("告知です");
  });
  it("本文 + 計測URL", () => {
    expect(buildXPostText({ body: "告知です", tracking_url: "https://t/r/abc" }))
      .toBe("告知です\n\nhttps://t/r/abc");
  });
  it("本文 + ハッシュタグ（# 補完）", () => {
    expect(buildXPostText({ body: "告知です", hashtags: ["謎解き"] }))
      .toBe("告知です\n\n#謎解き");
  });
  it("本文 + 計測URL + ハッシュタグ（順序と空行）", () => {
    expect(buildXPostText({ body: "告知です", tracking_url: "https://t/r/abc", hashtags: ["#謎解き", "LINE"] }))
      .toBe("告知です\n\nhttps://t/r/abc\n\n#謎解き #LINE");
  });
  it("計測URL 無しなら 本文 + 空行 + ハッシュタグ（URLセクションを詰める）", () => {
    expect(buildXPostText({ body: "告知です", hashtags: ["#謎解き"] }))
      .toBe("告知です\n\n#謎解き");
  });
  it("本文が空でトリムされる", () => {
    expect(buildXPostText({ body: "  ", tracking_url: "https://t/r/abc" })).toBe("https://t/r/abc");
  });
  it("本文内の改行は保持する", () => {
    expect(buildXPostText({ body: "1行目\n2行目", tracking_url: "https://t/r/abc" }))
      .toBe("1行目\n2行目\n\nhttps://t/r/abc");
  });
});

describe("buildXIntentUrl — encodeURIComponent / 改行保持", () => {
  it("X intent のベース URL を使う", () => {
    expect(buildXIntentUrl({ body: "x" }).startsWith(`${X_INTENT_BASE}?text=`)).toBe(true);
  });
  it("text は encodeURIComponent されている（生の空白/#/改行を含まない）", () => {
    const url = buildXIntentUrl({ body: "告知 です", tracking_url: "https://t/r/abc", hashtags: ["#謎解き"] });
    const q = url.slice(url.indexOf("text=") + 5);
    // 生のスペース・# ・改行は残らない
    expect(q).not.toMatch(/[ #\n]/);
    // decode すると buildXPostText と一致
    expect(decodeURIComponent(q)).toBe("告知 です\n\nhttps://t/r/abc\n\n#謎解き");
  });
  it("改行は %0A としてエンコードされ、decode で復元される", () => {
    const url = buildXIntentUrl({ body: "1行目\n2行目" });
    const q = url.slice(url.indexOf("text=") + 5);
    expect(q).toContain("%0A");
    expect(decodeURIComponent(q)).toBe("1行目\n2行目");
  });
});
