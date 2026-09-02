"use client";

// font_theme="dot" のときだけ読み込む webfont。
//
// このファイルの目的は「@fontsource の CSS を専用チャンクへ切り出すこと」だけ。
// LiffFontThemeAssets から next/dynamic で読み込まれるため、
// dot を選んでいないページのバンドル / CSS には一切乗らない。
//
// DotGothic16 は 400 ウェイトしか持たない（= Light / Bold の別ファイルは存在しない）。
// 「文字の太さ」を bold にした場合はブラウザの合成太字になる。

import "@fontsource/dotgothic16/400.css";

export default function LiffFontDot() {
  return null;
}
