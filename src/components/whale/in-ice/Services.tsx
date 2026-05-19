// src/components/whale/in-ice/Services.tsx
//
// 「制作領域」縦リスト (再設計版)。
//   - 3 カード grid → ToC (目次) 風縦リストへ
//   - 各項目: 左に大きな番号 + 英ラベル、右に和文タイトル + 1 段落説明
//   - 矩形 / 角丸 / 塗りつぶしを使わない。hairline 1 本のみで仕切る
//   - 箇条書きは廃止。散文で「何ができるか」を伝える

import { Section, SectionHeading, Hairline } from "./shared";

interface ServiceItem {
  index:   string;
  label:   string;
  title:   string;
  body:    string;
}

const ITEMS: ServiceItem[] = [
  {
    index: "01",
    label: "Narrative",
    title: "企画・体験設計",
    body:
      "コンセプト、脚本、演出、観客の動線まで一貫して。物語と現実、デジタルとアナログを編み込む工程に強みがあります。" +
      "目的に応じて、必要な工程だけを切り出してご一緒することもできます。",
  },
  {
    index: "02",
    label: "Mystery",
    title: "謎解き / マーダーミステリー制作",
    body:
      "1 公演から制作可能。同卓 / 観客 / リプレイ性、案件の目的に応じて形式を選びます。" +
      "ARG、回遊型、イマーシブといった派生形にも対応します。",
  },
  {
    index: "03",
    label: "System",
    title: "LINE / LIFF / 運用実装",
    body:
      "観客のスマートフォンを物語の小道具にする実装。" +
      "通知、リッチメニュー、QR、LIFF を物語の一部として組み上げ、当日の現場負荷を最小化する運用設計まで。",
  },
];

export function Services() {
  return (
    <Section id="services">
      <SectionHeading
        number="No.02"
        eyebrow="Services"
        title="制作領域"
        lead="脚本だけでも、実装だけでも、運用だけでも。"
      />

      {/* ToC 風縦リスト。各項目間に hairline 1 本だけ。 */}
      <div className="flex flex-col">
        {ITEMS.map((it, idx) => (
          <div key={it.index}>
            {idx > 0 && <Hairline />}
            <div className="grid grid-cols-12 gap-x-6 md:gap-x-10 lg:gap-x-16 py-10 md:py-14 lg:py-16">
              {/* 左: 番号 + 英ラベル */}
              <div className="col-span-12 md:col-span-4 mb-4 md:mb-0 flex md:flex-col items-baseline gap-3 md:gap-2">
                <span className="ice-serif text-[28px] md:text-[36px] lg:text-[40px] leading-none text-[color:var(--ice-text)] opacity-90">
                  {it.index}
                </span>
                <span className="text-[10px] md:text-[11px] tracking-[0.32em] uppercase text-[color:var(--ice-accent)]">
                  {it.label}
                </span>
              </div>

              {/* 右: 和文タイトル + 散文の説明 */}
              <div className="col-span-12 md:col-span-8">
                <h3 className="ice-serif text-[20px] md:text-[24px] lg:text-[26px] leading-snug text-[color:var(--ice-text)] mb-4 md:mb-5">
                  {it.title}
                </h3>
                <p className="text-[14px] md:text-[15px] leading-[2.05] text-[color:var(--ice-text-muted)]">
                  {it.body}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
