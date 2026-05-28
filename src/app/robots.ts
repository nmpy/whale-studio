// src/app/robots.ts
// app.whale-studio.app は管理アプリ（管理画面・ログイン・onboarding・admin）。
// 公開 LP は STUDIO 側（whale-studio.app）で運用するため、本アプリは
// 検索インデックス対象にしない（全URLをクロール拒否）。

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
