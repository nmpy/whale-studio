// src/components/whale/in-ice/Services.tsx
//
// 6 カード → 3 グループに再構成。
//   1. 企画・体験設計
//   2. 謎解き / マーダーミステリー制作
//   3. LINE / LIFF / 運用実装
//
// 各カードは「何を頼めるか」を箇条書きで明示し、迷わず判断できるようにする。
// セクション背景は出さない (= 全体は #06111F 一色)。塗りつぶし矩形を避ける。

import { Section, SectionHeading } from "./shared";

interface ServiceGroup {
  index: string;
  title: string;
  description: string;
  items:  string[];
}

const GROUPS: ServiceGroup[] = [
  {
    index: "01",
    title: "企画・体験設計",
    description:
      "コンセプト立案、脚本、演出、観客の動線設計まで一貫してお引き受けします。物語と現実、デジタルとアナログを編み込む工程に強みがあります。",
    items: [
      "体験コンセプト / プロット設計",
      "シナリオ・脚本",
      "公演 / 体験会場の演出設計",
      "舞台 / 公演との連動企画",
    ],
  },
  {
    index: "02",
    title: "謎解き / マーダーミステリー制作",
    description:
      "1 公演から制作可能。リプレイ性 / 同卓体験 / 観客性 / プレイヤー名 — 案件の目的に合わせた形式に落とします。",
    items: [
      "謎解き制作 (周遊型 / 公演型 / オンライン)",
      "マーダーミステリー制作 (同卓 / 観客 / 配信)",
      "イマーシブ / 回遊型イベント",
      "ARG / プロモーション連動企画",
    ],
  },
  {
    index: "03",
    title: "LINE / LIFF / 運用実装",
    description:
      "観客のスマートフォンを物語の小道具として動かす実装。公演当日の現場負荷を最小化する運用設計まで。",
    items: [
      "LINE 公式アカウント / リッチメニュー設計",
      "LIFF / QR を使った物語進行",
      "GM オペレーション支援",
      "Whale Studio を活用した CMS / 計測",
    ],
  },
];

export function Services() {
  return (
    <Section id="services">
      <SectionHeading
        eyebrow="Services"
        title={
          <>
            体験を、3 つの<br className="md:hidden" />
            役割で支える。
          </>
        }
        subtitle="脚本だけでも、実装だけでも、運用だけでも。プロジェクトごとに必要な工程を絞ってご依頼いただけます。"
      />

      <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {GROUPS.map((g) => (
          <li
            key={g.index}
            className="group relative rounded-2xl border p-7 md:p-8 transition-colors duration-200 flex flex-col gap-5"
            style={{
              background: "var(--ice-surface)",
              borderColor: "var(--ice-border)",
            }}
          >
            {/* index 番号 — 控えめなアクセント */}
            <span
              aria-hidden="true"
              className="ice-serif text-[12px] tracking-[0.18em] text-[color:var(--ice-accent)] opacity-80"
            >
              {g.index}
            </span>

            <h3 className="ice-serif text-[19px] md:text-[20px] leading-snug text-[color:var(--ice-text)]">
              {g.title}
            </h3>

            <p className="text-[13px] md:text-[14px] leading-[2.0] text-[color:var(--ice-text-muted)]">
              {g.description}
            </p>

            <ul className="flex flex-col gap-2 pt-1">
              {g.items.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-[12px] md:text-[13px] leading-[1.85] text-[color:var(--ice-text-muted)]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 inline-block w-1 h-1 rounded-full shrink-0"
                    style={{ background: "var(--ice-accent)" }}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}
