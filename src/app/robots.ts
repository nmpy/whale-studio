// src/app/robots.ts
// 公開LP (/) と /pricing をクロール許可し、管理・認証・API 系は明示的に除外する。

import type { MetadataRoute } from "next";

const BASE_URL = "https://whale-studio.app"; // 本番URLに合わせて変更

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/oas", "/onboarding", "/api", "/login", "/settings", "/playground"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
