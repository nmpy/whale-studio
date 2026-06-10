// src/components/liff/experience/LiffExperienceShell.tsx
//
// 体験者向け LIFF 画面の共通レイアウト。
//   - 画面全体: 淡い水色〜白のグラデーション背景（やわらかく少し海っぽい世界観）
//   - 中央にカード（白・角丸・軽い影）
//   - カード上部に控えめな波形装飾
//   - 下部に小さく "Powered by Whale Studio"（showCredit=false で非表示）
//   - safe-area / 100dvh 対応で小さい画面でも崩れない

import type { ReactNode } from "react";

const SEA_GRADIENT =
  "linear-gradient(180deg, #eaf4fb 0%, #f3fafe 38%, #ffffff 100%)";

function WaveMark() {
  // 控えめな波 + 小さなくじらのしっぽ風の装飾（作品世界観を邪魔しない汎用マーク）。
  return (
    <svg width="56" height="22" viewBox="0 0 56 22" fill="none" aria-hidden style={{ display: "block", margin: "0 auto" }}>
      <path d="M2 14c5 0 5-6 10-6s5 6 10 6 5-6 10-6 5 6 10 6 5-6 10-6"
        stroke="var(--liff-line-green,#06C755)" strokeOpacity="0.55" strokeWidth="2.4"
        strokeLinecap="round" fill="none" />
      <circle cx="46" cy="6" r="2.4" fill="var(--liff-line-green,#06C755)" fillOpacity="0.55" />
    </svg>
  );
}

export function LiffExperienceShell({
  children,
  belowCard,
  showCredit = true,
  showWaveMark = true,
}: {
  children: ReactNode;
  /** カードの下・フッターの上に出す追加パネル（スタンプラリー等）。 */
  belowCard?: ReactNode;
  showCredit?: boolean;
  showWaveMark?: boolean;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: SEA_GRADIENT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "max(24px, env(safe-area-inset-top))",
        paddingBottom: "max(20px, env(safe-area-inset-bottom))",
        paddingLeft: "max(16px, env(safe-area-inset-left))",
        paddingRight: "max(16px, env(safe-area-inset-right))",
        gap: 14,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--liff-surface, #ffffff)",
          borderRadius: 24,
          border: "1px solid #eaf0f4",
          boxShadow: "0 10px 30px rgba(31, 64, 92, 0.08)",
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {showWaveMark && <WaveMark />}
        {children}
      </div>

      {belowCard && <div style={{ width: "100%", maxWidth: 380 }}>{belowCard}</div>}

      {showCredit && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: "var(--liff-tertiary-text, #8C8C8C)",
            textAlign: "center",
          }}
        >
          Powered by Whale Studio
        </p>
      )}
    </div>
  );
}
