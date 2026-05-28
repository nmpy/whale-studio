// src/app/sitemap.ts
// 公開ページのサイトマップ。現状は LP (/) と料金ページのみ。

import type { MetadataRoute } from "next";

const BASE_URL = "https://whale-studio.app"; // 本番URLに合わせて変更

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE_URL}/`,        lastModified: now, changeFrequency: "weekly",  priority: 1 },
    { url: `${BASE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];
}
