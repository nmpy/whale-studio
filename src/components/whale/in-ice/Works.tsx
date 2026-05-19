// src/components/whale/in-ice/Works.tsx
//
// Case Study (再設計版) — 短編エッセイ風 3 件。
//   - 4 → 3 件に絞る
//   - カード矩形 / scope バッジ廃止
//   - 各 case = 「カテゴリ英字 + 大きめ和文タイトル + 2-3 段落の本文 + 末尾に scope の散文」
//   - 件と件の間は大きな余白 + hairline 1 本のみで仕切る

import { Section, SectionHeading, Hairline } from "./shared";

interface CaseStudy {
  category:  string;
  title:     string;
  body:      string[];
  scope:     string;
}

const ITEMS: CaseStudy[] = [
  {
    category: "Stage × Mystery",
    title:    "舞台公演に連動した、もう一つの夜。",
    body: [
      "本編の翌日、観客だけがアクセスできる “もう一つの夜” を設計する。本編で語られなかった視点を、参加者が交代で担う。",
      "観劇後、自然と感想戦が生まれる構造に落とす。配役の引き、進行のテンポ、観客が一度沈黙する余白までを設計対象に含める。",
    ],
    scope: "脚本、公演連動演出、GM フロー、観客側の動線。",
  },
  {
    category: "LINE × Narrative",
    title:    "LINE の中で、数日間の物語を進める。",
    body: [
      "1 通の通知から始まり、選択と返信、QR スキャンによる移動で物語が分岐する。日常のメッセージに紛れる構造で、参加者の生活そのものを舞台にする。",
      "完結後も、参加者のトーク履歴には登場人物の言葉が残る。物語のあとに残る、名前のない感触として。",
    ],
    scope: "シナリオ設計、LIFF 実装、リッチメニュー演出、進行管理。",
  },
  {
    category: "Immersive",
    title:    "回遊型イマーシブの、再現できない夜。",
    body: [
      "特定の場所と期間で、参加者の選択と移動によって個別の物語が編まれる。観客同士が偶然に交わる瞬間を演出として組み込み、再現性のない夜を作る。",
      "終演後、誰かと話すと話の細部が食い違う。それが体験の証拠として残る、その設計を一緒に作ります。",
    ],
    scope: "空間設計、登場人物オペレーション、情報配布、終演後の余韻設計。",
  },
];

export function Works() {
  return (
    <Section id="case-study">
      <SectionHeading
        number="No.03"
        eyebrow="Case Study"
        title="こんな体験を、つくれます。"
        lead="案件は守秘のため固有名詞は控えています。実際の制作領域と進め方を共有しています。"
      />

      <div className="flex flex-col">
        {ITEMS.map((it, idx) => (
          <article key={it.title}>
            {idx > 0 && <Hairline />}
            <div className="py-12 md:py-16 lg:py-20 grid grid-cols-12 gap-x-6 md:gap-x-10 lg:gap-x-16">
              {/* 左: カテゴリ */}
              <div className="col-span-12 md:col-span-4 mb-5 md:mb-0">
                <p className="text-[10px] md:text-[11px] tracking-[0.28em] uppercase text-[color:var(--ice-accent)]">
                  {it.category}
                </p>
              </div>

              {/* 右: タイトル + 本文 + scope */}
              <div className="col-span-12 md:col-span-8">
                <h3 className="ice-serif text-[22px] md:text-[28px] lg:text-[32px] leading-[1.45] text-[color:var(--ice-text)] mb-7 md:mb-8 max-w-[640px]">
                  {it.title}
                </h3>
                <div className="flex flex-col gap-5 md:gap-6">
                  {it.body.map((para, i) => (
                    <p
                      key={i}
                      className="text-[14px] md:text-[15px] leading-[2.1] text-[color:var(--ice-text-muted)] max-w-[640px]"
                    >
                      {para}
                    </p>
                  ))}
                </div>
                <p className="text-[12px] md:text-[13px] leading-[1.95] text-[color:var(--ice-text-faint)] mt-7 md:mt-8 max-w-[640px]">
                  ― {it.scope}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
