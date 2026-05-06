"use client";

import type { ImageBlockSettings } from "@/types";

const MAX_HEIGHTS: Record<NonNullable<ImageBlockSettings["size"]>, number> = {
  normal: 300,
  wide:   420,
  full:   720,
};

export function ImageBlock({ settings }: { settings: ImageBlockSettings }) {
  if (!settings.image_url) return null;
  const size = settings.size ?? "normal";
  const maxHeight = MAX_HEIGHTS[size];

  const wrapperCls = size === "full" ? "-mx-4" : "";
  const imgCls = size === "full" ? "w-full object-cover" : "w-full rounded-lg object-cover";

  return (
    <figure className={wrapperCls}>
      <img
        src={settings.image_url}
        alt={settings.alt || ""}
        className={imgCls}
        style={{ maxHeight }}
        loading="lazy"
      />
      {settings.caption && (
        <figcaption className="text-xs text-gray-500 mt-1 text-center break-words">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
