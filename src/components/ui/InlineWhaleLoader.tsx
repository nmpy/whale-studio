// src/components/ui/InlineWhaleLoader.tsx
// 局所（非fullScreen）ローディング用の薄いラッパー。
// テーブルセル・カード内・パネル内など「周囲UIは隠さず、その領域内中央」に
// WhaleLoader を小さく出す用途。ページ全体ゲートは <WhaleLoader fullScreen /> を使う。
//
// 方針:
//   - 中央寄せは inline style（grid + place-items）で完結（globals.css は変更しない）。
//   - size="sm"（28px）+ label=""（whale + ドットのみ。a11y は WhaleLoader が
//     role="status" / aria-label="読み込み中" を自動付与）。

import type { CSSProperties } from "react";
import { WhaleLoader } from "./WhaleLoader";

export interface InlineWhaleLoaderProps {
  /** ラッパーへの追加クラス。 */
  className?: string;
  /** 表示領域の最小高さ（潰れ防止に任意指定）。 */
  minHeight?: number | string;
  /** 表示領域の余白（任意。既定はやや控えめ）。 */
  padding?: number | string;
}

export function InlineWhaleLoader({
  className = "",
  minHeight,
  padding = 24,
}: InlineWhaleLoaderProps) {
  const style: CSSProperties = {
    display: "grid",
    placeItems: "center",
    padding,
    ...(minHeight !== undefined ? { minHeight } : {}),
  };

  return (
    <div className={className} style={style}>
      <WhaleLoader size="sm" label="" />
    </div>
  );
}

export default InlineWhaleLoader;
