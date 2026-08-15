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
    // <header> ではなく <div> を使う。globals.css の **unlayered** な `header { … }`
    // （白い半透明背景 + sticky + 影）が LIFF 配下にも漏れ、見出しの後ろに白い帯が出るため。
    // Tailwind utilities は @layer 内なので打ち消せない。HintSearchRenderer でも同じ理由で <div>。
    // 暗色 color_mode ではこの白帯が特に目立つ（本部品はまだ本番 renderer では未使用）。
    <div className={cx("flex flex-col gap-1.5", className)}>
      {showTitle && title && <h1 className={LIFF_TEXT.pageTitle}>{title}</h1>}
      {description && (
        <p className={cx(LIFF_TEXT.secondary, "whitespace-pre-wrap break-words", liffDescriptionAlignClass(settings ?? undefined))}>
          {description}
        </p>
      )}
    </div>
  );
}
