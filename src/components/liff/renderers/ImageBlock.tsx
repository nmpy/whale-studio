"use client";

import type { ImageBlockSettings } from "@/types";

export function ImageBlock({ settings }: { settings: ImageBlockSettings }) {
  if (!settings.image_url) return null;

  return (
    <figure>
      <img
        src={settings.image_url}
        alt={settings.alt || ""}
        className="w-full rounded-lg object-cover"
        style={{ maxHeight: 300 }}
      />
      {settings.caption && (
        <figcaption className="text-xs text-gray-500 mt-1 text-center">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
