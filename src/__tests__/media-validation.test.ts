import { describe, it, expect } from "vitest";
import {
  validateMedia,
  hasBlockingError,
  bigintToJson,
  toBigIntOrNull,
  LINE_VIDEO_MAX_BYTES,
  LINE_IMAGE_MAX_BYTES,
} from "@/lib/media-validation";

describe("validateMedia — line_video 用途", () => {
  const base = {
    mediaKind: "video" as const,
    usage: "line_video" as const,
    contentUrl: "https://cdn.example.com/v.mp4",
    contentMimeType: "video/mp4",
    contentSizeBytes: 100 * 1024 * 1024,
    previewUrl: "https://cdn.example.com/t.jpg",
    previewMimeType: "image/jpeg",
  };

  it("すべて満たせば error なし", () => {
    const issues = validateMedia(base);
    expect(hasBlockingError(issues)).toBe(false);
  });

  it("サムネ未設定は error", () => {
    const issues = validateMedia({ ...base, previewUrl: null });
    expect(hasBlockingError(issues)).toBe(true);
    expect(issues.some((i) => i.code === "preview_required")).toBe(true);
  });

  it("200MB 超は error", () => {
    const issues = validateMedia({ ...base, contentSizeBytes: LINE_VIDEO_MAX_BYTES + 1 });
    expect(issues.some((i) => i.level === "error" && i.code === "video_too_large")).toBe(true);
  });

  it("mp4 以外は error", () => {
    const issues = validateMedia({ ...base, contentMimeType: "video/quicktime" });
    expect(issues.some((i) => i.level === "error" && i.code === "video_not_mp4")).toBe(true);
  });

  it("http（非 https）動画URLは error", () => {
    const issues = validateMedia({ ...base, contentUrl: "http://cdn.example.com/v.mp4" });
    expect(issues.some((i) => i.level === "error" && i.field === "content_url")).toBe(true);
  });

  it("サムネが JPEG/PNG 以外は error", () => {
    const issues = validateMedia({ ...base, previewMimeType: "image/gif" });
    expect(issues.some((i) => i.level === "error" && i.code === "preview_not_image")).toBe(true);
  });

  it("サイズ不明は warning（error にしない）", () => {
    const issues = validateMedia({ ...base, contentSizeBytes: null });
    expect(hasBlockingError(issues)).toBe(false);
    expect(issues.some((i) => i.level === "warning" && i.code === "video_size_unknown")).toBe(true);
  });
});

describe("validateMedia — liff_playback 用途", () => {
  it("200MB 超でも error にしない（warning のみ）", () => {
    const issues = validateMedia({
      mediaKind: "video",
      usage: "liff_playback",
      contentUrl: "https://cdn.example.com/big.mp4",
      contentSizeBytes: LINE_VIDEO_MAX_BYTES * 3,
    });
    expect(hasBlockingError(issues)).toBe(false);
    expect(issues.some((i) => i.level === "warning" && i.code === "liff_large_video")).toBe(true);
  });

  it("サムネ未設定でも error にしない（LINE video 送信しないため）", () => {
    const issues = validateMedia({
      mediaKind: "video",
      usage: "liff_playback",
      contentUrl: "https://cdn.example.com/big.mp4",
    });
    expect(hasBlockingError(issues)).toBe(false);
  });
});

describe("validateMedia — 画像用途", () => {
  it("10MB 超は error", () => {
    const issues = validateMedia({
      mediaKind: "image",
      usage: "line_video", // 画像は用途に関わらず LINE 画像制約（liff/cms 以外）
      contentUrl: "https://cdn.example.com/i.jpg",
      contentMimeType: "image/jpeg",
      contentSizeBytes: LINE_IMAGE_MAX_BYTES + 1,
    });
    expect(issues.some((i) => i.level === "error" && i.code === "image_too_large")).toBe(true);
  });

  it("cms_preview 用途は 10MB 超でも error にしない", () => {
    const issues = validateMedia({
      mediaKind: "image",
      usage: "cms_preview",
      contentUrl: "https://cdn.example.com/i.jpg",
      contentSizeBytes: LINE_IMAGE_MAX_BYTES * 2,
    });
    expect(hasBlockingError(issues)).toBe(false);
  });
});

describe("bigintToJson", () => {
  it("null は null", () => expect(bigintToJson(null)).toBeNull());
  it("safe integer は number", () => expect(bigintToJson(BigInt(123))).toBe(123));
  it("safe 範囲超は string", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10);
    expect(bigintToJson(huge)).toBe(huge.toString());
  });
});

describe("toBigIntOrNull", () => {
  it("number を BigInt へ", () => expect(toBigIntOrNull(200)).toBe(BigInt(200)));
  it("数値文字列を BigInt へ", () => expect(toBigIntOrNull("200")).toBe(BigInt(200)));
  it("負数は null", () => expect(toBigIntOrNull(-1)).toBeNull());
  it("非数値文字列は null", () => expect(toBigIntOrNull("abc")).toBeNull());
  it("null/undefined は null", () => {
    expect(toBigIntOrNull(null)).toBeNull();
    expect(toBigIntOrNull(undefined)).toBeNull();
  });
});
