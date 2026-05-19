// src/components/whale/in-ice/Works.tsx
//
// 実績数が少なくても寂しく見えないよう、「具体的な実績」ではなく「制作領域 (Case Study)」として
// 取り組み方を示す構成にしている。固有名詞を増やすときは ITEMS を差し替える。

import { Section, SectionHeading } from "./shared";

interface CaseStudy {
  category: string;
  title:    string;
  body:     string;
  scope:    string[];
}

const ITEMS: CaseStudy[] = [
  {
    category: "Stage × Mystery",
    title:    "舞台公演に連動した同卓型マーダーミステリー",
    body:     "本編の翌日、観客だけがアクセスできる “もう一つの夜” を設計。本編で語られなかった視点を、参加者が交代で担う。観劇後、自然と感想戦が生まれる構造に落とす。",
    scope:    ["脚本", "公演連動演出", "GM フロー", "観客側の動線"],
  },
  {
    category: "LINE × Narrative",
    title:    "LINE で進む数日間の物語体験",
    body:     "1 通の通知から始まり、選択と返信、QR スキャンによる移動で物語が分岐する。日常のメッセージに紛れる構造で、参加者の生活そのものを舞台にする。",
    scope:    ["シナリオ設計", "LIFF 実装", "リッチメニュー演出", "進行管理"],
  },
  {
    category: "Mystery × Promotion",
    title:    "ARG / 謎解き連動のキャンペーン",
    body:     "公開前作品の世界観を、SNS / Web / 実空間にまたがる断片で先取りする。プレイヤーが自分で組み立てた解釈が、本編公開時の体験価値に直結する。",
    scope:    ["コンセプト", "難易度設計", "拡散導線", "結末との接続"],
  },
  {
    category: "Immersive",
    title:    "回遊型イマーシブ・体験イベント",
    body:     "特定の場所 / 期間で、参加者の選択と移動によって個別の物語が編まれる。観客同士が偶然に交わる瞬間を演出として組み込み、再現性のない夜を作る。",
    scope:    ["空間設計", "登場人物オペレーション", "情報配布", "終演後の余韻設計"],
  },
];

export function Works() {
  return (
    <Section id="works">
      <SectionHeading
        eyebrow="Case Study"
        title="制作領域の例"
        subtitle="案件は守秘のため固有名詞は控えていますが、実際の制作領域と進め方を共有しています。"
      />

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {ITEMS.map((it) => (
          <li
            key={it.title}
            className="rounded-2xl border border-[color:var(--ice-border)] bg-[color:var(--ice-surface)]/60 p-7 md:p-8 flex flex-col gap-4"
          >
            <p className="text-[10px] md:text-[11px] tracking-[0.24em] uppercase text-[color:var(--ice-accent)]">
              {it.category}
            </p>
            <h3 className="ice-serif text-[20px] md:text-[22px] leading-snug text-[color:var(--ice-text)]">
              {it.title}
            </h3>
            <p className="text-[13px] md:text-[14px] leading-[2.0] text-[color:var(--ice-text-muted)]">
              {it.body}
            </p>
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {it.scope.map((tag) => (
                <li
                  key={tag}
                  className="text-[10px] md:text-[11px] tracking-[0.04em] px-2.5 py-1 rounded-full border border-[color:var(--ice-border-strong)] text-[color:var(--ice-text-muted)]"
                >
                  {tag}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}
