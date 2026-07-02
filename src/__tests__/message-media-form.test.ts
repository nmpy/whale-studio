import { describe, it, expect } from "vitest";
import {
  parseSizeString,
  resolveVideoUsage,
  resolveVideoFormIssues,
  videoFormSaveError,
  probeResultToForm,
  type VideoMediaForm,
} from "@/lib/message-media-form";
import { LINE_VIDEO_MAX_BYTES } from "@/lib/media-validation";

function form(overrides: Partial<VideoMediaForm>): VideoMediaForm {
  return {
    message_type: "video",
    asset_url: "https://cdn.example.com/v.mp4",
    asset_media_source: "external_url",
    asset_preview_url: "https://cdn.example.com/t.jpg",
    asset_usage: "line_video",
    asset_mime_type: "video/mp4",
    asset_file_size_bytes: String(50 * 1024 * 1024),
    ...overrides,
  };
}

describe("parseSizeString", () => {
  it("数値文字列 → number", () => expect(parseSizeString("12345")).toBe(12345));
  it("空 → null", () => expect(parseSizeString("")).toBeNull());
  it("非数値 → null", () => expect(parseSizeString("12.3")).toBeNull());
});

describe("resolveVideoUsage", () => {
  it('"" は line_video 相当', () => expect(resolveVideoUsage({ asset_usage: "" })).toBe("line_video"));
  it("liff_playback はそのまま", () => expect(resolveVideoUsage({ asset_usage: "liff_playback" })).toBe("liff_playback"));
});

describe("resolveVideoFormIssues", () => {
  it("video 以外は []", () => {
    expect(resolveVideoFormIssues(form({ message_type: "image" }))).toEqual([]);
  });

  it("line_video で全部揃えば error なし", () => {
    const issues = resolveVideoFormIssues(form({}));
    expect(issues.some((i) => i.level === "error")).toBe(false);
  });

  it("line_video でサムネ未設定は error", () => {
    const issues = resolveVideoFormIssues(form({ asset_preview_url: "" }));
    expect(issues.some((i) => i.level === "error" && i.code === "preview_required")).toBe(true);
  });

  it("line_video で 200MB 超は error", () => {
    const issues = resolveVideoFormIssues(form({ asset_file_size_bytes: String(LINE_VIDEO_MAX_BYTES + 1) }));
    expect(issues.some((i) => i.level === "error" && i.code === "video_too_large")).toBe(true);
  });

  it("liff_playback は 200MB 超でも error なし（warning）", () => {
    const issues = resolveVideoFormIssues(form({ asset_usage: "liff_playback", asset_file_size_bytes: String(LINE_VIDEO_MAX_BYTES * 3) }));
    expect(issues.some((i) => i.level === "error")).toBe(false);
    expect(issues.some((i) => i.level === "warning" && i.code === "liff_large_video")).toBe(true);
  });
});

describe("videoFormSaveError（external_url のみブロック）", () => {
  it("external_url + サムネ未設定 → ブロック（文言あり）", () => {
    expect(videoFormSaveError(form({ asset_preview_url: "" }))).not.toBeNull();
  });

  it("external_url + 200MB 超 → ブロック", () => {
    expect(videoFormSaveError(form({ asset_file_size_bytes: String(LINE_VIDEO_MAX_BYTES + 1) }))).not.toBeNull();
  });

  it("upload（既存動画）+ サムネ未設定 → ブロックしない（警告のみ）", () => {
    expect(videoFormSaveError(form({ asset_media_source: "upload", asset_preview_url: "" }))).toBeNull();
  });

  it("空 source（既存 null）+ サムネ未設定 → ブロックしない", () => {
    expect(videoFormSaveError(form({ asset_media_source: "", asset_preview_url: "" }))).toBeNull();
  });

  it("external_url + liff_playback + 200MB 超 → ブロックしない（保存可能）", () => {
    expect(videoFormSaveError(form({ asset_usage: "liff_playback", asset_file_size_bytes: String(LINE_VIDEO_MAX_BYTES * 3), asset_preview_url: "" }))).toBeNull();
  });

  it("video 以外は null", () => {
    expect(videoFormSaveError(form({ message_type: "text" }))).toBeNull();
  });
});

describe("probeResultToForm", () => {
  it("既知サイズ → mime と size 文字列", () => {
    expect(probeResultToForm({ mimeType: "video/mp4", sizeKnown: true, sizeBytes: 123 })).toEqual({
      asset_mime_type: "video/mp4",
      asset_file_size_bytes: "123",
    });
  });

  it("サイズ不明 → size は空文字", () => {
    expect(probeResultToForm({ mimeType: "video/mp4", sizeKnown: false, sizeBytes: null })).toEqual({
      asset_mime_type: "video/mp4",
      asset_file_size_bytes: "",
    });
  });
});
