/**
 * restore-video-message.test.ts
 *
 * 本番 hotfix: アップロード済み動画（Cloudinary mp4 等）が LINE の video message として
 * 直接再生できる形で送られること（PR #501 で text リンク誘導に落ちた本番不具合の復旧）。
 *
 * 対象シナリオ（報告された本番ケース）:
 *   - CMS 上で動画を直接添付（asset_media_source=upload / asset_usage=null / サムネ未設定）
 *   - 期待: type:"video" / originalContentUrl=Cloudinary mp4 / previewImageUrl=有効な https URL
 *   - NG:   「動画はこちらからご覧いただけます https://...」の text
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildKeywordMessages, buildPhaseMessages, cloudinaryVideoPosterUrl, type KeywordMessageRecord } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const CLOUDINARY_MP4 =
  "https://res.cloudinary.com/duvd61vx6/video/upload/v1782649267/LP-%E5%8B%95%E7%94%BB_angpxg.mp4";

function kwMsg(overrides: Partial<KeywordMessageRecord> = {}): KeywordMessageRecord {
  return {
    id: "kw-1", messageType: "text", body: null, assetUrl: null, altText: null,
    flexPayloadJson: null, quickReplies: null, nextMessageId: null, sortOrder: 0, character: null,
    ...overrides,
  };
}
function phaseMsg(overrides: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage {
  return {
    id: "pm-1", kind: "normal", message_type: "text", body: null, asset_url: null,
    alt_text: null, flex_payload_json: null, quick_replies: null, lag_ms: 0,
    hint_mode: "always", sort_order: 0, timing: null,
    tap_destination_id: null, tap_url: null,
    image_action_type: null, image_action_text: null, image_action_url: null,
    image_action_liff_page_id: null, image_action_postback_data: null,
    character: null,
    ...overrides,
  };
}
function phase(msgs: RuntimePhaseMessage[]): RuntimePhase {
  return { id: "p1", phase_type: "normal", name: "t", description: null, messages: msgs, transitions: null };
}

describe("cloudinaryVideoPosterUrl — 動画URLから画像フレームURLを生成", () => {
  it("Cloudinary 動画URL(.mp4) → 画像フレーム(.jpg)URL（mp4 を流用しない）", () => {
    const poster = cloudinaryVideoPosterUrl(CLOUDINARY_MP4);
    expect(poster).not.toBeNull();
    expect(poster).not.toBe(CLOUDINARY_MP4);
    expect(poster!.endsWith(".jpg")).toBe(true);          // 画像拡張子
    expect(/\.mp4($|\?)/i.test(poster!)).toBe(false);      // mp4 が残っていない
    expect(poster!.startsWith("https://res.cloudinary.com/")).toBe(true);
    expect(poster).toContain("/video/upload/");            // Cloudinary の変換URL
  });

  it("非 Cloudinary 動画URL は null（呼び出し元でフォールバック）", () => {
    expect(cloudinaryVideoPosterUrl("https://cdn.example.com/v.mp4")).toBeNull();
    expect(cloudinaryVideoPosterUrl("https://res.cloudinary.com/x/image/upload/a.jpg")).toBeNull();
    expect(cloudinaryVideoPosterUrl(null)).toBeNull();
  });
});

describe("hotfix: アップロード済み Cloudinary mp4 の動画メッセージ", () => {
  it("keyword: サムネ未設定でも video message、previewImageUrl は生成した画像URL（mp4 を流用しない）", () => {
    const result = buildKeywordMessages([kwMsg({ messageType: "video", assetUrl: CLOUDINARY_MP4 })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
    const vid = result[0] as { originalContentUrl: string; previewImageUrl: string };
    expect(vid.originalContentUrl).toBe(CLOUDINARY_MP4);
    // previewImageUrl は https の画像URL、かつ originalContentUrl(mp4) と同一でないこと
    expect(/^https:\/\//.test(vid.previewImageUrl)).toBe(true);
    expect(vid.previewImageUrl).not.toBe(vid.originalContentUrl);
    expect(vid.previewImageUrl.endsWith(".jpg")).toBe(true);
    // 「動画はこちらからご覧いただけます」の text に落ちていないこと
    expect((result[0] as { text?: string }).text).toBeUndefined();
  });

  it("phase: サムネ未設定でも video message、previewImageUrl は画像フレームURL", () => {
    const result = buildPhaseMessages(phase([phaseMsg({ message_type: "video", asset_url: CLOUDINARY_MP4 })]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
    const vid = result[0] as { originalContentUrl: string; previewImageUrl: string };
    expect(vid.originalContentUrl).toBe(CLOUDINARY_MP4);
    expect(vid.previewImageUrl).not.toBe(CLOUDINARY_MP4);
    expect(vid.previewImageUrl.endsWith(".jpg")).toBe(true);
  });

  it("専用サムネ(https)があれば previewImageUrl はサムネを優先（生成より優先）", () => {
    const result = buildKeywordMessages([kwMsg({
      messageType: "video", assetUrl: CLOUDINARY_MP4, assetPreviewUrl: "https://cdn.example.com/thumb.jpg",
    })]);
    const vid = result[0] as { type: string; previewImageUrl: string };
    expect(vid.type).toBe("video");
    expect(vid.previewImageUrl).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("非Cloudinary動画・サムネ未設定は最後の手段として asset_url を使う（video は維持・text にしない）", () => {
    const result = buildKeywordMessages([kwMsg({ messageType: "video", assetUrl: "https://cdn.example.com/v.mp4" })]);
    expect(result[0].type).toBe("video");
    expect((result[0] as { previewImageUrl: string }).previewImageUrl).toBe("https://cdn.example.com/v.mp4");
  });
});

describe("既存の外部URL/LIFF再生 fallback は維持（回帰防止）", () => {
  it("asset_usage=liff_playback は LINE video を送らずリンク誘導テキスト", () => {
    const result = buildKeywordMessages([kwMsg({
      messageType: "video", assetUrl: "https://cdn.example.com/big.mp4", assetUsage: "liff_playback",
    })]);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toContain("https://cdn.example.com/big.mp4");
  });
});

describe("他メッセージ種別の回帰確認", () => {
  it("image は従来どおり image message", () => {
    const result = buildKeywordMessages([kwMsg({ messageType: "image", assetUrl: "https://cdn.example.com/i.jpg" })]);
    expect(result[0].type).toBe("image");
  });
  it("text は従来どおり text message", () => {
    const result = buildKeywordMessages([kwMsg({ messageType: "text", body: "こんにちは" })]);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("こんにちは");
  });
  it("video + asset_url なし（非puzzle）は従来どおり skip(null=0通)＝Transition フォールスルーの本数を維持", () => {
    const result = buildKeywordMessages([kwMsg({ messageType: "video", assetUrl: null })]);
    expect(result).toHaveLength(0);
  });
});
