// src/components/liff/experience/LiffResultState.tsx
//
// 体験者向け LIFF の状態を統一表示するコンポーネント。
// loading / success / info / warning / error / permission を 1 つの見た目で扱う。
// カード枠は持たず（呼び出し側の LiffExperienceShell / 既存カードが枠を提供）、
// バッジ + タイトル + 説明 + 任意の子要素 + プライマリ/セカンダリアクションを縦に並べる。

import type { ReactNode } from "react";
import { LiffButton } from "@/components/liff/primitives/LiffButton";
import { LiffIconBadge, type LiffStateVariant } from "./LiffIconBadge";
import { LiffLoadingState } from "./LiffLoadingState";

export type LiffResultStateProps = {
  variant: LiffStateVariant;
  title?: string;
  description?: ReactNode;
  /** バッジに表示する絵文字/ノード（success は未指定でチェック）。 */
  icon?: ReactNode;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** バッジ・本文の下に差し込む追加コンテンツ（詳細ボックス等）。 */
  children?: ReactNode;
};

export function LiffResultState({
  variant,
  title,
  description,
  icon,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
}: LiffResultStateProps) {
  if (variant === "loading") {
    return <LiffLoadingState title={title} description={typeof description === "string" ? description : undefined} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
      <LiffIconBadge variant={variant} icon={icon} />
      {title && (
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--liff-primary-text, #1F2329)", margin: 0, letterSpacing: "0.01em" }}>
          {title}
        </h2>
      )}
      {description && (
        <div style={{ fontSize: 14, color: "var(--liff-secondary-text, #5B6168)", lineHeight: 1.75, whiteSpace: "pre-line", margin: 0 }}>
          {description}
        </div>
      )}
      {children}
      {(primaryActionLabel || secondaryActionLabel) && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          {primaryActionLabel && (
            <LiffButton type="button" variant="primary" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </LiffButton>
          )}
          {secondaryActionLabel && (
            <LiffButton type="button" variant="ghost" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </LiffButton>
          )}
        </div>
      )}
    </div>
  );
}
