"use client";

// src/components/x-posts/XPostButton.tsx
// 作成済み X投稿を、X の投稿作成画面（Web Intent）で開く手動投稿ボタン。
// 一覧カード / 編集プレビューで共用する（テキスト組み立ては @/lib/x-posts/intent に集約）。
// X API を使った自動投稿ではない。押下自体はクリック計測しない（別タブで投稿画面を開くだけ）。

import { buildXIntentUrl, pickTrackingUrl, type XPostIntentInput } from "@/lib/x-posts/intent";

export function XPostButton({
  post,
  label = "Xに投稿",
  className = "",
  disabledReason,
}: {
  post: XPostIntentInput;
  label?: string;
  className?: string;
  /** 追加の無効理由（例: 新規で保存前）。指定時は本文有無に関わらず無効化し、title に出す。 */
  disabledReason?: string | null;
}) {
  const bodyEmpty = (post.body || "").trim().length === 0;
  const trackingMissing = pickTrackingUrl(post) === "";
  const disabled = bodyEmpty || !!disabledReason;
  // サブアクション（primary緑ではなく、X導線として自然な sky 系の控えめな見た目）。
  const base = `btn btn-ghost btn-sm inline-flex items-center gap-1 ${className}`;

  if (disabled) {
    const title = disabledReason || "投稿本文を入力してください";
    return (
      <button type="button" disabled title={title} aria-label={`${label}（${title}）`}
        className={base} style={{ color: "#0284c7", opacity: 0.5, cursor: "not-allowed" }}>
        {label} <span aria-hidden>↗</span>
      </button>
    );
  }

  return (
    <a
      href={buildXIntentUrl(post)}
      target="_blank"
      rel="noopener noreferrer"
      title={trackingMissing ? "計測URLが未生成のため、クリック計測はできません" : "X（別タブ）で投稿画面を開きます"}
      className={base}
      style={{ color: "#0284c7" }}
    >
      {label} <span aria-hidden>↗</span>
    </a>
  );
}
