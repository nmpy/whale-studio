"use client";

import type { VideoBlockSettings } from "@/types";

export function VideoBlock({ settings }: { settings: VideoBlockSettings }) {
  if (!settings.video_url) return null;

  return (
    <figure className="m-0">
      {/* PR-BLK3: radius を他ブロックに統一・薄い border 追加・caption の admin gray を player トークンへ。
          controls / poster / 挙動は不変。 */}
      <video
        src={settings.video_url}
        poster={settings.poster_url || undefined}
        controls
        className="w-full rounded-[10px] border border-[color:var(--liff-border)] bg-black object-cover"
        style={{ maxHeight: 300 }}
        playsInline
      />
      {settings.caption && (
        <figcaption className="text-[12px] text-[color:var(--liff-tertiary-text,#8C8C8C)] mt-2 text-center break-words">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
