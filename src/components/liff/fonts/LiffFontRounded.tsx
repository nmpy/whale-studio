"use client";

// font_theme="rounded" のときだけ読み込む webfont。
//
// このファイルの目的は「@fontsource の CSS を専用チャンクへ切り出すこと」だけ。
// LiffFontThemeAssets から next/dynamic で読み込まれるため、
// rounded を選んでいないページのバンドル / CSS には一切乗らない。
//
// 日本語 fontsource の CSS は @font-face が 126 個（unicode-range で subset 分割）あり、
// 4 ファイルを常時 import すると LIFF 全ページの CSS が gzip +129KB になっていた。
// 実フォント本体は使われた subset だけが取得されるので、CSS の遅延化だけで効果が出る。

import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/m-plus-rounded-1c/700.css";

export default function LiffFontRounded() {
  return null;
}
