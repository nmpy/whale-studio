// src/components/liff/LiffPageCharacter.tsx
//
// ページ隅に置く装飾キャラクター画像（例: ドットちゃん）。
//
// 設計上の約束:
//   - `character_url` が無ければ **null を返し、DOM を 1 要素も出さない**。
//     未設定の既存ページに影響を与えないための最重要の不変条件。
//   - レイヤーは高さ 0 + `pointer-events: none`。本文のレイアウトを押し下げず、
//     タップも吸わない（キャラの下にあるボタンが押せなくならない）。
//   - 位置はコンテンツ列（max-width 448px + 左右 padding）に揃える。
//     `--liff-page-pad-x` を読むので「画面左右の余白」の設定にも追従する。
//   - `next/image` は使わない。LIFF は素の <img> で統一している
//     （最適化を挟むと Cloudinary の元画像がそのまま出なくなるため）。
//   - alt 未設定なら装飾扱い（alt="" + aria-hidden）。読み上げ対象にしない。
//
// 固定表示 (`character_fixed`) について:
//   実機 LIFF は上部に LINE 標準ヘッダー（閉じる / 戻る）があり、端末差で高さが変わる。
//   重なり事故が読めないため既定は false（= コンテンツと一緒にスクロールする）。
//   true のときは safe-area を見て上端を下げる（CSS 側で `env(safe-area-inset-top)`）。

import type { LiffPageConfigSettings } from "@/types";
import {
  characterImageClass,
  characterLayerClass,
  resolveCharacterFixed,
  resolveCharacterPosition,
  resolveCharacterRendering,
  resolveCharacterUrl,
} from "./liff-style-helpers";

export function LiffPageCharacter({ settings }: { settings?: LiffPageConfigSettings | null }) {
  const s = settings ?? undefined;
  const url = resolveCharacterUrl(s);
  if (!url) return null;

  const alt = s?.character_alt?.trim();
  const decorative = !alt;

  return (
    <div className={characterLayerClass(resolveCharacterFixed(s))} aria-hidden={decorative || undefined}>
      <div className="liff-character-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt ?? ""}
          className={characterImageClass(
            resolveCharacterPosition(s),
            resolveCharacterRendering(s),
          )}
        />
      </div>
    </div>
  );
}
