"use client";

// src/components/x-posts/XPostPreviewCard.tsx
// X投稿タブの編集フォーム右側に表示する、X投稿カード風の簡易プレビュー。
// 入力中の state をそのまま受け取りリアルタイム反映する（保存不要）。
// 完全再現ではなく Whale Studio 管理画面トーンの簡易表現。X ロゴ等は使わない。

import type { XPostStatus } from "@/types";
import { XPostButton } from "@/components/x-posts/XPostButton";
import { pickTrackingUrl, type XPostIntentInput } from "@/lib/x-posts/intent";

const STATUS_LABEL: Record<XPostStatus, string> = {
  draft: "下書き", scheduled: "予約", posted: "投稿済み", archived: "アーカイブ",
};

const MAX_CHARS = 280;

export interface XPostPreviewCardProps {
  body: string;
  hashtags: string[];
  imageUrl?: string;
  uploadedImageUrl?: string;
  linkUrl?: string;
  generatedUrl?: string;
  trackingUrl?: string | null;
  status?: XPostStatus;
  /**
   * 「この内容でXに投稿」導線用の保存済みデータ。
   *   - object: そのデータで手動投稿ボタンを表示（編集中の未保存 state ではなく保存済み値）。
   *   - null:   ボタンは表示するが無効（savedPostDisabledReason を理由に）。新規・保存前など。
   *   - undefined: 導線セクション自体を表示しない（従来どおり）。
   */
  savedPost?: XPostIntentInput | null;
  savedPostDisabledReason?: string | null;
  /** 未保存の変更がある場合に true。保存を促す注意文言を出す。 */
  unsavedChanges?: boolean;
}

export function XPostPreviewCard({
  body,
  hashtags,
  imageUrl = "",
  uploadedImageUrl = "",
  linkUrl = "",
  generatedUrl = "",
  trackingUrl = null,
  status = "draft",
  savedPost,
  savedPostDisabledReason = null,
  unsavedChanges = false,
}: XPostPreviewCardProps) {
  // 画像: アップロード画像 > 画像URL の優先順位。
  const displayImage = (uploadedImageUrl || "").trim() || (imageUrl || "").trim();
  // リンク: 計測URL > UTM付きURL > 遷移先URL の優先順位。
  const displayUrl = (trackingUrl || "").trim() || (generatedUrl || "").trim() || (linkUrl || "").trim();
  const tags = hashtags.filter(Boolean);
  const hashtagLine = tags.length > 0 ? tags.join(" ") : "";
  const hasBody = body.trim().length > 0;

  // 概算文字数（本文 + ハッシュタグ + URL）。日本語カウントや X の URL 短縮の厳密仕様は再現しない。
  const counted = [body, hashtagLine, displayUrl].filter((s) => s && s.length > 0).join("\n");
  const charCount = [...counted].length;
  const over = charCount > MAX_CHARS;

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-ink">X投稿プレビュー</p>
        <span className="rounded-full bg-bg-tint px-2 py-0.5 text-[11px] font-semibold text-ink-2">{STATUS_LABEL[status]}</span>
      </div>

      {!hasBody ? (
        <div className="rounded-field border border-dashed border-line bg-bg-tint px-4 py-8 text-center text-[12px] text-ink-3">
          投稿本文を入力すると、ここにプレビューが表示されます。
        </div>
      ) : (
        <div className="rounded-field border border-line bg-white p-3">
          <div className="flex items-start gap-2.5">
            {/* アバター placeholder */}
            <div className="h-10 w-10 flex-shrink-0 rounded-full bg-bg-tint" aria-hidden />
            <div className="min-w-0 flex-1">
              {/* 表示名 / handle placeholder */}
              <div className="flex flex-wrap items-center gap-x-1 text-[13px] leading-tight">
                <span className="font-bold text-ink">Whale Studio</span>
                <span className="text-ink-3">@your_account</span>
              </div>

              {/* 投稿本文 */}
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-ink">{body}</p>

              {/* ハッシュタグ */}
              {tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-[13px] text-sky-ink">
                  {tags.map((t) => <span key={t} className="break-words">{t}</span>)}
                </div>
              )}

              {/* 画像（角丸・未入力なら非表示）。見た目上はここで止める。 */}
              {displayImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayImage}
                  alt=""
                  className="mt-2 max-h-[220px] w-full rounded-field border border-line object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 文字数 + 注記 */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className={over ? "font-semibold text-warn" : "text-ink-3"}>{charCount} / {MAX_CHARS}</span>
        <span className="text-ink-3">実際のX上の表示とは異なる場合があります。</span>
      </div>
      {over && (
        <p className="mt-1 text-[11px] font-semibold text-warn">280文字を超えています。投稿前に調整してください。</p>
      )}

      {/* 手動投稿導線（保存済みデータで X の投稿作成画面を開く）。プレビュー確認直後に投稿できる。 */}
      {savedPost !== undefined && (
        <div className="mt-3 border-t border-line-2 pt-3">
          <XPostButton
            post={savedPost ?? {}}
            label="この内容でXに投稿"
            className="w-full justify-center"
            disabledReason={savedPost === null ? savedPostDisabledReason : undefined}
          />
          {unsavedChanges && (
            <p className="mt-1.5 text-[11px] text-warn">未保存の変更があります。保存すると投稿内容に反映されます。</p>
          )}
          {savedPost && pickTrackingUrl(savedPost) === "" && (
            <p className="mt-1.5 text-[11px] text-ink-3">計測URLが未生成のため、クリック計測はできません。</p>
          )}
        </div>
      )}
    </div>
  );
}
