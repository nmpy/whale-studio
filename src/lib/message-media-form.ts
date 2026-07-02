// src/lib/message-media-form.ts
// CMS メッセージフォームの「動画メディア」欄で使う純粋ヘルパー（React 非依存＝テスト可能）。
// バリデーション本体は media-validation.ts（サーバと同一）を再利用する。

import { validateMedia, type MediaValidationIssue, type MediaUsage } from "./media-validation";

/** 動画メディア欄が参照するフォーム値のサブセット。 */
export type VideoMediaForm = {
  message_type:          string;
  asset_url:             string;
  asset_media_source:    string; // "" | "upload" | "external_url"
  asset_preview_url:     string;
  asset_usage:           string; // "" | "line_video" | "liff_playback" | "cms_preview"
  asset_mime_type:       string;
  asset_file_size_bytes: string; // "" = 不明
};

/** フォームのサイズ文字列を number|null へ（safe integer・非負のみ）。 */
export function parseSizeString(s: string | null | undefined): number | null {
  const t = (s ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * フォームの用途を解決する。"" は後方互換のため line_video 相当として扱う
 * （既存動画は LINE 動画想定。UI 表示・検証ともにこの解釈で統一）。
 */
export function resolveVideoUsage(form: Pick<VideoMediaForm, "asset_usage">): MediaUsage {
  return form.asset_usage === "liff_playback" || form.asset_usage === "cms_preview"
    ? form.asset_usage
    : "line_video";
}

/**
 * 動画メッセージの用途別検証（表示用）。message_type!=="video" は []。
 * validateMedia（サーバと同一ルール）に委譲する。
 */
export function resolveVideoFormIssues(form: VideoMediaForm): MediaValidationIssue[] {
  if (form.message_type !== "video") return [];
  return validateMedia({
    mediaKind:        "video",
    usage:            resolveVideoUsage(form),
    contentUrl:       form.asset_url || null,
    contentMimeType:  form.asset_mime_type || null,
    contentSizeBytes: parseSizeString(form.asset_file_size_bytes),
    previewUrl:       form.asset_preview_url || null,
  });
}

/**
 * 保存をブロックすべきエラー文言（なければ null）。
 * サーバ (PR2) と同じく asset_media_source="external_url" のときのみブロックする。
 * アップロード/既存動画（source が upload/空）はブロックせず、警告表示に留めて保存を許可する
 * （= 既存動画は後からサムネイルを追加できる / 既存アップロード導線を壊さない）。
 */
export function videoFormSaveError(form: VideoMediaForm): string | null {
  if (form.message_type !== "video") return null;
  if (form.asset_media_source !== "external_url") return null;
  const err = resolveVideoFormIssues(form).find((i) => i.level === "error");
  return err ? err.message : null;
}

/** probe 結果をフォームの mime / size 文字列へ変換する。 */
export function probeResultToForm(probe: {
  mimeType: string | null;
  sizeKnown: boolean;
  sizeBytes: number | string | null;
}): { asset_mime_type: string; asset_file_size_bytes: string } {
  return {
    asset_mime_type:       probe.mimeType ?? "",
    asset_file_size_bytes: probe.sizeKnown && probe.sizeBytes != null ? String(probe.sizeBytes) : "",
  };
}
