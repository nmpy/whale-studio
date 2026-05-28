// src/components/landing/LandingMockCards.tsx
// Hero 背景の装飾カード群（CSS only / 画像なし）。
// Netflix のサムネイル壁を参考にしつつ、実写・実在作品画像は一切使わず、
// 機能・ジャンルのラベルだけを並べた半透明カードを斜めに配置する。

const LABELS = [
  "謎解き", "マーダーミステリー", "舞台連動", "周遊イベント",
  "LINE OA", "LIFF", "QRチェックイン", "アンケート",
  "分岐メッセージ", "参加者導線", "謎解き", "周遊イベント",
];

export function LandingMockCards() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-50"
    >
      {/* 斜めに傾けたカードグリッド */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 rotate-[-12deg] gap-3">
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="flex flex-col gap-3" style={{ transform: `translateY(${(col % 2) * 28 - 14}px)` }}>
            {LABELS.slice(col * 3, col * 3 + 3).map((label, i) => (
              <div
                key={i}
                className="flex h-24 w-40 items-end rounded-xl border border-white/10 bg-gradient-to-br from-[#0b3d2e] via-[#072a3a] to-[#03110a] p-3 shadow-xl sm:h-28 sm:w-48"
              >
                <span className="text-[12px] font-bold tracking-wide text-white/70">{label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
