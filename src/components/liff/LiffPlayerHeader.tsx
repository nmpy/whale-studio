"use client";

// src/components/liff/LiffPlayerHeader.tsx
//
// LIFF プレイヤー画面用の共通ヘッダー。
// 表示文言は CMS で編集可能。優先順位:
//   1. settings.header_title (CMS で「ヘッダータイトル」として編集)
//   2. workTitle (作品名)
//   3. pageTitle (LIFF ページ名)
//   4. "LIFF" (最終 fallback)
//
// 旧 API (workTitle / pageTitle / title prop のみ) も互換維持する。

import type { LiffPageConfigSettings } from "@/types";
import { resolveHeaderTitle } from "./liff-style-helpers";

interface Props {
  /** ページ設定 (CMS の header_title を参照する) */
  settings?:  LiffPageConfigSettings | null;
  /** 作品名 (settings.header_title 未設定時の 1 つ目フォールバック) */
  workTitle?: string | null;
  /** LIFF ページ名 (workTitle も無いときのフォールバック) */
  pageTitle?: string | null;
  /** 互換用エイリアス: 旧 API。pageTitle 相当として扱う */
  title?: string | null;
}

export function LiffPlayerHeader({ settings, workTitle, pageTitle, title }: Props) {
  const shown = resolveHeaderTitle({
    settings,
    workTitle,
    pageTitle: pageTitle ?? title,
  });
  return (
    <header
      className="px-4 h-14 flex items-center justify-center border-b"
      style={{
        background: "var(--liff-header-bg)",
        color: "var(--liff-header-text)",
        borderColor: "var(--liff-header-border)",
      }}
    >
      <div className="max-w-md mx-auto w-full">
        {/* 白背景 + 薄罫線 + 17px 中央寄せ。緑帯は使わない。
            長すぎる場合は省略 (truncate) する。 */}
        <h1 className="text-[17px] leading-tight font-bold text-center truncate">
          {shown}
        </h1>
      </div>
    </header>
  );
}
