// src/components/liff/ticket-link/TicketLinkSuccessIcon.tsx
//
// 登録受付完了のグリーン丸囲みチェック。絵文字は使わず inline SVG で描く
// （フォント依存で表示が崩れないようにするため）。装飾なので aria-hidden。
// 過度なアニメーションは付けない。

export function TicketLinkSuccessIcon({ size = 76 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="38"
        cy="38"
        r="35"
        stroke="var(--liff-line-green, #06C755)"
        strokeWidth="2.5"
      />
      <path
        d="M23 39.5 L33.5 50 L53.5 27"
        stroke="var(--liff-line-green, #06C755)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
