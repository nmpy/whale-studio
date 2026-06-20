"use client";

import { useState } from "react";
import type { ImageBlockSettings } from "@/types";

const MAX_HEIGHTS: Record<NonNullable<ImageBlockSettings["size"]>, number> = {
  normal: 300,
  wide:   420,
  full:   560,
};

export function ImageBlock({ settings }: { settings: ImageBlockSettings }) {
  const [failed, setFailed] = useState(false);
  if (!settings.image_url) return null;
  const size = settings.size ?? "normal";
  const maxHeight = MAX_HEIGHTS[size];

  return (
    <figure className="m-0">
      {failed ? (
        // 読み込み失敗時のフォールバック（白画面/壊れアイコンを避け、角丸プレースホルダを出す）。
        <div
          className="w-full rounded-[10px] border border-[color:var(--liff-border)] bg-[color:var(--liff-surface-subtle,#FAFAFA)] flex flex-col items-center justify-center gap-1 text-[color:var(--liff-tertiary-text,#8C8C8C)]"
          style={{ height: Math.min(180, maxHeight) }}
        >
          <span style={{ fontSize: 24 }} aria-hidden>🖼</span>
          <span className="text-[12px]">画像を読み込めませんでした</span>
        </div>
      ) : (
        <img
          src={settings.image_url}
          alt={settings.alt || ""}
          className="w-full max-w-full rounded-[10px] border border-[color:var(--liff-border)] shadow-[var(--liff-ui-card-shadow)] object-cover bg-[color:var(--liff-surface-subtle,#FAFAFA)]"
          style={{ maxHeight }}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {settings.caption && (
        <figcaption className="text-[12px] text-[color:var(--liff-tertiary-text,#8C8C8C)] mt-2 text-center break-words">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
