// src/components/landing/LandingMockCards.tsx
// Hero 背景の装飾。ミニマルで明るいトーンに合わせ、淡いグリーンの円形ぼかしのみを置く。
// （旧: Netflix 風のダークカード群 → 廃止）

export function LandingMockCards() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-12%] h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-[#06C755]/10 blur-3xl" />
      <div className="absolute left-[12%] top-[28%] h-[260px] w-[260px] rounded-full bg-[#9BE7C4]/25 blur-3xl" />
      <div className="absolute right-[10%] top-[18%] h-[300px] w-[300px] rounded-full bg-[#06C755]/[0.08] blur-3xl" />
    </div>
  );
}
