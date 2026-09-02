// src/components/whale/lp-v2/HowItWorks.tsx
//
// 導入の流れ。実際の onboarding 導線 (src/app/onboarding/terms → line-oa → review) と
// 管理画面の作業順に合わせている。審査があることを隠さず明示する。

import { Section, SectionHeading } from "./shared";

const STEPS: Array<{ no: string; title: string; body: string }> = [
  {
    no: "01",
    title: "アカウント登録",
    body: "メールアドレスで登録し、利用規約に同意します。法人でのご利用は個別のご案内となります。",
  },
  {
    no: "02",
    title: "LINE 公式アカウントを接続",
    body: "お持ちの LINE 公式アカウントを接続します。接続後、内容を確認のうえ利用開始のご案内をします（審査があります）。",
  },
  {
    no: "03",
    title: "作品をつくる",
    body: "キャラクターを登録し、フェーズごとのメッセージと謎を用意して、シナリオフローで進行を組み立てます。",
  },
  {
    no: "04",
    title: "公開して、当日を運用する",
    body: "友だち追加導線とリッチメニューを整えて公開。参加者の進行状況はオーディエンス画面からリアルタイムに確認できます。",
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        eyebrow="How it works"
        title="登録から公開まで、4 ステップ。"
        subtitle="制作の途中でつまずきやすい箇所は、管理画面のガイドとセットアップ状況の表示でフォローします。"
      />

      <ol className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
        {STEPS.map((s) => (
          <li
            key={s.no}
            className="relative rounded-2xl border border-[color:var(--ws-border)] bg-[color:var(--ws-surface)] px-6 py-7 md:px-8 md:py-8"
          >
            <span
              aria-hidden="true"
              className="block text-[28px] md:text-[32px] font-bold leading-none text-[color:var(--ws-navy)]/22 mb-4"
            >
              {s.no}
            </span>
            <h3 className="text-[16px] md:text-[17px] font-bold text-[color:var(--ws-text)] mb-2.5">
              {s.title}
            </h3>
            <p className="text-[13px] md:text-[13.5px] leading-[1.95] text-[color:var(--ws-text-muted)]">
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
