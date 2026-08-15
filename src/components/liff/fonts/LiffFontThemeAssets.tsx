"use client";

// font_theme に応じて **必要な webfont の CSS だけ** を後から読み込むローダー。
//
// 置き場所:
//   LiffSinglePageRenderer と LiffMenuHomeRenderer の root に 1 つずつ。
//   テーマを持つ renderer はすべてこの 2 つのどちらかを経由するため（player の
//   /liff/w/[workPublicId]/... 系 2 ルートと、CMS の LiffPreview の両方）、
//   この 2 か所で player / preview の全経路をカバーできる。
//
// 設計上の約束:
//   - default / gothic / modern（= LINE Seed JP / Noto Sans JP / システムフォント）は
//     /liff/layout.tsx が常時 import 済みなので、ここでは何もロードしない。
//   - rounded / classic だけ next/dynamic で別チャンクを取りに行く。
//   - `ssr: false` にしてあるので SSR では何も出力されず、hydration mismatch が起きない。
//     どちらの分岐でも DOM 出力は null なので、描画結果にも差は出ない。
//   - 同じチャンクは webpack 側で 1 度しか評価されない（= <link> の重複挿入は起きない）。
//   - CMS プレビューでテーマを切り替えると props が変わり、必要なチャンクが追加で読まれる。
//     切替前のフォント CSS は @font-face 宣言が残るだけで、実描画は
//     --liff-font-stack が決めるため副作用はない。

import dynamic from "next/dynamic";
import type { LiffPageConfigSettings } from "@/types";
import { resolveFontTheme } from "../liff-style-helpers";

const LiffFontRounded = dynamic(() => import("./LiffFontRounded"), { ssr: false });
const LiffFontClassic = dynamic(() => import("./LiffFontClassic"), { ssr: false });

export function LiffFontThemeAssets({ settings }: { settings?: LiffPageConfigSettings | null }) {
  const theme = resolveFontTheme(settings ?? undefined);
  if (theme === "rounded") return <LiffFontRounded />;
  if (theme === "classic") return <LiffFontClassic />;
  return null;
}
