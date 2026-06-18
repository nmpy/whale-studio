// src/components/liff/ui/LiffPageShell.tsx
//
// LIFF 新UI: プレイヤー各画面の共通シェル。
//   root `.liff-font` ラッパー + `.liff-player-main` + 任意の Powered by フッター を 1 か所に集約する。
//   各 renderer がコピペしている root/main の className を将来 DRY 化するための土台（このPRでは未配線）。
//
// 既存挙動を壊さないため:
//   - フォント preset は既存 liffRootClass(settings) をそのまま使う。
//   - フッターは既存 shouldShowWhaleStudioCredit / LiffStudioFooter を再利用（二重実装しない）。
//   - CMS ブランド / ローダーは一切持ち込まない。
//
// 使用例（PR2 以降）:
//   <LiffPageShell settings={settings}>
//     <LiffPageHeader title="アンケート" description={desc} settings={settings} />
//     ...questions...
//   </LiffPageShell>

import type { ReactNode } from "react";
import type { LiffPageConfigSettings } from "@/types";
import { liffRootClass } from "../liff-style-helpers";
import { shouldShowWhaleStudioCredit, LiffStudioFooter } from "../LiffStudioFooter";
import { cx } from "./tokens";

interface Props {
  settings?: LiffPageConfigSettings | null;
  children: ReactNode;
  /** main の上下 padding（Tailwind class）。既定は新UIの余白。 */
  paddingClassName?: string;
  /** 子要素間の縦 gap（Tailwind class）。既定 gap-4。 */
  gapClassName?: string;
  /** Powered by フッターを描画するか。既定は settings の show_whale_studio_credit に従う。 */
  showFooter?: boolean;
  className?: string;
}

export function LiffPageShell({
  settings,
  children,
  paddingClassName = "pt-5 pb-24",
  gapClassName = "gap-4",
  showFooter,
  className,
}: Props) {
  const credit = showFooter ?? shouldShowWhaleStudioCredit(settings ?? undefined);
  return (
    <div
      className={cx(
        "liff-font",
        liffRootClass(settings ?? undefined),
        "min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]",
        className,
      )}
    >
      <main className={cx("liff-player-main flex flex-col", paddingClassName, gapClassName)}>
        {children}
      </main>
      {credit && <LiffStudioFooter />}
    </div>
  );
}
