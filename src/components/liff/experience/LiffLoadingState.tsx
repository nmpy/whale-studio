// src/components/liff/experience/LiffLoadingState.tsx
//
// 読み込み中の表示。水面の波紋っぽい ripple アニメーション + タイトル/説明。
// prefers-reduced-motion 環境では静かなパルスにフォールバックする。

const GREEN = "var(--liff-line-green, #06C755)";

export function LiffLoadingState({
  title = "準備しています",
  description = "このまま少しだけお待ちください。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div className="liff-ripple" aria-hidden>
        <span />
        <span />
        <span className="liff-ripple-dot" />
      </div>
      <div>
        <p style={{ fontSize: 16, fontWeight: 700, color: "var(--liff-primary-text, #1F2329)", margin: 0 }}>{title}</p>
        {description && (
          <p style={{ fontSize: 13, color: "var(--liff-secondary-text, #5B6168)", margin: "6px 0 0", lineHeight: 1.7 }}>
            {description}
          </p>
        )}
      </div>
      <style>{`
        .liff-ripple { position: relative; width: 64px; height: 64px; }
        .liff-ripple > span {
          position: absolute; inset: 0; border-radius: 50%;
          border: 2px solid ${GREEN}; opacity: 0;
          animation: liffRipple 1.8s cubic-bezier(0,0.2,0.8,1) infinite;
        }
        .liff-ripple > span:nth-child(2) { animation-delay: 0.6s; }
        /* 中心は「波紋の起点」に見えるよう、小さめ＋放射状フェードでソリッドな塊感を弱める。
           色は LINE green のまま。水面リングと階調をつないで一体感を出す。 */
        .liff-ripple-dot {
          position: absolute; inset: 28px; border: none !important;
          background: radial-gradient(circle, ${GREEN} 0%, ${GREEN} 30%, transparent 72%) !important;
          opacity: 0.6 !important;
          animation: liffPulse 1.8s ease-in-out infinite !important;
        }
        @keyframes liffRipple { 0% { transform: scale(0.4); opacity: 0.5; } 100% { transform: scale(1); opacity: 0; } }
        @keyframes liffPulse { 0%,100% { transform: scale(0.8); opacity: 0.35; } 50% { transform: scale(1.0); opacity: 0.6; } }
        @media (prefers-reduced-motion: reduce) {
          .liff-ripple > span { animation: none; opacity: 0.25; }
          .liff-ripple-dot { animation: none !important; opacity: 0.5 !important; }
        }
      `}</style>
    </div>
  );
}
