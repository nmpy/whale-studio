"use client";

import type { VideoBlockSettings } from "@/types";

export function VideoBlock({ settings }: { settings: VideoBlockSettings }) {
  if (!settings.video_url) return null;

  return (
    <figure>
      <video
        src={settings.video_url}
        poster={settings.poster_url || undefined}
        controls
        className="w-full rounded-lg"
        style={{ maxHeight: 300 }}
        playsInline
      />
      {settings.caption && (
        <figcaption className="text-xs text-gray-500 mt-1 text-center">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
