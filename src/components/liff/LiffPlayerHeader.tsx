"use client";

// src/components/liff/LiffPlayerHeader.tsx
// LIFF プレイヤー画面用の共通ヘッダー。
// 各モードのレンダラーがタイトルを統一して表示するために使う。
// タイトル文字数は別途バリデーション (最大 10 文字) で短く保たれているため、ここでは truncate しない。

interface Props {
  title?: string | null;
}

export function LiffPlayerHeader({ title }: Props) {
  return (
    <header
      className="px-4 py-3"
      style={{
        background: "var(--liff-header-bg)",
        color: "var(--liff-header-text)",
      }}
    >
      <div className="max-w-md mx-auto">
        <h1 className="text-[18px] leading-tight font-bold tracking-tight break-words">
          {title || "LIFF"}
        </h1>
      </div>
    </header>
  );
}
