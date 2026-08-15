// src/components/liff/ui/LiffPageHeader.tsx
//
// LIFF 新UI: ページ見出し（大きめタイトル + 薄いサブテキスト）。
//   実機 LINE ヘッダー（document.title）との二重表示を避けるため、`showTitle` で出し分け可能にしている。
//   既定は title を表示するが、PR2 以降で「ヘッダー帯に出すので本文タイトルは隠す」運用にもできる。

import type { ReactNode } from "react";
import type { LiffPageConfigSettings } from "@/types";
import { liffDescriptionAlignClass } from "../liff-style-helpers";
import { cx, LIFF_TEXT } from "./tokens";

interface Props {
  title?: ReactNode;
  description?: ReactNode;
  settings?: LiffPageConfigSettings | null;
  /** タイトルを本文に出すか。既定 true。LINE ヘッダーと重複させたくない場合 false。 */
  showTitle?: boolean;
  className?: string;
}

export function LiffPageHeader({ title, description, settings, showTitle = true, className }: Props) {
  if ((!title || !showTitle) && !description) return null;
  return (
    // semantics は <header> のまま維持する。
    // globals.css の **unlayered** な `header { … }`（白い半透明背景 + sticky + 影）が
    // LIFF 配下にも漏れる問題は、liff-font.css の `.liff-font header { … }` reset で
    // LIFF スコープ内に閉じて解決している（この component 側で <div> に逃がさない）。
    <header className={cx("flex flex-col gap-1.5", className)}>
      {showTitle && title && <h1 className={LIFF_TEXT.pageTitle}>{title}</h1>}
      {description && (
        <p className={cx(LIFF_TEXT.secondary, "whitespace-pre-wrap break-words", liffDescriptionAlignClass(settings ?? undefined))}>
          {description}
        </p>
      )}
    </header>
  );
}
