// src/components/liff/primitives/LiffEmptyState.tsx
//
// LIFF 各ページ共通の「空状態」カード。ホームの空状態と同じトーン
// （白サーフェス + 薄い境界 + radius 18 + 控えめな影）に揃える。
// 点線カードや絵文字のばらつきを解消し、ページ間で印象を統一するための共通部品。

interface Props {
  /** 補足の絵文字（任意）。指定しない場合は表示しない。 */
  emoji?: string;
  /** 主テキスト（必須）。 */
  text: string;
  /** 補助の説明テキスト（任意）。 */
  description?: string;
}

export function LiffEmptyState({ emoji, text, description }: Props) {
  return (
    <div className="bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border)] rounded-[18px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] px-4 py-10 text-center">
      {emoji && <p className="text-3xl mb-2" aria-hidden="true">{emoji}</p>}
      <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)] break-words">{text}</p>
      {description && (
        <p className="mt-1.5 text-[13px] leading-[1.6] text-[color:var(--liff-tertiary-text,#8C8C8C)] break-words">{description}</p>
      )}
    </div>
  );
}
