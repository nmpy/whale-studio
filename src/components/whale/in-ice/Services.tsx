// src/components/whale/in-ice/Services.tsx

import { Section, SectionHeading } from "./shared";

const SERVICES: Array<{ title: string; body: string }> = [
  {
    title: "体験企画・設計",
    body:  "コンセプト立案から導線・脚本・演出までを一貫して設計します。物語と現実、デジタルとアナログを編み込む工程に強みがあります。",
  },
  {
    title: "マーダーミステリー / 物語体験の制作",
    body:  "1 公演から制作可能。リプレイ性 / 同卓体験 / 観客性 / プレイヤー名 — 案件の目的に合わせた形式に落とします。",
  },
  {
    title: "イマーシブ / 回遊型イベント",
    body:  "街、建物、舞台、配信プラットフォーム。観客が動き、選び、行間を埋めることで完成する体験を設計します。",
  },
  {
    title: "舞台・公演連動企画",
    body:  "公演前後の世界観拡張、観客限定の追加体験、出演者と観客をつなぐ物語装置。本編を邪魔せず、余韻を立体にします。",
  },
  {
    title: "LINE / LIFF 連動実装",
    body:  "公式アカウント、リッチメニュー、QR、LIFF。観客のスマートフォンを物語の小道具として動かす実装を組みます。",
  },
  {
    title: "Whale Studio を活用した運用設計",
    body:  "1 回きりではなく、運用を見越した CMS 設計・GM フロー・チェックイン体験。公演当日の現場負荷を最小化します。",
  },
];

export function Services() {
  return (
    <Section id="services" className="bg-[color:var(--ice-deep)]/40">
      <SectionHeading
        eyebrow="Services"
        title="制作領域"
        subtitle="脚本だけでも、実装だけでも、運用だけでも。プロジェクトごとに役割を絞って参加します。"
      />

      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {SERVICES.map((s) => (
          <li
            key={s.title}
            className="group rounded-2xl border border-[color:var(--ice-border)] bg-[color:var(--ice-surface)]/70 px-6 py-7 transition-colors duration-200 hover:border-[color:var(--ice-border-strong)] hover:bg-[color:var(--ice-surface-soft)]"
          >
            <h3 className="ice-serif text-[18px] md:text-[19px] leading-snug text-[color:var(--ice-text)] mb-3">
              {s.title}
            </h3>
            <p className="text-[13px] md:text-[14px] leading-[2.0] text-[color:var(--ice-text-muted)]">
              {s.body}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
